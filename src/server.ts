import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { cwd, exit } from "node:process";
import { WebSocketServer, WebSocket } from "ws";

import { PiRuntime } from "./agent/pi-runtime.js";
import { nowIso } from "./lib/ids.js";
import { readJsonFile } from "./lib/json.js";
import { normalizeSettings } from "./settings/defaults.js";
import {
  normalizeCharacterCard,
  normalizeEmbeddedCharacterBook,
} from "./st/character-card.js";
import { normalizeLorebook } from "./st/lorebook.js";
import { renderOpeningMessage } from "./st/prompt.js";
import { WorkspaceStore } from "./storage/workspace.js";
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
  TokenUsage,
} from "./types.js";

interface ConversationSnapshot {
  config: ConversationConfig;
  state: ConversationState;
  events: ConversationEvent[];
  messages: ChatMessage[];
  character: CharacterProfile;
  lorebooks: Lorebook[];
  matchedLoreEntries: LorebookEntry[];
  tokenUsage?: TokenUsage;
  workspacePath: string;
}

interface OverviewResponse {
  characters: CharacterProfile[];
  lorebooks: Lorebook[];
  conversations: ConversationConfig[];
}

interface ImportBody {
  raw: unknown;
  sourceName?: string;
}

interface CreateConversationBody {
  title?: string;
  characterId?: string;
  lorebookIds?: string[];
}

interface SendMessageBody {
  text?: string;
}

interface UpdateConfigBody {
  title?: string;
  characterId?: string;
  lorebookIds?: string[];
  model?: ConversationConfig["model"];
}

interface UpdateStateBody {
  summary?: string;
  currentScene?: string;
  variables?: Record<string, JsonValue>;
}

interface UpdateLorebookBody {
  entries?: LorebookEntry[];
}

interface UpdateSettingsBody {
  defaultModel?: ConversationConfig["model"];
  providers?: Settings["providers"];
  generation?: Settings["generation"];
  agent?: Settings["agent"];
  workspace?: Settings["workspace"];
}

