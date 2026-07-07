import type {
  CharacterProfile,
  ChatMessage,
  ModelConfig,
  ModelProvider,
  ProviderConfig,
  ConversationState,
  LorebookEntry,
  Settings,
} from "../types.js";
import { getProviderPreset } from "../settings/defaults.js";

export interface ModelRequest {
  character: CharacterProfile;
  state: ConversationState;
  recentMessages: ChatMessage[];
  matchedLoreEntries: LorebookEntry[];
  prompt: string;
  userInput: string;
  model: ModelConfig;
  settings: Settings;
}

export interface ModelResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ModelClient {
  generate(request: ModelRequest): Promise<ModelResponse>;
}

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionChoice {
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
  };
  delta?: {
    content?: string | null;
  };
}

interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
  error?: {
    message?: string;
    type?: string;
  };
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

export class RuntimeModelClient implements ModelClient {
  private readonly mock = new MockModelClient();

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.model.provider === "mock") {
      return this.mock.generate(request);
    }

    const provider = request.model.provider;
    const providerConfig = request.settings.providers[provider] ?? {};

    if (provider === "deepseek") {
      return generateOpenAICompatible(request, provider, providerConfig);
    }

    if (provider === "kimi") {
      return generateOpenAICompatible(request, provider, providerConfig);
    }

    if (provider === "openai-compatible" || provider === "pi") {
      return generateOpenAICompatible(request, provider, providerConfig);
    }

    return assertNeverProvider(provider);
  }
}

async function generateOpenAICompatible(
  request: ModelRequest,
  provider: ModelProvider,
  providerConfig: ProviderConfig,
): Promise<ModelResponse> {
  const apiKey = resolveApiKey(provider, providerConfig);
  if (!apiKey) {
    throw new Error(`${provider} API key is missing.`);
  }

  const baseUrl = resolveBaseUrl(provider, providerConfig);
  if (!baseUrl) {
    throw new Error(`${provider} base URL is missing.`);
  }

  const model = resolveModelName(request, provider, providerConfig);
  if (!model) {
    throw new Error(`${provider} model is missing.`);
  }

  const body = buildChatBody(request, provider, providerConfig, model);
  const response = await fetch(chatCompletionsUrl(baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(providerConfig.timeoutMs ?? 120000),
  });
  const json = (await response.json().catch(() => null)) as
    | ChatCompletionResponse
    | null;

  if (!response.ok) {
    const message = json?.error?.message ?? response.statusText;
    throw new Error(`${provider} API error ${response.status}: ${message}`);
  }

  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`${provider} returned an empty response.`);
  }

  const usage = json?.usage;
  if (
    usage &&
    typeof usage.prompt_tokens === "number" &&
    typeof usage.completion_tokens === "number" &&
    typeof usage.total_tokens === "number"
  ) {
    return {
      content,
      usage: {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
    };
  }

  return { content };
}

function buildChatBody(
  request: ModelRequest,
  provider: ModelProvider,
  providerConfig: ProviderConfig,
  model: string,
): Record<string, unknown> {
  const generation = request.settings.generation;
  const messages: ChatCompletionMessage[] = [
    {
      role: "system",
      content: [
        "You are an agentic roleplay/storytelling runtime.",
        "Use the runtime context faithfully.",
        "Reply only with the final assistant message for the active character.",
      ].join(" "),
    },
    {
      role: "user",
      content: request.prompt,
    },
  ];
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };

  const temperature = providerConfig.temperature ?? generation.temperature;
  const topP = providerConfig.topP ?? generation.topP;
  const responseFormat = providerConfig.responseFormat ?? generation.responseFormat;
  const stopSequences = providerConfig.stopSequences ?? generation.stopSequences;

  body.temperature = temperature;
  body.top_p = topP;

  if (responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  if (stopSequences.length > 0) {
    body.stop = stopSequences;
  }

  if (provider === "kimi") {
    body.max_completion_tokens =
      providerConfig.maxCompletionTokens ?? generation.maxOutputTokens;
    applyKimiExtensions(body, providerConfig, model);
    return body;
  }

  // Default max_tokens to 1M and cap user input at 1M so providers like
  // DeepSeek can be asked for long context/output windows without the
  // runtime silently constraining them.
  const ONE_MILLION_TOKENS = 1_000_000;
  const configuredMaxTokens = providerConfig.maxTokens ?? ONE_MILLION_TOKENS;
  body.max_tokens = Math.max(1, Math.min(configuredMaxTokens, ONE_MILLION_TOKENS));

  if (provider === "deepseek") {
    body.thinking = { type: providerConfig.thinking ?? "enabled" };
    if ((providerConfig.thinking ?? "enabled") === "enabled") {
      body.reasoning_effort = providerConfig.reasoningEffort ?? "high";
    }
  }

  return body;
}

function applyKimiExtensions(
  body: Record<string, unknown>,
  providerConfig: ProviderConfig,
  model: string,
): void {
  if (model.startsWith("kimi-k2.7-code")) {
    body.thinking = { type: "enabled", keep: "all" };
  } else if (model === "kimi-k2.6") {
    body.thinking = { type: providerConfig.thinking ?? "disabled" };
  }

  if (providerConfig.promptCacheKey) {
    body.prompt_cache_key = providerConfig.promptCacheKey;
  }

  if (providerConfig.safetyIdentifier) {
    body.safety_identifier = providerConfig.safetyIdentifier;
  }
}

function resolveModelName(
  request: ModelRequest,
  provider: ModelProvider,
  providerConfig: ProviderConfig,
): string {
  if (request.model.name.length > 0) {
    return request.model.name;
  }

  if (providerConfig.model && providerConfig.model.length > 0) {
    return providerConfig.model;
  }

  return getProviderPreset(provider)?.defaultModel ?? "";
}

function resolveBaseUrl(
  provider: ModelProvider,
  providerConfig: ProviderConfig,
): string {
  if (providerConfig.baseUrl && providerConfig.baseUrl.length > 0) {
    return providerConfig.baseUrl;
  }

  return getProviderPreset(provider)?.baseUrl ?? "";
}

function resolveApiKey(
  provider: ModelProvider,
  providerConfig: ProviderConfig,
): string {
  if (providerConfig.apiKey && providerConfig.apiKey.length > 0) {
    return providerConfig.apiKey;
  }

  if (provider === "deepseek") {
    return process.env.DEEPSEEK_API_KEY ?? "";
  }

  if (provider === "kimi") {
    return process.env.MOONSHOT_API_KEY ?? process.env.KIMI_API_KEY ?? "";
  }

  return process.env.OPENAI_API_KEY ?? "";
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");

  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

function assertNeverProvider(provider: never): never {
  throw new Error(`Unsupported model provider: ${provider}`);
}
