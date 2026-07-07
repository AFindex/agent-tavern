import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type {
  CharacterProfile,
  ChatMessage,
  ConversationConfig,
  ConversationEvent,
  ConversationState,
  Lorebook,
  Settings,
} from "../types.js";
import { createConversationId, createEventId, nowIso } from "../lib/ids.js";
import { stringifyJson } from "../lib/json.js";

export interface CreateConversationInput {
  title?: string;
  characterId: string;
  lorebookIds?: string[];
}

export class WorkspaceStore {
  readonly rootDir: string;
  readonly dataDir: string;
  readonly workspacesDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.dataDir = path.join(rootDir, "data");
    this.workspacesDir = path.join(rootDir, "workspaces");
  }

  async ensureInitialized(): Promise<void> {
    await mkdir(this.characterDir(), { recursive: true });
    await mkdir(this.lorebookDir(), { recursive: true });
    await mkdir(this.workspacesDir, { recursive: true });
  }

  async saveCharacter(character: CharacterProfile): Promise<void> {
    await this.ensureInitialized();
    await writeFile(
      path.join(this.characterDir(), `${character.id}.json`),
      stringifyJson(character),
      "utf8",
    );
  }

  async loadCharacter(id: string): Promise<CharacterProfile> {
    const raw = await readFile(path.join(this.characterDir(), `${id}.json`), "utf8");
    return JSON.parse(raw) as CharacterProfile;
  }

  async listCharacters(): Promise<CharacterProfile[]> {
    await this.ensureInitialized();
    const files = await listJsonFiles(this.characterDir());
    const characters = await Promise.all(
      files.map(async (file) => {
        const raw = await readFile(path.join(this.characterDir(), file), "utf8");
        return JSON.parse(raw) as CharacterProfile;
      }),
    );

    return characters.sort((left, right) => left.name.localeCompare(right.name));
  }

  async saveLorebook(lorebook: Lorebook): Promise<void> {
    await this.ensureInitialized();
    await writeFile(
      path.join(this.lorebookDir(), `${lorebook.id}.json`),
      stringifyJson(lorebook),
      "utf8",
    );
  }

  async loadSettings(): Promise<Settings> {
    await this.ensureInitialized();
    try {
      const raw = await readFile(this.settingsPath(), "utf8");
      return JSON.parse(raw) as Settings;
    } catch {
      return {
        defaultModel: { provider: "mock", name: "mock-story-model" },
        providers: {
          pi: {},
          "openai-compatible": {},
        },
      };
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.ensureInitialized();
    await writeFile(this.settingsPath(), stringifyJson(settings), "utf8");
  }

  private settingsPath(): string {
    return path.join(this.dataDir, "settings.json");
  }

  async loadLorebook(id: string): Promise<Lorebook> {
    const raw = await readFile(path.join(this.lorebookDir(), `${id}.json`), "utf8");
    return JSON.parse(raw) as Lorebook;
  }

  async listLorebooks(): Promise<Lorebook[]> {
    await this.ensureInitialized();
    const files = await listJsonFiles(this.lorebookDir());
    const lorebooks = await Promise.all(
      files.map(async (file) => {
        const raw = await readFile(path.join(this.lorebookDir(), file), "utf8");
        return JSON.parse(raw) as Lorebook;
      }),
    );

    return lorebooks.sort((left, right) => left.name.localeCompare(right.name));
  }

  async createConversation(
    input: CreateConversationInput,
  ): Promise<ConversationConfig> {
    await this.ensureInitialized();

    const now = nowIso();
    const config: ConversationConfig = {
      id: createConversationId(),
      title: input.title ?? "Untitled Conversation",
      characterId: input.characterId,
      lorebookIds: input.lorebookIds ?? [],
      model: {
        provider: "mock",
        name: "mock-story-model",
      },
      createdAt: now,
      updatedAt: now,
    };

    await mkdir(this.conversationDir(config.id), { recursive: true });
    await mkdir(this.conversationArtifactsDir(config.id), { recursive: true });
    await this.saveConversationConfig(config);
    await this.saveConversationState(config.id, {
      turnCount: 0,
      summary: "",
      currentScene: "",
      variables: {},
      updatedAt: now,
    });
    await writeFile(this.eventsPath(config.id), "", "utf8");

    return config;
  }

  async loadConversationConfig(id: string): Promise<ConversationConfig> {
    const raw = await readFile(this.configPath(id), "utf8");
    return JSON.parse(raw) as ConversationConfig;
  }

  async listConversationConfigs(): Promise<ConversationConfig[]> {
    await this.ensureInitialized();
    const entries = await readdir(this.workspacesDir, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const configs: ConversationConfig[] = [];

    for (const dir of dirs) {
      try {
        configs.push(await this.loadConversationConfig(dir));
      } catch {
        continue;
      }
    }

    return configs.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async saveConversationConfig(config: ConversationConfig): Promise<void> {
    const updated: ConversationConfig = {
      ...config,
      updatedAt: nowIso(),
    };

    await mkdir(this.conversationDir(config.id), { recursive: true });
    await writeFile(this.configPath(config.id), stringifyJson(updated), "utf8");
  }

  async loadConversationState(id: string): Promise<ConversationState> {
    const raw = await readFile(this.statePath(id), "utf8");
    return JSON.parse(raw) as ConversationState;
  }

  async saveConversationState(
    id: string,
    state: ConversationState,
  ): Promise<void> {
    await mkdir(this.conversationDir(id), { recursive: true });
    await writeFile(this.statePath(id), stringifyJson(state), "utf8");
  }

  async appendEvent<TPayload>(
    conversationId: string,
    type: ConversationEvent<TPayload>["type"],
    payload: TPayload,
  ): Promise<ConversationEvent<TPayload>> {
    const event: ConversationEvent<TPayload> = {
      id: createEventId(),
      type,
      timestamp: nowIso(),
      payload,
    };

    await appendFile(
      this.eventsPath(conversationId),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );

    return event;
  }

  async loadEvents(id: string): Promise<ConversationEvent[]> {
    const raw = await readFile(this.eventsPath(id), "utf8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ConversationEvent);
  }

  async loadRecentMessages(id: string, limit: number): Promise<ChatMessage[]> {
    const events = await this.loadEvents(id);
    const messages: ChatMessage[] = [];

    for (const event of events) {
      if (event.type === "user_input" && hasContentPayload(event.payload)) {
        messages.push({
          role: "user",
          content: event.payload.content,
          timestamp: event.timestamp,
        });
      }

      if (event.type === "assistant_output" && hasContentPayload(event.payload)) {
        messages.push({
          role: "assistant",
          content: event.payload.content,
          timestamp: event.timestamp,
        });
      }
    }

    return messages.slice(-limit);
  }

  conversationDir(id: string): string {
    return path.join(this.workspacesDir, id);
  }

  conversationArtifactsDir(id: string): string {
    return path.join(this.conversationDir(id), "artifacts");
  }

  eventsPath(id: string): string {
    return path.join(this.conversationDir(id), "events.jsonl");
  }

  private characterDir(): string {
    return path.join(this.dataDir, "characters");
  }

  private lorebookDir(): string {
    return path.join(this.dataDir, "lorebooks");
  }

  private configPath(id: string): string {
    return path.join(this.conversationDir(id), "config.json");
  }

  private statePath(id: string): string {
    return path.join(this.conversationDir(id), "state.json");
  }
}

function hasContentPayload(value: unknown): value is { content: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    typeof value.content === "string"
  );
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
