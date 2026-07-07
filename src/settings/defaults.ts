import type { ModelProvider, Settings } from "../types.js";

export interface ProviderPreset {
  id: ModelProvider;
  label: string;
  defaultModel: string;
  baseUrl: string;
  models: string[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "mock",
    label: "Mock",
    defaultModel: "mock-story-model",
    baseUrl: "",
    models: ["mock-story-model"],
  },
  {
    id: "pi",
    label: "Pi",
    defaultModel: "pi-default",
    baseUrl: "",
    models: ["pi-default"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  },
  {
    id: "kimi",
    label: "Kimi",
    defaultModel: "kimi-k2.6",
    baseUrl: "https://api.moonshot.ai/v1",
    models: [
      "kimi-k2.6",
      "kimi-k2.5",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "moonshot-v1",
    ],
  },
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    defaultModel: "",
    baseUrl: "",
    models: [],
  },
];

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: { provider: "mock", name: "mock-story-model" },
  providers: {
    mock: {
      model: "mock-story-model",
    },
    pi: {
      model: "pi-default",
    },
    deepseek: {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      temperature: 1,
      topP: 1,
      maxTokens: 1_000_000,
      responseFormat: "text",
      stream: false,
      includeUsage: true,
      thinking: "enabled",
      reasoningEffort: "high",
      toolChoice: "auto",
      timeoutMs: 120000,
    },
    kimi: {
      baseUrl: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
      temperature: 0.6,
      topP: 0.95,
      maxCompletionTokens: 4096,
      responseFormat: "text",
      stream: false,
      includeUsage: true,
      thinking: "disabled",
      thinkingKeep: "all",
      toolChoice: "auto",
      timeoutMs: 120000,
    },
    "openai-compatible": {
      model: "",
      temperature: 0.7,
      topP: 1,
      maxTokens: 4096,
      responseFormat: "text",
      stream: false,
      includeUsage: true,
      toolChoice: "auto",
      timeoutMs: 120000,
    },
  },
  generation: {
    temperature: 0.7,
    topP: 1,
    maxOutputTokens: 4096,
    responseFormat: "text",
    stream: false,
    stopSequences: [],
  },
  agent: {
    recentMessageLimit: 12,
    maxLoreEntries: 8,
    userName: "User",
    loreScanDepth: 4,
    loreRecursiveScanning: true,
    loreMaxRecursionSteps: 3,
    loreCaseSensitive: false,
    loreMatchWholeWords: true,
    regexScripts: [],
    storePromptTrace: true,
    validationEnabled: true,
    maxOutputChars: 4000,
    autoUpdateState: true,
    summaryMaxChars: 1200,
  },
  workspace: {
    eventPreviewLimit: 80,
    redactApiKeys: true,
    defaultConversationTitle: "Conversation",
  },
  appearance: {
    customCss: "",
    tavernMessageStyle: true,
    showAvatars: true,
  },
};

export function createDefaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

export function normalizeSettings(value: unknown): Settings {
  const defaults = createDefaultSettings();

  if (!isRecord(value)) {
    return defaults;
  }

  const incoming = value as Partial<Settings>;

  return {
    defaultModel: {
      ...defaults.defaultModel,
      ...readRecord(incoming.defaultModel),
    },
    providers: mergeProviders(defaults.providers, incoming.providers),
    generation: {
      ...defaults.generation,
      ...readRecord(incoming.generation),
    },
    agent: {
      ...defaults.agent,
      ...readRecord(incoming.agent),
    },
    workspace: {
      ...defaults.workspace,
      ...readRecord(incoming.workspace),
    },
    appearance: {
      ...defaults.appearance,
      ...readRecord(incoming.appearance),
    },
  };
}

export function getProviderPreset(provider: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === provider);
}

function mergeProviders(
  defaults: Settings["providers"],
  incoming: unknown,
): Settings["providers"] {
  const providers: Settings["providers"] = { ...defaults };

  if (!isRecord(incoming)) {
    return providers;
  }

  for (const [key, value] of Object.entries(incoming)) {
    providers[key] = {
      ...providers[key],
      ...readRecord(value),
    };
  }

  return providers;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
