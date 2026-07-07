import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";

import type {
  ChatMessage,
  CharacterProfile,
  ConversationConfig,
  ConversationState,
  Lorebook,
  Settings,
} from "../types.js";
import type { WorkspaceStore } from "../storage/workspace.js";
import { buildPiContext, createPiModel, createPiStreamFn } from "./pi-client.js";
import { createRuntimeTools, type RuntimeToolContext } from "./pi-tools.js";

export interface PiRuntimeOptions {
  store: WorkspaceStore;
  settings: Settings;
}

export interface PiConversationSession {
  conversationId: string;
  agent: Agent;
  state: ConversationState;
}

export class PiRuntime {
  private readonly store: WorkspaceStore;
  private settings: Settings;
  private readonly sessions = new Map<string, PiConversationSession>();

  constructor(options: PiRuntimeOptions) {
    this.store = options.store;
    this.settings = options.settings;
  }

  async loadSession(conversationId: string): Promise<PiConversationSession> {
    const existing = this.sessions.get(conversationId);
    if (existing) return existing;

    const config = await this.store.loadConversationConfig(conversationId);
    const state = await this.store.loadConversationState(conversationId);
    const character = await this.store.loadCharacter(config.characterId);
    const lorebooks = await Promise.all(
      config.lorebookIds.map((id) => this.store.loadLorebook(id)),
    );
    const messages = await this.store.loadRecentMessages(conversationId, 80);

    const systemPrompt = buildSystemPrompt(character, state, lorebooks);
    const model = createPiModel(config.model, this.settings);
    const streamFn = createPiStreamFn(this.settings);

    const toolContext: RuntimeToolContext = {
      currentScene: state.currentScene,
      summary: state.summary,
      variables: state.variables,
      lorebooks,
      recentMessageText: messages.map((m) => m.content),
      onUpdateState: (patch) => {
        if (patch.currentScene !== undefined) state.currentScene = patch.currentScene;
        if (patch.summary !== undefined) state.summary = patch.summary;
        if (patch.variables !== undefined) state.variables = patch.variables;
      },
    };

    const providerConfig = this.settings.providers[config.model.provider];
    const tools =
      providerConfig?.toolChoice === "none" ? [] : createRuntimeTools(toolContext);

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: mapThinkingLevel(config.model.provider, this.settings),
        tools,
        messages: buildPiContext(systemPrompt, messages, model.provider, model.id, []).messages,
      },
      streamFn,
      toolExecution: "parallel",
    });

    const session: PiConversationSession = {
      conversationId,
      agent,
      state,
    };
    this.sessions.set(conversationId, session);
    return session;
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
  }

  async runTurn(
    conversationId: string,
    userInput: string,
    onEvent: (event: AgentEvent | { type: "error"; error: string }) => void,
  ): Promise<boolean> {
    const session = await this.loadSession(conversationId);
    const unsubscribe = session.agent.subscribe(async (event) => {
      onEvent(event);
    });

    try {
      await session.agent.prompt(userInput);
      await session.agent.waitForIdle();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ type: "error", error: message });
      return false;
    } finally {
      unsubscribe();
      await this.persistSession(session);
    }
  }

  private async persistSession(session: PiConversationSession): Promise<void> {
    await this.store.saveConversationState(session.conversationId, session.state);
    const config = await this.store.loadConversationConfig(session.conversationId);
    await this.store.saveConversationConfig(config);
    await this.persistMessages(session);
  }

  private async persistMessages(session: PiConversationSession): Promise<void> {
    const existingMessages = await this.store.loadRecentMessages(session.conversationId, 1000);
    const existingKeys = new Set(
      existingMessages.map((m) => `${m.role}:${m.timestamp}:${m.content}`),
    );

    for (const message of session.agent.state.messages) {
      const chatMessage = agentMessageToChatMessage(message);
      if (!chatMessage) continue;
      const key = `${chatMessage.role}:${chatMessage.timestamp}:${chatMessage.content}`;
      if (existingKeys.has(key)) continue;

      if (chatMessage.role === "user") {
        await this.store.appendEvent(session.conversationId, "user_input", {
          content: chatMessage.content,
        });
      } else if (chatMessage.role === "assistant") {
        await this.store.appendEvent(session.conversationId, "assistant_output", {
          content: chatMessage.content,
        });
      }
    }
  }
}

function agentMessageToChatMessage(message: AgentMessage): ChatMessage | null {
  const timestamp = new Date(message.timestamp).toISOString();

  if (message.role === "user") {
    const content = typeof message.content === "string"
      ? message.content
      : extractTextFromContent(message.content);
    return { role: "user", content, timestamp };
  }

  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: extractTextFromContent(message.content),
      timestamp,
    };
  }

  return null;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as Record<string, unknown>).text ?? "");
      }
      return "";
    })
    .join("");
}

function buildSystemPrompt(
  character: CharacterProfile,
  state: ConversationState,
  lorebooks: Lorebook[],
): string {
  const lore = lorebooks
    .flatMap((book) => book.entries)
    .map((entry) => `- ${entry.title}: ${entry.content}`)
    .join("\n");

  return [
    `Character: ${character.name}`,
    `Description: ${character.description}`,
    `Personality: ${character.personality}`,
    `Scenario: ${character.scenario}`,
    `System: ${character.systemPrompt}`,
    `State summary: ${state.summary}`,
    `Current scene: ${state.currentScene}`,
    lore.length > 0 ? `Matched lore:\n${lore}` : "Matched lore: none",
    "Respond only as the character. You may use tools to update scene, summary, variables, or search lore.",
  ].join("\n\n");
}

function mapThinkingLevel(
  provider: string,
  settings: Settings,
): "off" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  const config = settings.providers[provider];
  if (!config) return "off";

  // DeepSeek: enabled -> high
  if (provider === "deepseek") {
    if ("thinking" in config && config.thinking === "enabled") return "high";
    if ("reasoningEffort" in config && config.reasoningEffort) {
      const effort = config.reasoningEffort;
      if (effort === "high") return "high";
    }
    return "off";
  }

  // Kimi: thinking -> medium/high
  if (provider === "kimi") {
    if ("thinking" in config && config.thinking === "enabled") return "high";
    return "off";
  }

  return "off";
}
