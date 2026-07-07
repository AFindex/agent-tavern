import type {
  CharacterProfile,
  ChatMessage,
  ConversationState,
  JsonValue,
  ModelConfig,
} from "../types.js";

export interface MacroContext {
  character: CharacterProfile;
  state?: ConversationState;
  messages?: ChatMessage[];
  userName?: string;
  input?: string;
  original?: string;
  model?: ModelConfig;
  outletValues?: Record<string, string>;
}

const MAX_MACRO_PASSES = 4;

export function expandMacros(text: string, context: MacroContext): string {
  if (text.length === 0) return "";

  let result = replaceLegacyMacros(text);

  for (let pass = 0; pass < MAX_MACRO_PASSES; pass += 1) {
    const next = result.replace(
      /(^|[^\\])\{\{\s*([^{}]*?)\s*\}\}/g,
      (match, prefix: string, expression: string) => {
        if (expression.trim().startsWith("//")) return prefix;
        return `${prefix}${resolveMacro(expression, context)}`;
      },
    );

    if (next === result) {
      break;
    }
    result = next;
  }

  return result.replace(/\\\{\{/g, "{{").replace(/\\\}\}/g, "}}");
}

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceLegacyMacros(text: string): string {
  return text
    .replaceAll("<USER>", "{{user}}")
    .replaceAll("<BOT>", "{{char}}")
    .replaceAll("<CHAR>", "{{char}}")
    .replaceAll("<CHARIFNOTGROUP>", "{{charIfNotGroup}}");
}

function resolveMacro(expression: string, context: MacroContext): string {
  const parsed = parseMacroExpression(expression);
  if (!parsed) return `{{${expression}}}`;

  const name = parsed.name.toLowerCase();
  const args = parsed.args.map((arg) => expandMacros(arg, context));

  if (name.startsWith(".")) {
    return stringifyJsonValue(context.state?.variables[name.slice(1)]);
  }

  switch (name) {
    case "user":
      return context.userName ?? "User";
    case "char":
    case "charifnotgroup":
    case "group":
      return context.character.name;
    case "notchar":
      return context.userName ?? "User";
    case "description":
      return context.character.description;
    case "personality":
      return context.character.personality;
    case "scenario":
      return context.character.scenario;
    case "charprompt":
    case "systemprompt":
      return context.character.systemPrompt;
    case "charinstruction":
      return context.character.postHistoryInstructions;
    case "charcreatornotes":
      return context.character.creatorNotes;
    case "charversion":
      return context.character.characterVersion;
    case "mesexamples":
    case "mesexamplesraw":
      return context.character.messageExamples;
    case "charfirstmessage":
      return resolveGreeting(context.character, args[0]);
    case "summary":
      return context.state?.summary ?? "";
    case "lastmessage":
      return lastMessage(context.messages)?.content ?? "";
    case "lastmessageid":
      return String(Math.max(0, (context.messages?.length ?? 1) - 1));
    case "lastusermessage":
      return lastRoleMessage(context.messages, "user")?.content ?? "";
    case "lastcharmessage":
      return lastRoleMessage(context.messages, "assistant")?.content ?? "";
    case "original":
      return context.original ?? "";
    case "input":
      return context.input ?? "";
    case "model":
      return context.model?.name ?? "";
    case "date":
      return new Intl.DateTimeFormat(undefined, { dateStyle: "short" }).format(new Date());
    case "time":
      return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date());
    case "weekday":
      return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date());
    case "isodate":
      return new Date().toISOString().slice(0, 10);
    case "isotime":
      return new Date().toISOString().slice(11, 16);
    case "newline":
      return "\n".repeat(readPositiveInt(args[0], 1));
    case "space":
      return " ".repeat(readPositiveInt(args[0], 1));
    case "noop":
      return "";
    case "trim":
      return args.join("::").trim();
    case "reverse":
      return [...args.join("::")].reverse().join("");
    case "random":
    case "pick":
      return args.length > 0 ? args[Math.floor(Math.random() * args.length)] : "";
    case "roll":
      return rollDice(args[0] ?? "1d20");
    case "getvar":
      return stringifyJsonValue(context.state?.variables[args[0] ?? ""]);
    case "hasvar":
      return context.state?.variables[args[0] ?? ""] === undefined ? "false" : "true";
    case "setvar":
      setVariable(context, args[0], args.slice(1).join("::"));
      return "";
    case "outlet":
      return context.outletValues?.[(args[0] ?? "").trim()] ?? "";
    default:
      return `{{${expression}}}`;
  }
}

function parseMacroExpression(
  expression: string,
): { name: string; args: string[] } | null {
  let body = expression.trim();
  if (body.length === 0 || body.startsWith("/")) return null;

  body = body.replace(/^[#!?~>\s]+/, "").trim();
  if (body.length === 0) return null;

  if (body.includes("::")) {
    const parts = body.split("::").map((part) => part.trim());
    return { name: parts[0] ?? "", args: parts.slice(1) };
  }

  const spaceIndex = body.search(/\s/);
  const colonIndex = body.indexOf(":");
  const separatorIndex =
    colonIndex > 0 && (spaceIndex === -1 || colonIndex < spaceIndex)
      ? colonIndex
      : spaceIndex;

  if (separatorIndex === -1) {
    return { name: body, args: [] };
  }

  const name = body.slice(0, separatorIndex).trim();
  const rest = body.slice(separatorIndex + 1).trim();
  return { name, args: rest.length > 0 ? [rest] : [] };
}

function resolveGreeting(character: CharacterProfile, indexValue?: string): string {
  const index = Number(indexValue ?? 0);
  if (!Number.isFinite(index) || index <= 0) {
    return character.firstMessage ?? "";
  }

  return (character.alternateGreetings ?? [])[index - 1] ?? character.firstMessage ?? "";
}

function lastMessage(messages: ChatMessage[] | undefined): ChatMessage | undefined {
  return messages && messages.length > 0 ? messages[messages.length - 1] : undefined;
}

function lastRoleMessage(
  messages: ChatMessage[] | undefined,
  role: ChatMessage["role"],
): ChatMessage | undefined {
  if (!messages) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) {
      return messages[index];
    }
  }
  return undefined;
}

function stringifyJsonValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function setVariable(
  context: MacroContext,
  key: string | undefined,
  value: string,
): void {
  if (!context.state || !key) return;
  context.state.variables = { ...context.state.variables, [key]: value };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, 100);
}

function rollDice(expression: string): string {
  const match = expression.trim().match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!match) return "";

  const count = Math.min(Number.parseInt(match[1] || "1", 10), 100);
  const sides = Math.min(Number.parseInt(match[2], 10), 100000);
  const modifier = Number.parseInt(match[3] ?? "0", 10);
  if (count <= 0 || sides <= 0) return "";

  let total = modifier;
  for (let index = 0; index < count; index += 1) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return String(total);
}