const store = new WorkspaceStore(cwd());
const settings = await store.loadSettings();
const piRuntime = new PiRuntime({ store, settings });
const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message });
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `API port ${port} is already in use. Run "npm run dev:stop" to clear local dev servers, or set PORT to another value.`,
    );
    exit(1);
  }

  throw error;
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, request) => {
  const conversationId = extractStreamConversationId(request.url, request.headers.host);
  if (!conversationId) {
    ws.close(1002, "Invalid stream path");
    return;
  }

  let running = false;

  ws.on("message", async (data) => {
    if (running) {
      sendWsError(ws, "A turn is already in progress.");
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(String(data));
    } catch {
      sendWsError(ws, "Invalid JSON.");
      return;
    }

    if (
      typeof message !== "object" ||
      message === null ||
      (message as Record<string, unknown>).type !== "send" ||
      typeof (message as Record<string, unknown>).text !== "string"
    ) {
      sendWsError(ws, "Expected { type: 'send', text: string }.");
      return;
    }

    const text = String((message as Record<string, unknown>).text).trim();
    if (text.length === 0) {
      sendWsError(ws, "Message text is required.");
      return;
    }

    running = true;
    try {
      const success = await piRuntime.runTurn(conversationId, text, (event) => {
        sendWs(ws, event);
      });
      if (success) {
        sendWs(ws, {
          type: "done",
          snapshot: await loadSnapshot(conversationId),
          overview: await loadOverview(),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendWsError(ws, message);
    } finally {
      running = false;
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

server.on("upgrade", (request, socket, head) => {
  const conversationId = extractStreamConversationId(request.url, request.headers.host);
  if (!conversationId) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`API server listening at http://127.0.0.1:${port}`);
});

async function route(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "127.0.0.1"}`,
  );

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/overview") {
    sendJson(response, 200, await loadOverview());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/settings") {
    sendJson(response, 200, await store.loadSettings());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const body = await readBody<UpdateSettingsBody>(request);
    const settings = await store.loadSettings();
    const nextSettings = normalizeSettings({
      ...settings,
      ...body,
      defaultModel: body.defaultModel ?? settings.defaultModel,
      providers: body.providers ?? settings.providers,
      generation: body.generation ?? settings.generation,
      agent: body.agent ?? settings.agent,
      workspace: body.workspace ?? settings.workspace,
    });

    await store.saveSettings(nextSettings);
    piRuntime.setSettings(nextSettings);
    sendJson(response, 200, nextSettings);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/demo") {
    sendJson(response, 200, await runDemoTurn());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/import/character") {
    const body = await readBody<ImportBody>(request);
    const character = normalizeCharacterCard(body.raw, body.sourceName);
    const lorebook = normalizeEmbeddedCharacterBook(body.raw, body.sourceName);
    await store.saveCharacter(character);
    if (lorebook) {
      await store.saveLorebook(lorebook);
    }
    sendJson(response, 200, {
      character,
      lorebook,
      overview: await loadOverview(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/import/lorebook") {
    const body = await readBody<ImportBody>(request);
    const lorebook = normalizeLorebook(body.raw, body.sourceName);
    await store.saveLorebook(lorebook);
    sendJson(response, 200, { lorebook, overview: await loadOverview() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/conversations") {
    const body = await readBody<CreateConversationBody>(request);
    const characterId = requireString(body.characterId, "characterId");
    const lorebookIds = Array.isArray(body.lorebookIds) ? body.lorebookIds : [];
    const character = await store.loadCharacter(characterId);

    for (const lorebookId of lorebookIds) {
      await store.loadLorebook(lorebookId);
    }

    const settings = await store.loadSettings();
    const config = await store.createConversation({
      title: body.title?.trim() || settings.workspace.defaultConversationTitle,
      characterId,
      lorebookIds,
    });
    config.model = settings.defaultModel;
    await store.saveConversationConfig(config);
    await store.seedOpeningMessage(
      config.id,
      renderOpeningMessage(
        character,
        settings,
        await store.loadConversationState(config.id),
      ),
    );

    sendJson(response, 200, {
      snapshot: await loadSnapshot(config.id),
      overview: await loadOverview(),
    });
    return;
  }

  const snapshotMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (request.method === "GET" && snapshotMatch) {
    sendJson(response, 200, await loadSnapshot(snapshotMatch[1]));
    return;
  }

  const sendMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/send$/);
  if (request.method === "POST" && sendMatch) {
    const body = await readBody<SendMessageBody>(request);
    const text = requireString(body.text, "text");
    const conversationId = sendMatch[1];
    const success = await piRuntime.runTurn(conversationId, text, () => undefined);
    if (!success) {
      throw new Error("Assistant turn failed.");
    }

    const snapshot = await loadSnapshot(conversationId);
    sendJson(response, 200, {
      result: buildTurnResult(conversationId, snapshot),
      snapshot,
      overview: await loadOverview(),
    });
    return;
  }

  const configMatch = url.pathname.match(
    /^\/api\/conversations\/([^/]+)\/config$/,
  );
  if (request.method === "PATCH" && configMatch) {
    const body = await readBody<UpdateConfigBody>(request);
    const config = await store.loadConversationConfig(configMatch[1]);

    if (body.title !== undefined) {
      config.title = body.title.trim() || config.title;
    }
    if (body.characterId !== undefined) {
      config.characterId = body.characterId;
    }
    if (body.lorebookIds !== undefined) {
      config.lorebookIds = body.lorebookIds;
    }
    if (body.model !== undefined) {
      config.model = body.model;
    }

    await store.saveConversationConfig(config);
    sendJson(response, 200, {
      snapshot: await loadSnapshot(config.id),
      overview: await loadOverview(),
    });
    return;
  }

  const stateMatch = url.pathname.match(
    /^\/api\/conversations\/([^/]+)\/state$/,
  );
  if (request.method === "PATCH" && stateMatch) {
    const body = await readBody<UpdateStateBody>(request);
    const state = await store.loadConversationState(stateMatch[1]);

    if (body.summary !== undefined) {
      state.summary = body.summary;
    }
    if (body.currentScene !== undefined) {
      state.currentScene = body.currentScene;
    }
    if (body.variables !== undefined) {
      state.variables = body.variables;
    }
    state.updatedAt = nowIso();

    await store.saveConversationState(stateMatch[1], state);
    sendJson(response, 200, {
      snapshot: await loadSnapshot(stateMatch[1]),
      overview: await loadOverview(),
    });
    return;
  }

  const lorebookMatch = url.pathname.match(/^\/api\/lorebooks\/([^/]+)$/);
  if (request.method === "PATCH" && lorebookMatch) {
    const body = await readBody<UpdateLorebookBody>(request);
    const lorebook = await store.loadLorebook(lorebookMatch[1]);

    if (body.entries !== undefined) {
      lorebook.entries = body.entries;
    }

    await store.saveLorebook(lorebook);
    sendJson(response, 200, {
      lorebook,
      overview: await loadOverview(),
    });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function loadOverview(): Promise<OverviewResponse> {
  return {
    characters: await store.listCharacters(),
    lorebooks: await store.listLorebooks(),
    conversations: await store.listConversationConfigs(),
  };
}

async function loadSnapshot(conversationId: string): Promise<ConversationSnapshot> {
  const settings = await store.loadSettings();
  const config = await store.loadConversationConfig(conversationId);
  const state = await store.loadConversationState(conversationId);
  const allEvents = await store.loadEvents(conversationId);
  const events = allEvents.slice(-settings.workspace.eventPreviewLimit);
  const messages = await store.loadRecentMessages(conversationId, 80);
  const character = await store.loadCharacter(config.characterId);
  const lorebooks = await Promise.all(
    config.lorebookIds.map((id) => store.loadLorebook(id)),
  );

  return {
    config,
    state,
    events,
    messages,
    character,
    lorebooks,
    matchedLoreEntries: resolveMatchedLoreEntries(allEvents, lorebooks),
    tokenUsage: resolveLatestTokenUsage(allEvents),
    workspacePath: store.conversationDir(conversationId),
  };
}

function resolveLatestTokenUsage(
  events: ConversationEvent[],
): TokenUsage | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event.type !== "assistant_output" ||
      typeof event.payload !== "object" ||
      event.payload === null
    ) {
      continue;
    }

    const payload = event.payload as Record<string, unknown>;
    const usage = payload.tokenUsage;
    if (
      typeof usage !== "object" ||
      usage === null
    ) {
      continue;
    }

    const usageRecord = usage as Record<string, unknown>;
    const promptTokens = Number(usageRecord.promptTokens);
    const completionTokens = Number(usageRecord.completionTokens);
    const totalTokens = Number(usageRecord.totalTokens);
    if (
      Number.isFinite(promptTokens) &&
      Number.isFinite(completionTokens) &&
      Number.isFinite(totalTokens)
    ) {
      return { promptTokens, completionTokens, totalTokens };
    }
  }

  return undefined;
}

async function runDemoTurn(): Promise<{
  snapshot: ConversationSnapshot;
  overview: OverviewResponse;
}> {
  const characterPath = path.join(cwd(), "samples", "character-card.json");
  const lorebookPath = path.join(cwd(), "samples", "lorebook.json");
  const character = normalizeCharacterCard(
    await readJsonFile(characterPath),
    characterPath,
  );
  const lorebook = normalizeLorebook(await readJsonFile(lorebookPath), lorebookPath);

  await store.saveCharacter(character);
  await store.saveLorebook(lorebook);

  const settings = await store.loadSettings();
  const config = await store.createConversation({
    title: "Demo Conversation",
    characterId: character.id,
    lorebookIds: [lorebook.id],
  });
  config.model = settings.defaultModel;
  await store.saveConversationConfig(config);
  await store.seedOpeningMessage(
    config.id,
    renderOpeningMessage(
      character,
      settings,
      await store.loadConversationState(config.id),
    ),
  );

  const success = await piRuntime.runTurn(
    config.id,
    "The old clock tower is acting strange.",
    () => undefined,
  );
  if (!success) {
    throw new Error("Demo turn failed.");
  }

  return {
    snapshot: await loadSnapshot(config.id),
    overview: await loadOverview(),
  };
}

async function readBody<T>(request: IncomingMessage): Promise<T> {
  let raw = "";

  for await (const chunk of request) {
    raw += chunk;
  }

  if (raw.trim().length === 0) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type",
  });

  response.end(JSON.stringify(payload));
}

function buildTurnResult(
  conversationId: string,
  snapshot: ConversationSnapshot,
): AgentTurnResult {
  let output = "";
  for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
    const message = snapshot.messages[index];
    if (message.role === "assistant") {
      output = message.content;
      break;
    }
  }

  return {
    conversationId,
    output,
    matchedLoreEntries: snapshot.matchedLoreEntries,
    tokenUsage: snapshot.tokenUsage,
    validation: { passed: true, issues: [] },
  };
}

function extractStreamConversationId(
  urlString: string | undefined,
  host: string | undefined,
): string | undefined {
  const url = new URL(urlString ?? "/", `http://${host ?? "127.0.0.1"}`);
  const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/stream$/);
  return match?.[1];
}

function sendWs(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendWsError(ws: WebSocket, error: string): void {
  sendWs(ws, { type: "error", error });
}

function resolveMatchedLoreEntries(
  events: ConversationEvent[],
  lorebooks: Lorebook[],
): LorebookEntry[] {
  const ids = readLastMatchedLoreEntryIds(events);
  const entries = lorebooks.flatMap((lorebook) => lorebook.entries);

  return ids
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is LorebookEntry => Boolean(entry));
}

function readLastMatchedLoreEntryIds(events: ConversationEvent[]): string[] {
  const trace = events
    .slice()
    .reverse()
    .find((event) => event.type === "pipeline_trace");
  const payload = trace?.payload;

  if (
    typeof payload === "object" &&
    payload !== null &&
    "matchedLoreEntryIds" in payload &&
    Array.isArray(payload.matchedLoreEntryIds)
  ) {
    return payload.matchedLoreEntryIds.filter(
      (item): item is string => typeof item === "string",
    );
  }

  return [];
}
