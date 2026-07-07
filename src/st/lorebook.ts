import type { Lorebook, LorebookEntry } from "../types.js";
import {
  isRecord,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
} from "../lib/json.js";
import { nowIso, stableId } from "../lib/ids.js";

type EntryCandidate = {
  uid: number;
  value: Record<string, unknown>;
};

export function normalizeLorebook(raw: unknown, sourcePath?: string): Lorebook {
  if (!isRecord(raw)) {
    throw new Error("Lorebook must be a JSON object.");
  }

  const name = readString(raw.name, "Unnamed Lorebook");
  const entries = collectEntries(raw).map(({ uid, value }, index) =>
    normalizeLorebookEntry(value, uid, index),
  );

  return {
    id: stableId("lore", name, JSON.stringify(raw)),
    name,
    entries,
    source: {
      kind: "sillytavern",
      path: sourcePath,
      importedAt: nowIso(),
    },
  };
}

export function matchLoreEntries(
  lorebooks: Lorebook[],
  inputText: string,
  recentMessages: string[],
): LorebookEntry[] {
  const scanText = [inputText, ...recentMessages].join("\n");
  const matched: LorebookEntry[] = [];

  for (const lorebook of lorebooks) {
    for (const entry of lorebook.entries) {
      if (!entry.enabled) {
        continue;
      }

      if (entry.constant || entryMatches(entry, scanText)) {
        matched.push(entry);
      }
    }
  }

  return matched.sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }

    return left.insertionOrder - right.insertionOrder;
  });
}

function collectEntries(raw: Record<string, unknown>): EntryCandidate[] {
  const entriesValue = raw.entries;

  if (Array.isArray(entriesValue)) {
    return entriesValue
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry, index) => ({
        uid: readNumber(entry.uid, index + 1),
        value: entry,
      }));
  }

  if (isRecord(entriesValue)) {
    return Object.entries(entriesValue)
      .filter((entry): entry is [string, Record<string, unknown>] =>
        isRecord(entry[1]),
      )
      .map(([key, value], index) => ({
        uid: readNumber(value.uid, Number.parseInt(key, 10) || index + 1),
        value,
      }));
  }

  return [];
}

function normalizeLorebookEntry(
  raw: Record<string, unknown>,
  uid: number,
  index: number,
): LorebookEntry {
  const keys = readStringArray(raw.key).concat(readStringArray(raw.keys));
  const secondaryKeys = readStringArray(raw.keysecondary).concat(
    readStringArray(raw.secondary_keys),
  );
  const title = readString(raw.comment, readString(raw.title, `Entry ${uid}`));
  const disabled = readBoolean(raw.disable, false);

  return {
    id: `entry_${uid}`,
    uid,
    title,
    keys,
    secondaryKeys,
    content: readString(raw.content),
    enabled: !disabled,
    constant: readBoolean(raw.constant, false),
    selective: readBoolean(raw.selective, false),
    priority: readNumber(raw.priority, 0),
    insertionOrder: readNumber(raw.order, index),
  };
}

function entryMatches(entry: LorebookEntry, scanText: string): boolean {
  const primaryMatch = entry.keys.some((key) => keyMatches(key, scanText));

  if (!primaryMatch) {
    return false;
  }

  if (!entry.selective || entry.secondaryKeys.length === 0) {
    return true;
  }

  return entry.secondaryKeys.some((key) => keyMatches(key, scanText));
}

function keyMatches(key: string, scanText: string): boolean {
  const regex = parseRegexKey(key);

  if (regex) {
    return regex.test(scanText);
  }

  return scanText.toLowerCase().includes(key.toLowerCase());
}

function parseRegexKey(key: string): RegExp | null {
  if (!key.startsWith("/") || key.lastIndexOf("/") === 0) {
    return null;
  }

  const lastSlash = key.lastIndexOf("/");
  const pattern = key.slice(1, lastSlash);
  const flags = key.slice(lastSlash + 1);

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}
