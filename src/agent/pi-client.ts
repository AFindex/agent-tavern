import type {
  Context,
  Message,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { StreamFn } from "@earendil-works/pi-agent-core";

import { getProviderPreset } from "../settings/defaults.js";
import type {
  ChatMessage,
  ModelConfig,
  Settings,
} from "../types.js";

const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_MAX_TOKENS = 1_000_000;

export function createPiStreamFn(settings: Settings): StreamFn {
  return (model, context, options) => {
    if (model.provider === "mock") {
      return createMockStream(model, context);
    }

    const providerConfig = settings.providers[model.provider];
    if (!providerConfig?.apiKey) {
      throw new Error(`${model.provider} API key is missing.`);
    }

    return openAICompletionsApi().streamSimple(model, context, {
      ...options,
      apiKey: providerConfig.apiKey,
      maxTokens:
        providerConfig.maxTokens ?? settings.generation.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
      temperature: providerConfig.temperature ?? settings.generation.temperature,
      maxRetryDelayMs: providerConfig.timeoutMs,
    });
  };
}

function createMockStream(
  model: Model<any>,
  context: Context,
): ReturnType<StreamFn> {
  const text = createMockReply(context);
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: estimateTextTokens(context.systemPrompt ?? ""),
      output: estimateTextTokens(text),
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens:
        estimateTextTokens(context.systemPrompt ?? "") + estimateTextTokens(text),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };

  return ({
    async *[Symbol.asyncIterator]() {
      yield { type: "start" as const, partial: message };
      yield { type: "text_start" as const, contentIndex: 0, partial: message };
      yield {
        type: "text_delta" as const,
        contentIndex: 0,
        delta: text,
        partial: message,
      };
      yield {
        type: "text_end" as const,
        contentIndex: 0,
        content: text,
        partial: message,
      };
      yield { type: "done" as const, reason: "stop" as const, message };
    },
    async result() {
      return message;
    },
  } as unknown) as ReturnType<StreamFn>;
}

function createMockReply(context: Context): string {
  const lastUser = [...context.messages]
    .reverse()
    .find((message) => message.role === "user");
  const input =
    typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("")
        : "";

  if (input.length === 0) {
    return "The room waits in a careful hush.";
  }

  return `*The scene catches on the detail you offered.*\n\n${input}\n\n\"I noticed that,\" the character says, keeping the thread of the moment alive.`;
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createPiModel(
  config: ModelConfig,
  settings: Settings,
): Model<"openai-completions"> {
  const providerConfig = settings.providers[config.provider];
  const baseUrl =
    providerConfig?.baseUrl?.trim() ||
    getProviderPreset(config.provider)?.baseUrl ||
    "";

  return {
    id: config.name,
    name: config.name,
    api: "openai-completions",
    provider: config.provider,
    baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: providerConfig?.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

export function chatMessagesToPiMessages(
  messages: ChatMessage[],
  provider: string,
  modelId: string,
): Message[] {
  return messages.map((message) => {
    const timestamp = new Date(message.timestamp).getTime();
    if (message.role === "user") {
      return {
        role: "user",
        content: message.content,
        timestamp,
      };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: [{ type: "text", text: message.content }],
        api: "openai-completions",
        provider,
        model: modelId,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp,
      };
    }
    // Tool messages from legacy storage don't carry toolCallId; treat as user.
    return {
      role: "user",
      content: `[tool result] ${message.content}`,
      timestamp,
    };
  });
}

export function buildPiContext(
  systemPrompt: string,
  messages: ChatMessage[],
  provider: string,
  modelId: string,
  tools: unknown[],
): Context {
  return {
    systemPrompt,
    messages: chatMessagesToPiMessages(messages, provider, modelId),
    tools: tools.length > 0 ? (tools as any) : undefined,
  };
}
