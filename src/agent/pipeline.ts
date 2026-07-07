import type {
  AgentTurnInput,
  AgentTurnResult,
  ConversationState,
  JsonValue,
  RetrievedContext,
  ValidationResult,
} from "../types.js";
import { nowIso } from "../lib/ids.js";
import { matchLoreEntries } from "../st/lorebook.js";
import { WorkspaceStore } from "../storage/workspace.js";
import type { ModelClient } from "./model.js";

export class AgentRuntime {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly model: ModelClient,
  ) {}

  async handleUserInput(input: AgentTurnInput): Promise<AgentTurnResult> {
    const config = await this.store.loadConversationConfig(input.conversationId);
    const state = await this.store.loadConversationState(input.conversationId);
    const settings = await this.store.loadSettings();
    const character = await this.store.loadCharacter(config.characterId);
    const lorebooks = await Promise.all(
      config.lorebookIds.map((id) => this.store.loadLorebook(id)),
    );

    await this.store.appendEvent(input.conversationId, "user_input", {
      content: input.text,
    });

    const recentMessages = await this.store.loadRecentMessages(
      input.conversationId,
      settings.agent.recentMessageLimit,
    );
    const recentMessageText = recentMessages.map((message) => message.content);
    const loreEntries = matchLoreEntries(
      lorebooks,
      input.text,
      recentMessageText,
    ).slice(0, settings.agent.maxLoreEntries);
    const context: RetrievedContext = {
      character,
      loreEntries,
      recentMessages,
    };
    const prompt = composePrompt(context, state, input.text);

    await this.store.appendEvent(input.conversationId, "pipeline_trace", {
      model: config.model,
      matchedLoreEntryIds: loreEntries.map((entry) => entry.id),
      prompt: settings.agent.storePromptTrace ? prompt : "[disabled]",
    });

    const draft = await this.model.generate({
      character,
      state,
      recentMessages,
      matchedLoreEntries: loreEntries,
      prompt,
      userInput: input.text,
      model: config.model,
      settings,
    });
    const validation = settings.agent.validationEnabled
      ? validateOutput(draft.content, settings.agent.maxOutputChars)
      : { passed: true, issues: [] };
    const output = validation.passed
      ? draft.content
      : fallbackOutput(character.name, validation);

    await this.store.appendEvent(input.conversationId, "assistant_output", {
      content: output,
    });

    const nextState = updateState(
      state,
      input.text,
      output,
      settings.agent.summaryMaxChars,
    );
    if (settings.agent.autoUpdateState) {
      await this.store.saveConversationState(input.conversationId, nextState);
    }
    await this.store.saveConversationConfig(config);
    if (settings.agent.autoUpdateState) {
      await this.store.appendEvent(input.conversationId, "state_update", {
        turnCount: nextState.turnCount,
        summary: nextState.summary,
        currentScene: nextState.currentScene,
      });
    }

    return {
      conversationId: input.conversationId,
      output,
      matchedLoreEntries: loreEntries,
      validation,
    };
  }
}

export function composePrompt(
  context: RetrievedContext,
  state: ConversationState,
  userInput: string,
): string {
  const lore = context.loreEntries
    .map((entry) => `- ${entry.title}: ${entry.content}`)
    .join("\n");
  const recent = context.recentMessages
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");

  return [
    `Character: ${context.character.name}`,
    `Description: ${context.character.description}`,
    `Personality: ${context.character.personality}`,
    `Scenario: ${context.character.scenario}`,
    `System: ${context.character.systemPrompt}`,
    `State summary: ${state.summary}`,
    `Current scene: ${state.currentScene}`,
    lore.length > 0 ? `Matched lore:\n${lore}` : "Matched lore: none",
    recent.length > 0 ? `Recent messages:\n${recent}` : "Recent messages: none",
    `User input: ${userInput}`,
  ].join("\n\n");
}

export function validateOutput(
  content: string,
  maxOutputChars = 4000,
): ValidationResult {
  const issues: string[] = [];

  if (content.trim().length === 0) {
    issues.push("Output is empty.");
  }

  if (content.includes("System:") || content.includes("System prompt")) {
    issues.push("Output appears to expose hidden prompt material.");
  }

  if (content.length > maxOutputChars) {
    issues.push("Output is longer than the MVP limit.");
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

function fallbackOutput(characterName: string, validation: ValidationResult): string {
  return `${characterName}: "I need a moment to keep this consistent." (${validation.issues.join(
    " ",
  )})`;
}

function updateState(
  state: ConversationState,
  userInput: string,
  output: string,
  summaryMaxChars: number,
): ConversationState {
  const turnCount = state.turnCount + 1;
  const currentScene = inferScene(state.currentScene, userInput);
  const summary = summarizeTurn(
    state.summary,
    turnCount,
    userInput,
    output,
    summaryMaxChars,
  );
  const variables: Record<string, JsonValue> = {
    ...state.variables,
    last_user_input: userInput,
    last_assistant_output: output,
  };

  return {
    turnCount,
    summary,
    currentScene,
    variables,
    updatedAt: nowIso(),
  };
}

function inferScene(currentScene: string, userInput: string): string {
  const lower = userInput.toLowerCase();

  if (lower.includes("tower")) {
    return "near the tower";
  }

  if (lower.includes("archive") || lower.includes("library")) {
    return "inside the archive";
  }

  return currentScene;
}

function summarizeTurn(
  previousSummary: string,
  turnCount: number,
  userInput: string,
  output: string,
  maxLength: number,
): string {
  const line = `Turn ${turnCount}: user=${truncate(userInput, 120)} assistant=${truncate(
    output,
    160,
  )}`;

  if (previousSummary.length === 0) {
    return line;
  }

  return truncate(`${previousSummary}\n${line}`, maxLength);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
