import path from "node:path";
import { cwd, exit } from "node:process";

import { PiRuntime } from "./agent/pi-runtime.js";
import { readJsonFile } from "./lib/json.js";
import {
  normalizeCharacterCard,
  normalizeEmbeddedCharacterBook,
} from "./st/character-card.js";
import { normalizeLorebook } from "./st/lorebook.js";
import { renderOpeningMessage } from "./st/prompt.js";
import { WorkspaceStore } from "./storage/workspace.js";

const store = new WorkspaceStore(cwd());
const settings = await store.loadSettings();
const piRuntime = new PiRuntime({ store, settings });

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;

  switch (command) {
    case "demo":
      await runDemo();
      return;
    case "import-character":
      await importCharacter(requiredArg(args, 0, "character card path"));
      return;
    case "import-lorebook":
      await importLorebook(requiredArg(args, 0, "lorebook path"));
      return;
    case "new-conversation":
      await newConversation(
        requiredArg(args, 0, "character id"),
        args.slice(1),
      );
      return;
    case "send":
      await sendMessage(
        requiredArg(args, 0, "conversation id"),
        args.slice(1).join(" "),
      );
      return;
    default:
      printHelp();
      exit(1);
  }
}

async function runDemo(): Promise<void> {
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
  const conversation = await store.createConversation({
    title: "Demo Conversation",
    characterId: character.id,
    lorebookIds: [lorebook.id],
  });
  conversation.model = settings.defaultModel;
  await store.saveConversationConfig(conversation);
  await store.seedOpeningMessage(
    conversation.id,
    renderOpeningMessage(
      character,
      settings,
      await store.loadConversationState(conversation.id),
    ),
  );

  const success = await piRuntime.runTurn(
    conversation.id,
    "The old clock tower is acting strange.",
    () => undefined,
  );
  if (!success) {
    throw new Error("Demo turn failed.");
  }

  const messages = await store.loadRecentMessages(conversation.id, 80);
  let output = "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      output = messages[index].content;
      break;
    }
  }

  console.log(`Conversation: ${conversation.id}`);
  console.log(`Workspace: ${store.conversationDir(conversation.id)}`);
  console.log(`Character: ${character.id}`);
  console.log(`Lorebook: ${lorebook.id}`);
  console.log("");
  console.log(output);
}

async function importCharacter(filePath: string): Promise<void> {
  const absolutePath = path.resolve(cwd(), filePath);
  const raw = await readJsonFile(absolutePath);
  const character = normalizeCharacterCard(raw, absolutePath);
  const lorebook = normalizeEmbeddedCharacterBook(raw, absolutePath);

  await store.saveCharacter(character);
  console.log(`Imported character ${character.name}: ${character.id}`);
  if (lorebook) {
    await store.saveLorebook(lorebook);
    console.log(`Imported embedded lorebook ${lorebook.name}: ${lorebook.id}`);
  }
}

async function importLorebook(filePath: string): Promise<void> {
  const absolutePath = path.resolve(cwd(), filePath);
  const lorebook = normalizeLorebook(await readJsonFile(absolutePath), absolutePath);

  await store.saveLorebook(lorebook);
  console.log(`Imported lorebook ${lorebook.name}: ${lorebook.id}`);
}

async function newConversation(
  characterId: string,
  lorebookIds: string[],
): Promise<void> {
  const character = await store.loadCharacter(characterId);

  for (const lorebookId of lorebookIds) {
    await store.loadLorebook(lorebookId);
  }

  const conversation = await store.createConversation({
    title: "Conversation",
    characterId,
    lorebookIds,
  });
  const settings = await store.loadSettings();
  conversation.model = settings.defaultModel;
  await store.saveConversationConfig(conversation);
  await store.seedOpeningMessage(
    conversation.id,
    renderOpeningMessage(
      character,
      settings,
      await store.loadConversationState(conversation.id),
    ),
  );

  console.log(`Conversation: ${conversation.id}`);
  console.log(`Workspace: ${store.conversationDir(conversation.id)}`);
}

async function sendMessage(
  conversationId: string,
  text: string,
): Promise<void> {
  if (text.trim().length === 0) {
    throw new Error("Message text is required.");
  }

  const success = await piRuntime.runTurn(conversationId, text, () => undefined);
  if (!success) {
    throw new Error("Turn failed.");
  }

  const messages = await store.loadRecentMessages(conversationId, 80);
  let output = "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      output = messages[index].content;
      break;
    }
  }

  console.log(output);

  const config = await store.loadConversationConfig(conversationId);
  const lorebooks = await Promise.all(
    config.lorebookIds.map((id) => store.loadLorebook(id)),
  );
  const events = await store.loadEvents(conversationId);
  const matchedLoreEntryIds = readLastMatchedLoreEntryIds(events);
  const matchedLoreEntries = lorebooks
    .flatMap((book) => book.entries)
    .filter((entry) => matchedLoreEntryIds.includes(entry.id));

  if (matchedLoreEntries.length > 0) {
    console.log("");
    console.log(
      `Matched lore: ${matchedLoreEntries
        .map((entry) => entry.title)
        .join(", ")}`,
    );
  }
}

function readLastMatchedLoreEntryIds(events: { type: string; payload?: unknown }[]): string[] {
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

function requiredArg(args: string[], index: number, label: string): string {
  const value = args[index];

  if (!value) {
    throw new Error(`Missing ${label}.`);
  }

  return value;
}

function printHelp(): void {
  console.log(`Usage:
  npm run demo
  npm run import:character -- <path>
  npm run import:lorebook -- <path>
  npm run conversation:new -- <character-id> [lorebook-id...]
  npm run send -- <conversation-id> <message>
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  exit(1);
});
