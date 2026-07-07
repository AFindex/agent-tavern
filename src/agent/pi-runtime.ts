import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";

import type {
  ChatMessage,
  ConversationState,
  LorebookEntry,
  RegexScript,
  Settings,
} from "../types.js";
import type { WorkspaceStore } from "../storage/workspace.js";
import { buildPiContext, createPiModel, createPiStreamFn } from "./pi-client.js";
import { createRuntimeTools, type RuntimeToolContext } from "./pi-tools.js";
import { nowIso } from "../lib/ids.js";
import { matchLoreEntriesDetailed } from "../st/lorebook.js";
import { applyRegexScripts } from "../st/regex.js";
import {
  buildTavernSystemPrompt,
  collectRegexScripts,
  createMacroContext,
} from "../st/prompt.js";
import type { MacroContext } from "../st/macros.js";

export interface PiRuntimeOptions {
  store: WorkspaceStore;
  settings: Settings;
}

export interface PiConversationSession {
  conversationId: string;
  agent: Agent;
  state: ConversationState;
}

interface PreparedTurn {
  userInput: string;
  matchedLoreEntries: LorebookEntry[];
  directLoreEntryIds: string[];
  recursiveLoreEntryIds: string[];
  scanText: string;
  systemPrompt: string;
  regexScripts: RegexScript[];
  macroContext: MacroContext;
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
    const messages = await this.store.loadRecentMessages(
      conversationId,
      this.settings.agent.recentMessageLimit,
    );

    const systemPrompt = buildTavernSystemPrompt({
      character,
      state,
      loreEntries: [],
      messages,
      settings: this.settings,
    });
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
    this.sessions.clear();
  }

  async runTurn(
    conversationId: string,
    userInput: string,
    onEvent: (event: AgentEvent | { type: "error"; error: string }) => void,
  ): Promise<boolean> {
    const session = await this.loadSession(conversationId);
    const prepared = await this.prepareTurn(session, userInput);
    const messageStartIndex = session.agent.state.messages.length;
    const unsubscribe = session.agent.subscribe(async (event) => {
      onEvent(event);
    });

    try {
      await session.agent.prompt(prepared.userInput);
      await session.agent.waitForIdle();
      this.applyAssistantRegex(session, messageStartIndex, prepared);
      session.state.turnCount += 1;
      session.state.updatedAt = nowIso();
      await this.store.appendEvent(conversationId, "pipeline_trace", {
        matchedLoreEntryIds: prepared.matchedLoreEntries.map((entry) => entry.id),
        directLoreEntryIds: prepared.directLoreEntryIds,
        recursiveLoreEntryIds: prepared.recursiveLoreEntryIds,
        scanText: prepared.scanText,
        systemPrompt: this.settings.agent.storePromptTrace
          ? prepared.systemPrompt
          : undefined,
      });
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

  private async prepareTurn(
    session: PiConversationSession,
    userInput: string,
  ): Promise<PreparedTurn> {
    const config = await this.store.loadConversationConfig(session.conversationId);
    const character = await this.store.loadCharacter(config.characterId);
    const lorebooks = await Promise.all(
      config.lorebookIds.map((id) => this.store.loadLorebook(id)),
    );
    const messages = await this.store.loadRecentMessages(
      session.conversationId,
      this.settings.agent.recentMessageLimit,
    );
    const regexScripts = collectRegexScripts(this.settings, character);
    const initialMacroContext = createMacroContext({
      character,
      state: session.state,
      loreEntries: [],
      messages,
      settings: this.settings,
      inputText: userInput,
    });
    const processedInput = applyRegexScripts(
      userInput,
      regexScripts,
      "userInput",
      initialMacroContext,
    );
    const macroContext = createMacroContext({
      character,
      state: session.state,
      loreEntries: [],
      messages,
      settings: this.settings,
      inputText: processedInput,
    });
    const loreMatch = matchLoreEntriesDetailed(lorebooks, {
      inputText: processedInput,
      recentMessages: messages,
      macroContext,
      userName: this.settings.agent.userName,
      characterName: character.name,
      scanDepth: this.settings.agent.loreScanDepth,
      maxEntries: this.settings.agent.maxLoreEntries,
      recursiveScanning: this.settings.agent.loreRecursiveScanning,
      maxRecursionSteps: this.settings.agent.loreMaxRecursionSteps,
      caseSensitive: this.settings.agent.loreCaseSensitive,
      matchWholeWords: this.settings.agent.loreMatchWholeWords,
    });
    const systemPrompt = buildTavernSystemPrompt({
      character,
      state: session.state,
      loreEntries: loreMatch.entries,
      messages,
      settings: this.settings,
      inputText: processedInput,
    });
    const model = createPiModel(config.model, this.settings);

    session.agent.state.model = model;
    session.agent.state.thinkingLevel = mapThinkingLevel(
      config.model.provider,
      this.settings,
    );
    session.agent.state.systemPrompt = systemPrompt;
    session.agent.state.messages = buildPiContext(
      systemPrompt,
      messages,
      model.provider,
      model.id,
      [],
    ).messages;

    const toolContext: RuntimeToolContext = {
      currentScene: session.state.currentScene,
      summary: session.state.summary,
      variables: session.state.variables,
      lorebooks,
      recentMessageText: [...messages.map((message) => message.content), processedInput],
      onUpdateState: (patch) => {
        if (patch.currentScene !== undefined) session.state.currentScene = patch.currentScene;
        if (patch.summary !== undefined) session.state.summary = patch.summary;
        if (patch.variables !== undefined) session.state.variables = patch.variables;
      },
    };
    const providerConfig = this.settings.providers[config.model.provider];
    session.agent.state.tools =
      providerConfig?.toolChoice === "none" ? [] : createRuntimeTools(toolContext);

    return {
      userInput: processedInput,
      matchedLoreEntries: loreMatch.entries,
      directLoreEntryIds: loreMatch.directEntryIds,
      recursiveLoreEntryIds: loreMatch.recursiveEntryIds,
      scanText: loreMatch.scanText,
      systemPrompt,
      regexScripts,
      macroContext,
    };
  }

  private applyAssistantRegex(
    session: PiConversationSession,
    messageStartIndex: number,
    prepared: PreparedTurn,
  ): void {
    const messages = session.agent.state.messages.slice();
    for (let index = messageStartIndex; index < messages.length; index += 1) {
      const message = messages[index];
      if (!message || message.role !== "assistant") continue;
      message.content = message.content.map((part) => {
        if (part.type !== "text") return part;
        return {
          ...part,
          text: applyRegexScripts(
            part.text,
            prepared.regexScripts,
            "aiResponse",
            prepared.macroContext,
          ),
        };
      });
    }
    session.agent.state.messages = messages;
  }

  private async persistSession(session: PiConversationSession): Promise<void> {
    session.state.updatedAt = nowIso();
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
      if (chatMessage.content.trim().length === 0) continue;
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
