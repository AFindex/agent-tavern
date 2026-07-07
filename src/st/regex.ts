import type {
  JsonValue,
  RegexMacroMode,
  RegexScript,
  RegexTarget,
} from "../types.js";
import { isRecord, readBoolean, readString, readStringArray, toJsonValue } from "../lib/json.js";
import { stableId } from "../lib/ids.js";
import { escapeRegexLiteral, expandMacros, type MacroContext } from "./macros.js";

const DEFAULT_AFFECTS: Record<RegexTarget, boolean> = {
  userInput: false,
  aiResponse: true,
  slashCommand: false,
  worldInfo: false,
  prompt: false,
  reasoning: false,
  display: true,
};

const ALL_TARGETS: RegexTarget[] = [
  "userInput",
  "aiResponse",
  "slashCommand",
  "worldInfo",
  "prompt",
  "reasoning",
  "display",
];

export function normalizeRegexScripts(raw: unknown): RegexScript[] {
  const candidates = collectRegexCandidates(raw);
  return candidates.map((candidate, index) => normalizeRegexScript(candidate, index));
}

export function applyRegexScripts(
  text: string,
  scripts: RegexScript[],
  target: RegexTarget,
  context: MacroContext,
): string {
  if (text.length === 0 || scripts.length === 0) return text;

  let next = text;
  for (const script of scripts) {
    if (script.disabled || !script.affects[target]) {
      continue;
    }

    const regex = compileScriptRegex(script, context);
    if (!regex) {
      continue;
    }

    next = next.replace(regex, (...args) => {
      const match = String(args[0] ?? "");
      const groups = args.slice(1, -2).map((value) => String(value ?? ""));
      const trimmedMatch = trimMatch(match, script.trimStrings);
      let replacement = expandMacros(script.replaceString, {
        ...context,
        original: match,
      }).replaceAll("{{match}}", trimmedMatch);

      groups.forEach((group, index) => {
        replacement = replacement.replaceAll(`$${index + 1}`, group);
      });

      return replacement;
    });
  }

  return next;
}

function collectRegexCandidates(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is Record<string, unknown> => isRecord(item));
  }

  if (!isRecord(raw)) {
    return [];
  }

  const directKeys = [
    "regex",
    "regex_scripts",
    "regexScripts",
    "sillytavern_regex",
    "sillytavernRegex",
  ];

  for (const key of directKeys) {
    const value = raw[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => isRecord(item));
    }
  }

  const nested = raw.extensions;
  if (isRecord(nested)) {
    return collectRegexCandidates(nested);
  }

  return [];
}

function normalizeRegexScript(
  raw: Record<string, unknown>,
  index: number,
): RegexScript {
  const name =
    readString(raw.name) ||
    readString(raw.scriptName) ||
    readString(raw.title) ||
    `Regex ${index + 1}`;
  const findRegex =
    readString(raw.findRegex) ||
    readString(raw.find) ||
    readString(raw.regex) ||
    readString(raw.pattern);
  const replaceString =
    readString(raw.replaceString) ||
    readString(raw.replace) ||
    readString(raw.replacement) ||
    readString(raw.substitute);

  return {
    id: readString(raw.id, stableId("regex", name, `${findRegex}:${index}`)),
    name,
    findRegex,
    replaceString,
    trimStrings: readTrimStrings(raw),
    disabled: readBoolean(raw.disabled, readBoolean(raw.disable, false)),
    runOnEdit: readBoolean(raw.runOnEdit, false),
    macrosInFind: readMacroMode(raw),
    affects: readAffects(raw),
    alterOutgoingPrompt: readBoolean(raw.alterOutgoingPrompt, readBoolean(raw.promptOnly, false)),
    alterDisplay: readBoolean(raw.alterDisplay, readBoolean(raw.markdownOnly, false)),
    minDepth: readOptionalNumber(raw.minDepth),
    maxDepth: readOptionalNumber(raw.maxDepth),
  };
}

function readTrimStrings(raw: Record<string, unknown>): string[] {
  const direct = readStringArray(raw.trimStrings).concat(readStringArray(raw.trim));
  if (direct.length > 0) return direct;

  const trimOut = readString(raw.trimOut);
  if (trimOut.length === 0) return [];

  return trimOut
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readMacroMode(raw: Record<string, unknown>): RegexMacroMode {
  const value = readString(raw.macrosInFind) || readString(raw.substituteRegex);
  const normalized = value.trim().toLowerCase();
  if (normalized === "raw") return "raw";
  if (normalized === "escaped" || normalized === "escape") return "escaped";
  return "none";
}

function readAffects(raw: Record<string, unknown>): Record<RegexTarget, boolean> {
  const affects = { ...DEFAULT_AFFECTS };
  const rawAffects = raw.affects;

  if (Array.isArray(rawAffects)) {
    for (const item of rawAffects) {
      const target = normalizeTarget(String(item));
      if (target) affects[target] = true;
    }
    return affects;
  }

  if (isRecord(rawAffects)) {
    for (const target of ALL_TARGETS) {
      const value = rawAffects[target];
      if (typeof value === "boolean") {
        affects[target] = value;
      }
    }
  }

  for (const target of ALL_TARGETS) {
    const value = raw[target];
    if (typeof value === "boolean") {
      affects[target] = value;
    }
  }

  const placement = raw.placement;
  if (Array.isArray(placement)) {
    for (const item of placement) {
      const target = normalizeTarget(String(item));
      if (target) affects[target] = true;
    }
  }

  return affects;
}

function normalizeTarget(value: string): RegexTarget | null {
  const normalized = value.trim().toLowerCase().replace(/[_-\s]/g, "");
  switch (normalized) {
    case "user":
    case "userinput":
      return "userInput";
    case "ai":
    case "assistant":
    case "airesponse":
      return "aiResponse";
    case "slash":
    case "slashcommand":
    case "slashcommands":
      return "slashCommand";
    case "world":
    case "worldinfo":
    case "lore":
      return "worldInfo";
    case "prompt":
    case "outgoingprompt":
      return "prompt";
    case "reasoning":
      return "reasoning";
    case "display":
    case "markdown":
      return "display";
    default:
      return null;
  }
}

function compileScriptRegex(
  script: RegexScript,
  context: MacroContext,
): RegExp | null {
  let source = script.findRegex.trim();
  if (source.length === 0) return null;

  if (script.macrosInFind === "raw") {
    source = expandMacros(source, context);
  } else if (script.macrosInFind === "escaped") {
    source = source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match) =>
      escapeRegexLiteral(expandMacros(match, context)),
    );
  }

  const parsed = parseRegexLiteral(source);
  try {
    if (parsed) {
      return new RegExp(parsed.pattern, parsed.flags);
    }
    return new RegExp(source);
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

function trimMatch(match: string, trimStrings: string[]): string {
  let result = match;
  for (const trim of trimStrings) {
    if (trim.length > 0) {
      result = result.replaceAll(trim, "");
    }
  }
  return result;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function regexScriptsToJson(scripts: RegexScript[]): JsonValue {
  return scripts.map((script) => ({
    id: script.id,
    name: script.name,
    findRegex: script.findRegex,
    replaceString: script.replaceString,
    trimStrings: script.trimStrings,
    disabled: script.disabled,
    runOnEdit: script.runOnEdit,
    macrosInFind: script.macrosInFind,
    affects: script.affects,
    alterOutgoingPrompt: script.alterOutgoingPrompt,
    alterDisplay: script.alterDisplay,
    minDepth: script.minDepth ?? null,
    maxDepth: script.maxDepth ?? null,
  })).map((item) => toJsonValue(item));
}
