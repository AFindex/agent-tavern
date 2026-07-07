import { createHash, randomUUID } from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createEventId(): string {
  return randomUUID();
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "asset";
}

export function stableId(prefix: string, name: string, content: string): string {
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 10);
  return `${prefix}_${slugify(name)}_${hash}`;
}

export function createConversationId(): string {
  return `conv_${randomUUID()}`;
}
