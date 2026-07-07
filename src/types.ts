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
  alternateGreetings: string[];
  messageExamples: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  creator: string;
  characterVersion: string;
  tags: string[];
  regexScripts: RegexScript[];
  extensions: Record<string, JsonValue>;
  source: AssetSource;
}

export type LorebookPosition =
  | "before_char"
  | "after_char"
  | "before_example"
  | "after_example"
  | "top_an"
  | "bottom_an"
  | "at_depth"
  | "outlet";

export type SelectiveLogic =
  | "and_any"
  | "and_all"
  | "not_any"
  | "not_all";

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
  selectiveLogic: SelectiveLogic;
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  scanDepth?: number;
  position: LorebookPosition;
  depth?: number;
  outletName?: string;
  probability: number;
  useProbability: boolean;
  group: string;
  groupWeight: number;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: boolean;
  priority: number;
  insertionOrder: number;
  extensions: Record<string, JsonValue>;
}

export interface Lorebook {
  id: string;
  name: string;
  description: string;
  scanDepth?: number;
  tokenBudget?: number;
  recursiveScanning?: boolean;
  extensions: Record<string, JsonValue>;
  entries: LorebookEntry[];
  source: AssetSource;
}

export type ModelProvider =
  | "mock"
  | "pi"
  | "deepseek"
  | "kimi"
  | "openai-compatible";

export type ResponseFormatType = "text" | "json_object";
export type ThinkingType = "enabled" | "disabled";
export type ReasoningEffort = "high" | "max";
export type ToolChoiceMode = "none" | "auto" | "required";

export interface ModelConfig {
  provider: ModelProvider;
  name: string;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  responseFormat?: ResponseFormatType;
  stream?: boolean;
  includeUsage?: boolean;
  stopSequences?: string[];
  timeoutMs?: number;
  toolChoice?: ToolChoiceMode;
  thinking?: ThinkingType;
  reasoningEffort?: ReasoningEffort;
  thinkingKeep?: "all";
  promptCacheKey?: string;
  safetyIdentifier?: string;
  notes?: string;
}

export interface GenerationSettings {
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  responseFormat: ResponseFormatType;
  stream: boolean;
  stopSequences: string[];
}

export interface AgentSettings {
  recentMessageLimit: number;
  maxLoreEntries: number;
  userName: string;
  loreScanDepth: number;
  loreRecursiveScanning: boolean;
  loreMaxRecursionSteps: number;
  loreCaseSensitive: boolean;
  loreMatchWholeWords: boolean;
  regexScripts: RegexScript[];
  storePromptTrace: boolean;
  validationEnabled: boolean;
  maxOutputChars: number;
  autoUpdateState: boolean;
  summaryMaxChars: number;
}

export type RegexMacroMode = "none" | "raw" | "escaped";

export type RegexTarget =
  | "userInput"
  | "aiResponse"
  | "slashCommand"
  | "worldInfo"
  | "prompt"
  | "reasoning"
  | "display";

export interface RegexScript {
  id: string;
  name: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  disabled: boolean;
  runOnEdit: boolean;
  macrosInFind: RegexMacroMode;
  affects: Record<RegexTarget, boolean>;
  alterOutgoingPrompt: boolean;
  alterDisplay: boolean;
  minDepth?: number;
  maxDepth?: number;
}

export interface WorkspaceSettings {
  eventPreviewLimit: number;
  redactApiKeys: boolean;
  defaultConversationTitle: string;
}

export interface Settings {
  defaultModel: ModelConfig;
  providers: Record<string, ProviderConfig>;
  generation: GenerationSettings;
  agent: AgentSettings;
  workspace: WorkspaceSettings;
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

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentTurnResult {
  conversationId: string;
  output: string;
  matchedLoreEntries: LorebookEntry[];
  validation: ValidationResult;
  tokenUsage?: TokenUsage;
}

