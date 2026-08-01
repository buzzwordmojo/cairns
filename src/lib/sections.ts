/**
 * Structured sections carry sentinel comments so a write is a block replacement
 * rather than a whole-body rewrite. That keeps the diff to the block that
 * actually changed and stops an agent rewriting a section it meant to append to.
 */

export interface SectionSpec {
  name: string;
  heading: string;
  /** Headings a hand-written file may have used before sentinels were added. */
  aliases: string[];
}

export const SECTIONS: Record<string, SectionSpec> = {
  "done-when": { name: "done-when", heading: "Done when", aliases: ["Acceptance", "Definition of done"] },
  context: { name: "context", heading: "Context", aliases: ["Background"] },
  notes: { name: "notes", heading: "Notes", aliases: ["Constraints"] },
  questions: { name: "questions", heading: "Open questions", aliases: ["Questions"] },
  outcome: { name: "outcome", heading: "Outcome", aliases: ["Result"] },
};

export const SECTION_ORDER = ["done-when", "context", "notes", "questions", "outcome"];

const begin = (name: string) => `<!-- cairns:${name}:begin -->`;
const end = (name: string) => `<!-- cairns:${name}:end -->`;

function sentinelRange(body: string, name: string): [number, number] | null {
  const b = body.indexOf(begin(name));
  if (b < 0) return null;
  const e = body.indexOf(end(name), b);
  if (e < 0) return null;
  return [b, e + end(name).length];
}

/** Falls back to a plain `## Heading` scan so hand-written files still parse. */
function headingRange(body: string, spec: SectionSpec): [number, number] | null {
  const titles = [spec.heading, ...spec.aliases];
  for (const title of titles) {
    const re = new RegExp(`^##\\s+${title}\\s*$`, "im");
    const m = re.exec(body);
    if (!m) continue;
    const start = m.index;
    const rest = body.slice(start + m[0].length);
    const next = /^##\s+/m.exec(rest);
    const stop = next ? start + m[0].length + next.index : body.length;
    return [start, stop];
  }
  return null;
}

export function readSection(body: string, name: string): string {
  const spec = SECTIONS[name];
  if (!spec) return "";
  const range = sentinelRange(body, name) ?? headingRange(body, spec);
  if (!range) return "";
  const block = body.slice(range[0], range[1]);
  return block
    .replace(begin(name), "")
    .replace(end(name), "")
    .replace(/^##\s+.*$/m, "")
    .trim();
}

export function readSectionLines(body: string, name: string): string[] {
  return readSection(body, name)
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l.length > 0);
}

function renderSection(name: string, content: string): string {
  const spec = SECTIONS[name]!;
  const trimmed = content.trim();
  return [begin(name), `## ${spec.heading}`, trimmed, end(name)]
    .filter((p) => p !== "")
    .join("\n");
}

export function writeSection(body: string, name: string, content: string): string {
  const spec = SECTIONS[name];
  if (!spec) return body;
  const block = renderSection(name, content);
  const range = sentinelRange(body, name) ?? headingRange(body, spec);
  if (range) {
    return `${body.slice(0, range[0]).replace(/\s+$/, "")}\n\n${block}\n\n${body
      .slice(range[1])
      .replace(/^\s+/, "")}`.replace(/\n{3,}/g, "\n\n");
  }
  return insertOrdered(body, name, block);
}

export function appendToSection(body: string, name: string, line: string): string {
  const existing = readSection(body, name);
  const next = existing ? `${existing}\n${line}` : line;
  return writeSection(body, name, next);
}

function insertOrdered(body: string, name: string, block: string): string {
  const rank = SECTION_ORDER.indexOf(name);
  for (let i = rank + 1; i < SECTION_ORDER.length; i++) {
    const laterName = SECTION_ORDER[i]!;
    const range = sentinelRange(body, laterName) ?? headingRange(body, SECTIONS[laterName]!);
    if (range) {
      return `${body.slice(0, range[0]).replace(/\s+$/, "")}\n\n${block}\n\n${body
        .slice(range[0])
        .replace(/^\s+/, "")}`.replace(/\n{3,}/g, "\n\n");
    }
  }
  return `${body.replace(/\s+$/, "")}\n\n${block}\n`.replace(/^\n+/, "");
}
