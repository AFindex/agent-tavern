import type {
  ChatMessage,
  Lorebook,
  LorebookEntry,
  LorebookPosition,
  SelectiveLogic,
} from "../types.js";
import {
  isRecord,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
  toJsonValue,
} from "../lib/json.js";
import { nowIso, stableId } from "../lib/ids.js";
import { escapeRegexLiteral, expandMacros, type MacroContext } from "./macros.js";

type EntryCandidate = {
  uid: number;
  value: Record<string, unknown>;
};

export interface LoreMatchOptions {
  inputText?: string;
  recentMessages?: ChatMessage[];
  macroContext?: MacroContext;
  userName?: string;
  characterName?: string;
  scanDepth?: number;
  maxEntries?: number;
  recursiveScanning?: boolean;
  maxRecursionSteps?: number;
  caseSensitive?: boolean;
  matchWholeWords?: boolean;
  random?: () => number;
}

export interface LoreMatchResult {
  entries: LorebookEntry[];
  directEntryIds: string[];
  recursiveEntryIds: string[];
  scanText: string;
}

export function normalizeLorebook(raw: unknown, sourcePath?: string): Lorebook {
  if (!isRecord(raw)) {
    throw new Error("Lorebook must be a JSON object.");
  }

  const name = readString(raw.name, "Unnamed Lorebook");
  const extensionsValue = isRecord(raw.extensions) ? raw.extensions : {};
  const extensions: Record<string, ReturnType<typeof toJsonValue>> = {};
  for (const [key, value] of Object.entries(extensionsValue)) {
    extensions[key] = toJsonValue(value);
  }

  const entries = collectEntries(raw).map(({ uid, value }, index) =>
    normalizeLorebookEntry(value, uid, index),
  );

  return {
    id: stableId("lore", name, JSON.stringify(raw)),
    name,
    description: readString(raw.description),
    scanDepth: readOptionalNumber(raw.scan_depth ?? raw.scanDepth),
    tokenBudget: readOptionalNumber(raw.token_budget ?? raw.tokenBudget),
    recursiveScanning: readOptionalBoolean(
      raw.recursive_scanning ?? raw.recursiveScanning,
    ),
    extensions,
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
  recentMessages: string[] | ChatMessage[],
): LorebookEntry[] {
  const normalizedMessages =
    recentMessages.length > 0 && typeof recentMessages[0] === "string"
      ? (recentMessages as string[]).map((content) => ({
          role: "user" as const,
          content,
          timestamp: nowIso(),
        }))
      : (recentMessages as ChatMessage[]);

  return matchLoreEntriesDetailed(lorebooks, {
    inputText,
    recentMessages: normalizedMessages,
  }).entries;
}

export function matchLoreEntriesDetailed(
  lorebooks: Lorebook[],
  options: LoreMatchOptions = {},
): LoreMatchResult {
  const allEntries = lorebooks.flatMap((lorebook) => lorebook.entries);
  const random = options.random ?? Math.random;
  const scanDepth = resolveScanDepth(lorebooks, options.scanDepth);
  const baseScanText = buildScanText(options, scanDepth);
  const directMatches = new Map<string, LorebookEntry>();
  const recursiveMatches = new Map<string, LorebookEntry>();
  const directIds = new Set<string>();
  const recursiveIds = new Set<string>();

  for (const entry of allEntries) {
    if (!entry.enabled || entry.delayUntilRecursion) continue;
    if (entry.constant || entryMatches(entry, baseScanText, options)) {
      if (!passesProbability(entry, random)) continue;
      directMatches.set(entry.id, entry);
      directIds.add(entry.id);
    }
  }

  if (shouldRecurse(lorebooks, options)) {
    let recursionText = collectRecursionText(directMatches.values());
    const maxSteps = Math.max(1, options.maxRecursionSteps ?? 3);

    for (let step = 1; step < maxSteps && recursionText.length > 0; step += 1) {
      const stepMatches: LorebookEntry[] = [];

      for (const entry of allEntries) {
        if (
          !entry.enabled ||
          entry.excludeRecursion ||
          directMatches.has(entry.id) ||
          recursiveMatches.has(entry.id)
        ) {
          continue;
        }

        if (!entryMatches(entry, recursionText, options)) {
          continue;
        }

        if (!passesProbability(entry, random)) continue;
        recursiveMatches.set(entry.id, entry);
        recursiveIds.add(entry.id);
        stepMatches.push(entry);
      }

      recursionText = collectRecursionText(
        stepMatches.filter((entry) => !entry.preventRecursion),
      );
    }
  }

  const entries = sortLoreEntries([
    ...directMatches.values(),
    ...recursiveMatches.values(),
  ]).slice(0, Math.max(0, options.maxEntries ?? Number.POSITIVE_INFINITY));

  return {
    entries,
    directEntryIds: [...directIds],
    recursiveEntryIds: [...recursiveIds],
    scanText: baseScanText,
  };
}

function collectEntries(raw: Record<string, unknown>): EntryCandidate[] {
  const entriesValue = raw.entries;

  if (Array.isArray(entriesValue)) {
    return entriesValue
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry, index) => ({
        uid: readNumber(entry.uid, readNumber(entry.id, index + 1)),
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
  const keys = mergeStringArrays(raw.key, raw.keys);
  const secondaryKeys = mergeStringArrays(raw.keysecondary, raw.secondary_keys);
  const title =
    readString(raw.comment) ||
    readString(raw.name) ||
    readString(raw.title, `Entry ${uid}`);
  const disabled = readBoolean(raw.disable, readBoolean(raw.disabled, false));
  const extensionsValue = isRecord(raw.extensions) ? raw.extensions : {};
  const extensions: Record<string, ReturnType<typeof toJsonValue>> = {};

  for (const [key, value] of Object.entries(extensionsValue)) {
    extensions[key] = toJsonValue(value);
  }

  return {
    id: readString(raw.id, `entry_${uid}`),
    uid,
    title,
    keys,
    secondaryKeys,
    content: readString(raw.content),
    enabled: !disabled && readBoolean(raw.enabled, true),
    constant: readBoolean(raw.constant, false),
    selective: readBoolean(raw.selective, false),
    selectiveLogic: normalizeSelectiveLogic(
      raw.selectiveLogic ?? raw.selective_logic ?? raw.secondaryLogic,
    ),
    caseSensitive: readOptionalBoolean(raw.case_sensitive ?? raw.caseSensitive),
    matchWholeWords: readOptionalBoolean(raw.matchWholeWords ?? raw.match_whole_words),
    scanDepth: readOptionalNumber(raw.scanDepth ?? raw.scan_depth),
    position: normalizePosition(raw.position),
    depth: readOptionalNumber(raw.depth),
    outletName: readString(raw.outletName ?? raw.outlet_name),
    probability: normalizeProbability(raw.probability),
    useProbability: readBoolean(raw.useProbability ?? raw.use_probability, false),
    vectorized: readBoolean(raw.vectorized ?? raw.use_vectorization, false),
    group: readString(raw.group),
    groupWeight: readNumber(raw.groupWeight ?? raw.group_weight, 100),
    excludeRecursion: readBoolean(raw.excludeRecursion ?? raw.exclude_recursion, false),
    preventRecursion: readBoolean(raw.preventRecursion ?? raw.prevent_recursion, false),
    delayUntilRecursion: readBoolean(
      raw.delayUntilRecursion ?? raw.delay_until_recursion,
      false,
    ),
    priority: readNumber(raw.priority, 0),
    insertionOrder: readNumber(raw.insertion_order, readNumber(raw.order, index)),
    extensions,
  };
}

function entryMatches(
  entry: LorebookEntry,
  scanText: string,
  options: LoreMatchOptions,
): boolean {
  const primaryMatch = entry.keys.some((key) => keyMatches(key, scanText, entry, options));

  if (!primaryMatch) {
    return false;
  }

  if (!entry.selective || entry.secondaryKeys.length === 0) {
    return true;
  }

  const secondaryMatches = entry.secondaryKeys.map((key) =>
    keyMatches(key, scanText, entry, options),
  );

  switch (entry.selectiveLogic) {
    case "and_all":
      return secondaryMatches.every(Boolean);
    case "not_any":
      return !secondaryMatches.some(Boolean);
    case "not_all":
      return !secondaryMatches.every(Boolean);
    case "and_any":
    default:
      return secondaryMatches.some(Boolean);
  }
}

function keyMatches(
  rawKey: string,
  scanText: string,
  entry: LorebookEntry,
  options: LoreMatchOptions,
): boolean {
  const key = expandMacros(rawKey, options.macroContext ?? fallbackMacroContext());
  const regex = parseRegexKey(key);

  if (regex) {
    regex.lastIndex = 0;
    return regex.test(scanText);
  }

  const caseSensitive = entry.caseSensitive ?? options.caseSensitive ?? false;
  const matchWholeWords = entry.matchWholeWords ?? options.matchWholeWords ?? true;
  const haystack = caseSensitive ? scanText : scanText.toLowerCase();
  const needle = caseSensitive ? key : key.toLowerCase();

  if (!matchWholeWords || !isAsciiWord(needle)) {
    return haystack.includes(needle);
  }

  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegexLiteral(needle)}($|[^A-Za-z0-9_])`).test(
    haystack,
  );
}

function parseRegexKey(key: string): RegExp | null {
  const parsed = parseRegexLiteral(key.trim());
  if (!parsed) return null;

  try {
    return new RegExp(parsed.pattern, parsed.flags);
  } catch {
    return null;
  }
}

function parseRegexLiteral(
  value: string,
): { pattern: string; flags: string } | null {
  if (!value.startsWith("/")) return null;

  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] === "/" && !isEscaped(value, index)) {
      return {
        pattern: value.slice(1, index),
        flags: value.slice(index + 1),
      };
    }
  }

  return null;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function buildScanText(options: LoreMatchOptions, scanDepth: number): string {
  const userName = options.userName ?? "User";
  const characterName = options.characterName ?? "Character";
  const recentMessages = options.recentMessages ?? [];
  const priorLimit = Math.max(0, scanDepth - 1);
  const priorMessages = priorLimit > 0 ? recentMessages.slice(-priorLimit) : [];
  const lines = priorMessages.map((message) =>
    formatScanMessage(message, userName, characterName),
  );

  if (scanDepth > 0 && options.inputText) {
    lines.push(`\x01${userName}: ${options.inputText}`);
  }

  return lines.join("\n");
}

function formatScanMessage(
  message: ChatMessage,
  userName: string,
  characterName: string,
): string {
  const name = message.role === "assistant" ? characterName : userName;
  return `\x01${name}: ${message.content}`;
}

function resolveScanDepth(lorebooks: Lorebook[], fallback: number | undefined): number {
  const entryDepths = lorebooks
    .flatMap((book) => book.entries)
    .map((entry) => entry.scanDepth)
    .filter((value): value is number => typeof value === "number");
  const bookDepths = lorebooks
    .map((book) => book.scanDepth)
    .filter((value): value is number => typeof value === "number");

  return Math.max(0, ...entryDepths, ...bookDepths, fallback ?? 4);
}

function shouldRecurse(lorebooks: Lorebook[], options: LoreMatchOptions): boolean {
  if (options.recursiveScanning !== undefined) return options.recursiveScanning;
  if (lorebooks.some((book) => book.recursiveScanning === true)) return true;
  if (lorebooks.some((book) => book.recursiveScanning === false)) return false;
  return true;
}

function collectRecursionText(entries: Iterable<LorebookEntry>): string {
  return [...entries]
    .filter((entry) => !entry.preventRecursion)
    .map((entry) => entry.content)
    .join("\n");
}

function passesProbability(entry: LorebookEntry, random: () => number): boolean {
  if (!entry.useProbability) return true;
  const probability = Math.max(0, Math.min(100, entry.probability));
  return random() * 100 <= probability;
}

function sortLoreEntries(entries: LorebookEntry[]): LorebookEntry[] {
  return entries.sort((left, right) => {
    if (left.constant !== right.constant) return left.constant ? -1 : 1;
    if (left.priority !== right.priority) return right.priority - left.priority;
    return left.insertionOrder - right.insertionOrder;
  });
}

function mergeStringArrays(...values: unknown[]): string[] {
  const merged: string[] = [];
  for (const value of values) {
    merged.push(...readStringArray(value));
  }
  return [...new Set(merged.map((item) => item.trim()).filter(Boolean))];
}

function normalizeSelectiveLogic(value: unknown): SelectiveLogic {
  if (typeof value === "number") {
    return ["and_any", "and_all", "not_any", "not_all"][value] as SelectiveLogic ?? "and_any";
  }

  const normalized = readString(value).trim().toLowerCase().replace(/[\s-]/g, "_");
  if (
    normalized === "and_all" ||
    normalized === "not_any" ||
    normalized === "not_all"
  ) {
    return normalized;
  }

  return "and_any";
}

function normalizePosition(value: unknown): LorebookPosition {
  const normalized = readString(value).trim().toLowerCase().replace(/[\s-]/g, "_");
  switch (normalized) {
    case "before_char":
    case "before_char_defs":
      return "before_char";
    case "before_example":
    case "before_examples":
      return "before_example";
    case "after_example":
    case "after_examples":
      return "after_example";
    case "top_an":
      return "top_an";
    case "bottom_an":
      return "bottom_an";
    case "at_depth":
    case "depth":
      return "at_depth";
    case "outlet":
      return "outlet";
    case "after_char":
    case "after_char_defs":
    default:
      return "after_char";
  }
}

function normalizeProbability(value: unknown): number {
  const probability = readNumber(value, 100);
  return Math.max(0, Math.min(100, probability));
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function isAsciiWord(value: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(value);
}

function fallbackMacroContext(): MacroContext {
  return {
    character: {
      id: "",
      name: "Character",
      description: "",
      personality: "",
      scenario: "",
      firstMessage: "",
      alternateGreetings: [],
      messageExamples: "",
      systemPrompt: "",
      postHistoryInstructions: "",
      creatorNotes: "",
      creator: "",
      characterVersion: "",
      tags: [],
      regexScripts: [],
      extensions: {},
      source: { kind: "internal", importedAt: nowIso() },
    },
  };
}
