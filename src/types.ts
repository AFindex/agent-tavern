export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface AssetSource {
  kind: "sillytavern" | "internal";
  path?: string;
  importedAt: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  messageExamples: string;
  systemPrompt: string;
  creatorNotes: string;
  extensions: Record<string, JsonValue>;
  source: AssetSource;
}

export interface LorebookEntry {
  id: string;
  uid: number;
  title: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  priority: number;
  insertionOrder: number;
}

export interface Lorebook {
  id: string;
  name: string;
  entries: LorebookEntry[];
  source: AssetSource;
}

export interface ModelConfig {
  provider: "mock" | "pi" | "openai-compatible";
  name: string;
}

export interface ConversationConfig {
  id: string;
  title: string;
  characterId: string;
  lorebookIds: string[];
  model: ModelConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationState {
  turnCount: number;
  summary: string;
  currentScene: string;
  variables: Record<string, JsonValue>;
  updatedAt: string;
}

export type ConversationEventType =
  | "user_input"
  | "assistant_output"
  | "pipeline_trace"
  | "state_update";

export interface ConversationEvent<TPayload = JsonValue> {
  id: string;
  type: ConversationEventType;
  timestamp: string;
  payload: TPayload;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp: string;
}

export interface RetrievedContext {
  character: CharacterProfile;
  loreEntries: LorebookEntry[];
  recentMessages: ChatMessage[];
}

export interface AgentTurnInput {
  conversationId: string;
  text: string;
}

export interface ValidationResult {
  passed: boolean;
  issues: string[];
}

export interface AgentTurnResult {
  conversationId: string;
  output: string;
  matchedLoreEntries: LorebookEntry[];
  validation: ValidationResult;
}
