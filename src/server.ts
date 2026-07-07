import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { cwd } from "node:process";

import { AgentRuntime } from "./agent/pipeline.js";
import { MockModelClient } from "./agent/model.js";
import { readJsonFile } from "./lib/json.js";
import { normalizeCharacterCard } from "./st/character-card.js";
import { normalizeLorebook } from "./st/lorebook.js";
import { WorkspaceStore } from "./storage/workspace.js";
import type {
  CharacterProfile,
  ChatMessage,
  ConversationConfig,
  ConversationEvent,
  ConversationState,
  Lorebook,
  LorebookEntry,
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

const store = new WorkspaceStore(cwd());
const runtime = new AgentRuntime(store, new MockModelClient());
const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message });
  }
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

    const config = await store.createConversation({
      title: body.title?.trim() || "Conversation",
      characterId,
      lorebookIds,
    });

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
  const config = await store.loadConversationConfig(conversationId);
  const state = await store.loadConversationState(conversationId);
  const events = await store.loadEvents(conversationId);
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
    matchedLoreEntries: resolveMatchedLoreEntries(events, lorebooks),
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

  const config = await store.createConversation({
    title: "Demo Conversation",
    characterId: character.id,
    lorebookIds: [lorebook.id],
  });

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
    "access-control-allow-methods": "GET,POST,OPTIONS",
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
