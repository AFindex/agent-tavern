import type { CharacterProfile, JsonValue } from "../types.js";
import { isRecord, readString, toJsonValue } from "../lib/json.js";
import { nowIso, stableId } from "../lib/ids.js";

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
    messageExamples: readString(data.mes_example),
    systemPrompt: readString(data.system_prompt),
    creatorNotes: readString(data.creator_notes),
    extensions,
    source: {
      kind: "sillytavern",
      path: sourcePath,
      importedAt: nowIso(),
    },
  };
}
