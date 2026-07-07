import type {
  AgentTurnResult,
  CharacterProfile,
  ChatMessage,
  ConversationConfig,
  ConversationEvent,
  ConversationState,
  JsonValue,
  Lorebook,
  LorebookEntry,
  Settings,
} from "../types";

export interface Overview {
  characters: CharacterProfile[];
  lorebooks: Lorebook[];
  conversations: ConversationConfig[];
}

export interface ConversationSnapshot {
  config: ConversationConfig;
  state: ConversationState;
  events: ConversationEvent[];
  messages: ChatMessage[];
  character: CharacterProfile;
  lorebooks: Lorebook[];
  matchedLoreEntries: LorebookEntry[];
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  workspacePath: string;
}

export interface SendResponse {
  result: AgentTurnResult;
  snapshot: ConversationSnapshot;
  overview: Overview;
}

export type StreamEvent =
  | { type: "error"; error: string }
  | { type: "done"; snapshot: ConversationSnapshot; overview: Overview }
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "turn_start" }
  | { type: "turn_end" }
  | { type: "message_start"; message: unknown }
  | { type: "message_update"; assistantMessageEvent: unknown; message: unknown }
  | { type: "message_end"; message: unknown }
  | { type: "tool_execution_start"; toolCall: unknown }
  | { type: "tool_execution_update"; toolCall: unknown; result: unknown }
  | { type: "tool_execution_end"; toolCall: unknown; result: unknown };

export async function fetchOverview(): Promise<Overview> {
  return request<Overview>("/api/overview");
}

export async function fetchConversation(
  id: string,
): Promise<ConversationSnapshot> {
  return request<ConversationSnapshot>(`/api/conversations/${id}`);
}

export async function importCharacter(
  raw: unknown,
  sourceName: string,
): Promise<{
  character: CharacterProfile;
  lorebook?: Lorebook | null;
  overview: Overview;
}> {
  return request("/api/import/character", {
    method: "POST",
    body: JSON.stringify({ raw, sourceName }),
  });
}

export async function importLorebook(
  raw: unknown,
  sourceName: string,
): Promise<{ lorebook: Lorebook; overview: Overview }> {
  return request("/api/import/lorebook", {
    method: "POST",
    body: JSON.stringify({ raw, sourceName }),
  });
}

export async function createConversation(input: {
  title: string;
  characterId: string;
  lorebookIds: string[];
}): Promise<{ snapshot: ConversationSnapshot; overview: Overview }> {
  return request("/api/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function sendMessage(
  conversationId: string,
  text: string,
): Promise<SendResponse> {
  return request(`/api/conversations/${conversationId}/send`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export function streamMessage(
  conversationId: string,
  text: string,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/conversations/${conversationId}/stream`,
    );
    let settled = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "send", text }));
    };

    ws.onmessage = (event) => {
      let data: StreamEvent;
      try {
        data = JSON.parse(event.data as string) as StreamEvent;
      } catch {
        data = { type: "error", error: "Invalid message from server." };
      }

      onEvent(data);

      if (data.type === "done") {
        settled = true;
        ws.close();
        resolve();
      } else if (data.type === "error") {
        settled = true;
        ws.close();
        reject(new Error(data.error));
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        reject(new Error("WebSocket error."));
      }
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        reject(new Error("WebSocket closed unexpectedly."));
      }
    };
  });
}

export async function runDemo(): Promise<{
  snapshot: ConversationSnapshot;
  overview: Overview;
}> {
  return request("/api/demo", { method: "POST" });
}

export async function updateConversationConfig(
  conversationId: string,
  input: {
    title?: string;
    characterId?: string;
    lorebookIds?: string[];
    model?: ConversationConfig["model"];
  },
): Promise<{ snapshot: ConversationSnapshot; overview: Overview }> {
  return request(`/api/conversations/${conversationId}/config`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function updateConversationState(
  conversationId: string,
  input: {
    summary?: string;
    currentScene?: string;
    variables?: Record<string, JsonValue>;
  },
): Promise<{ snapshot: ConversationSnapshot; overview: Overview }> {
  return request(`/api/conversations/${conversationId}/state`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function updateLorebook(
  lorebookId: string,
  input: { entries?: LorebookEntry[] },
): Promise<{ lorebook: Lorebook; overview: Overview }> {
  return request(`/api/lorebooks/${lorebookId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function fetchSettings(): Promise<Settings> {
  return request<Settings>("/api/settings");
}

export async function updateSettings(
  input: Partial<Settings>,
): Promise<Settings> {
  return request("/api/settings", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  const text = await response.text();
  const data = text.length > 0 ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message = readErrorMessage(data);
    throw new Error(message);
  }

  return data as T;
}

function readErrorMessage(data: unknown): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    return data.error;
  }

  return "Request failed.";
}
