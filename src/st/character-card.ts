import type { CharacterProfile, JsonValue, Lorebook } from "../types.js";
import { isRecord, readString, toJsonValue } from "../lib/json.js";
import { nowIso, stableId } from "../lib/ids.js";
import { normalizeLorebook } from "./lorebook.js";
import { normalizeRegexScripts } from "./regex.js";

export function normalizeCharacterCard(
  raw: unknown,
  sourcePath?: string,
): CharacterProfile {
  if (!isRecord(raw)) {
    throw new Error("Character card must be a JSON object.");
  }

  const data = isRecord(raw.data) ? raw.data : raw;
  const name = readString(data.name, "Unnamed Character");
  const serialized = JSON.stringify(raw);
  const extensionsValue = isRecord(data.extensions) ? data.extensions : {};
  const extensions: Record<string, JsonValue> = {};

  for (const [key, value] of Object.entries(extensionsValue)) {
    extensions[key] = toJsonValue(value);
  }

  return {
    id: stableId("char", name, serialized),
    name,
    description: readString(data.description),
    personality: readString(data.personality),
    scenario: readString(data.scenario),
    firstMessage: readString(data.first_mes),
    alternateGreetings: readStringArray(data.alternate_greetings),
    messageExamples: readString(data.mes_example),
    systemPrompt: readString(data.system_prompt),
    postHistoryInstructions: readString(data.post_history_instructions),
    creatorNotes: readString(data.creator_notes),
    creator: readString(data.creator),
    characterVersion: readString(data.character_version),
    tags: readStringArray(data.tags),
    regexScripts: normalizeRegexScripts(data.extensions),
    extensions,
    source: {
      kind: "sillytavern",
      path: sourcePath,
      importedAt: nowIso(),
    },
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function normalizeEmbeddedCharacterBook(
  raw: unknown,
  sourcePath?: string,
): Lorebook | null {
  if (!isRecord(raw)) {
    return null;
  }

  const data = isRecord(raw.data) ? raw.data : raw;
  if (!isRecord(data.character_book)) {
    return null;
  }

  const book = { ...data.character_book };
  if (readString(book.name).length === 0) {
    book.name = `${readString(data.name, "Character")} Lorebook`;
  }

  return normalizeLorebook(
    book,
    sourcePath ? `${sourcePath}#character_book` : undefined,
  );
}
