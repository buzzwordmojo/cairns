/**
 * A frontmatter parser that never throws.
 *
 * Absent field is a valid field with a default. Unknown fields survive a rewrite
 * byte-for-byte, because entries hold their original lines and only the keys we
 * actually set get re-rendered. There is no schema and no migration.
 */

export type FmValue = string | string[] | Record<string, string>;

interface Entry {
  key: string;
  lines: string[];
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_.-]*):(.*)$/;
const BLOCK_ITEM = /^\s+-\s?(.*)$/;
const BLOCK_PAIR = /^\s+([A-Za-z_][A-Za-z0-9_.-]*):\s*(.*)$/;

/** Written keys land in this order; anything else keeps its original position. */
const CANONICAL = [
  "version",
  "id",
  "title",
  "status",
  "created",
  "updated",
  "closed",
  "targets",
  "plan",
];

function unquote(raw: string): string {
  const s = raw.trim();
  if (s.length >= 2) {
    const first = s[0];
    if ((first === '"' || first === "'") && s.endsWith(first)) {
      return s.slice(1, -1).replace(/\\"/g, '"');
    }
  }
  return s;
}

function quote(raw: string): string {
  const s = String(raw ?? "");
  if (s === "") return '""';
  if (/^[\s]|[\s]$|[:#[\]{},"']|^[-?&*!|>%@`]/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function splitInline(raw: string): string[] {
  const inner = raw.trim().slice(1, -1);
  if (!inner.trim()) return [];
  const out: string[] = [];
  let buf = "";
  let quoteChar: string | null = null;
  for (const ch of inner) {
    if (quoteChar) {
      if (ch === quoteChar) quoteChar = null;
      else buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      continue;
    }
    if (ch === ",") {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter((s) => s.length > 0);
}

export class Frontmatter {
  private entries: Entry[];

  constructor(entries: Entry[] = []) {
    this.entries = entries;
  }

  static parse(text: string): Frontmatter {
    const entries: Entry[] = [];
    let current: Entry | null = null;
    for (const line of text.split("\n")) {
      const m = KEY_LINE.exec(line);
      if (m) {
        current = { key: m[1]!, lines: [line] };
        entries.push(current);
        continue;
      }
      if (current) current.lines.push(line);
      // A stray line before any key is dropped rather than treated as an error.
    }
    return new Frontmatter(entries);
  }

  has(key: string): boolean {
    return this.entries.some((e) => e.key === key);
  }

  keys(): string[] {
    return this.entries.map((e) => e.key);
  }

  private entry(key: string): Entry | undefined {
    return this.entries.find((e) => e.key === key);
  }

  private inlineOf(entry: Entry): string {
    const first = entry.lines[0] ?? "";
    return first.slice(first.indexOf(":") + 1).trim();
  }

  get(key: string): string | undefined {
    const e = this.entry(key);
    if (!e) return undefined;
    const inline = this.inlineOf(e);
    if (!inline || inline.startsWith("[")) return undefined;
    return unquote(inline);
  }

  getOr(key: string, fallback: string): string {
    return this.get(key) ?? fallback;
  }

  getList(key: string): string[] {
    const e = this.entry(key);
    if (!e) return [];
    const inline = this.inlineOf(e);
    if (inline.startsWith("[")) return splitInline(inline).map(unquote);
    if (inline) return [unquote(inline)];
    const out: string[] = [];
    for (const line of e.lines.slice(1)) {
      const m = BLOCK_ITEM.exec(line);
      if (m) out.push(unquote(m[1]!));
    }
    return out;
  }

  getMap(key: string): Record<string, string> {
    const e = this.entry(key);
    const out: Record<string, string> = {};
    if (!e) return out;
    for (const line of e.lines.slice(1)) {
      const m = BLOCK_PAIR.exec(line);
      if (m) out[m[1]!] = unquote(m[2]!);
    }
    return out;
  }

  set(key: string, value: FmValue): this {
    const lines = render(key, value);
    const existing = this.entries.findIndex((e) => e.key === key);
    if (existing >= 0) {
      this.entries[existing] = { key, lines };
      return this;
    }
    this.entries.splice(this.insertionPoint(key), 0, { key, lines });
    return this;
  }

  delete(key: string): this {
    this.entries = this.entries.filter((e) => e.key !== key);
    return this;
  }

  private insertionPoint(key: string): number {
    const rank = CANONICAL.indexOf(key);
    if (rank < 0) return this.entries.length;
    for (let i = 0; i < this.entries.length; i++) {
      const otherRank = CANONICAL.indexOf(this.entries[i]!.key);
      if (otherRank < 0 || otherRank > rank) return i;
    }
    return this.entries.length;
  }

  toString(): string {
    const body = this.entries
      .flatMap((e) => e.lines)
      .join("\n")
      .replace(/\n+$/, "");
    return body;
  }
}

function render(key: string, value: FmValue): string[] {
  if (Array.isArray(value)) {
    return [`${key}: [${value.map(quote).join(", ")}]`];
  }
  if (value !== null && typeof value === "object") {
    const pairs = Object.entries(value).filter(([, v]) => v !== undefined && v !== "");
    if (pairs.length === 0) return [`${key}:`];
    return [`${key}:`, ...pairs.map(([k, v]) => `  ${k}: ${quote(v)}`)];
  }
  return [`${key}: ${quote(value)}`];
}

export interface ParsedDocument {
  fm: Frontmatter;
  body: string;
}

export function parseDocument(text: string): ParsedDocument {
  const normalized = text.replace(/^﻿/, "");
  if (!/^---\r?\n/.test(normalized)) {
    return { fm: new Frontmatter(), body: normalized };
  }
  const lines = normalized.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trimEnd() === "---") {
      end = i;
      break;
    }
  }
  // An unterminated block is treated as "no frontmatter" rather than an error,
  // so a half-saved file still renders instead of failing the whole command.
  if (end < 0) return { fm: new Frontmatter(), body: normalized };
  return {
    fm: Frontmatter.parse(lines.slice(1, end).join("\n")),
    body: lines.slice(end + 1).join("\n").replace(/^\r?\n/, ""),
  };
}

export function serializeDocument(fm: Frontmatter, body: string): string {
  const head = fm.toString();
  const tail = body.replace(/^\n+/, "").replace(/\s+$/, "");
  if (!head) return `${tail}\n`;
  return `---\n${head}\n---\n\n${tail}\n`;
}
