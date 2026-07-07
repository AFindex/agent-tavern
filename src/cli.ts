import path from "node:path";
import { cwd, exit } from "node:process";

import { MockModelClient } from "./agent/model.js";
import { AgentRuntime } from "./agent/pipeline.js";
import { readJsonFile } from "./lib/json.js";
import { normalizeCharacterCard } from "./st/character-card.js";
import { normalizeLorebook } from "./st/lorebook.js";
import { WorkspaceStore } from "./storage/workspace.js";

const store = new WorkspaceStore(cwd());

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

  const conversation = await store.createConversation({
    title: "Demo Conversation",
    characterId: character.id,
    lorebookIds: [lorebook.id],
  });
  const runtime = new AgentRuntime(store, new MockModelClient());
  const result = await runtime.handleUserInput({
    conversationId: conversation.id,
    text: "The old clock tower is acting strange.",
  });

  console.log(`Conversation: ${conversation.id}`);
  console.log(`Workspace: ${store.conversationDir(conversation.id)}`);
  console.log(`Character: ${character.id}`);
  console.log(`Lorebook: ${lorebook.id}`);
  console.log(`Matched lore: ${result.matchedLoreEntries.length}`);
  console.log("");
  console.log(result.output);
}

async function importCharacter(filePath: string): Promise<void> {
  const absolutePath = path.resolve(cwd(), filePath);
  const character = normalizeCharacterCard(
    await readJsonFile(absolutePath),
    absolutePath,
  );

  await store.saveCharacter(character);
  console.log(`Imported character ${character.name}: ${character.id}`);
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
  await store.loadCharacter(characterId);

  for (const lorebookId of lorebookIds) {
    await store.loadLorebook(lorebookId);
  }

  const conversation = await store.createConversation({
    title: "Conversation",
    characterId,
    lorebookIds,
  });

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

  const runtime = new AgentRuntime(store, new MockModelClient());
  const result = await runtime.handleUserInput({
    conversationId,
    text,
  });

  console.log(result.output);

  if (result.matchedLoreEntries.length > 0) {
    console.log("");
    console.log(
      `Matched lore: ${result.matchedLoreEntries
        .map((entry) => entry.title)
        .join(", ")}`,
    );
  }
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
