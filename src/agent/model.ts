import type {
  CharacterProfile,
  ChatMessage,
  ConversationState,
  LorebookEntry,
} from "../types.js";

export interface ModelRequest {
  character: CharacterProfile;
  state: ConversationState;
  recentMessages: ChatMessage[];
  matchedLoreEntries: LorebookEntry[];
  prompt: string;
  userInput: string;
}

export interface ModelResponse {
  content: string;
}

export interface ModelClient {
  generate(request: ModelRequest): Promise<ModelResponse>;
}

export class MockModelClient implements ModelClient {
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const loreLine =
      request.matchedLoreEntries.length > 0
        ? ` I am keeping ${request.matchedLoreEntries.length} lore note(s) in view.`
        : "";
    const sceneLine =
      request.state.currentScene.length > 0
        ? ` The current scene still feels like ${request.state.currentScene}.`
        : "";
    const response = `${request.character.name}: "${this.answerSeed(
      request.userInput,
    )}"${loreLine}${sceneLine}`;

    return { content: response };
  }

  private answerSeed(userInput: string): string {
    const trimmed = userInput.trim();

    if (trimmed.endsWith("?")) {
      return "That is the correct question, which is rarely the same as a safe one.";
    }

    if (trimmed.length === 0) {
      return "Say that again with a little more courage.";
    }

    return "I heard you. Let us treat that as evidence and proceed carefully.";
  }
}
