import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { cwd, exit } from "node:process";

import { AgentRuntime } from "./agent/pipeline.js";
import { RuntimeModelClient } from "./agent/model.js";
import { nowIso } from "./lib/ids.js";
import { readJsonFile } from "./lib/json.js";
import { normalizeSettings } from "./settings/defaults.js";
import { normalizeCharacterCard } from "./st/character-card.js";
import { normalizeLorebook } from "./st/lorebook.js";
import { WorkspaceStore } from "./storage/workspace.js";
import type {
  CharacterProfile,
  ChatMessage,
  ConversationConfig,
  ConversationEvent,
  ConversationState,
  JsonValue,
  Lorebook,
  LorebookEntry,
  Settings,
} from "./types.js";

interface ConversationSnapshot {
  config: ConversationConfig;
  state: ConversationState;
  events: ConversationEvent[];
  messages: ChatMessage[];
  character: CharacterProfile;
  lorebooks: Lorebook[];
  matchedLoreEntries: LorebookEntry[];
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
const runtime = new AgentRuntime(store, new RuntimeModelClient());
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
    await store.saveCharacter(character);
    sendJson(response, 200, { character, overview: await loadOverview() });
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
    await store.loadCharacter(characterId);

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
    const result = await runtime.handleUserInput({
      conversationId: sendMatch[1],
      text,
    });

    sendJson(response, 200, {
      result,
      snapshot: await loadSnapshot(sendMatch[1]),
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
    workspacePath: store.conversationDir(conversationId),
  };
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

  await runtime.handleUserInput({
    conversationId: config.id,
    text: "The old clock tower is acting strange.",
  });

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
