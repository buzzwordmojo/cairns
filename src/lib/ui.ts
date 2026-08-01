const enabled = () => {
  if (process.env.NO_COLOR) return false;
  if (process.env.CAIRNS_COLOR === "0") return false;
  if (process.env.CAIRNS_COLOR === "1") return true;
  return Boolean(process.stdout.isTTY);
};

const wrap = (open: number, close: number) => (s: string) =>
  enabled() ? `\u001b[${open}m${s}\u001b[${close}m` : s;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);

export function heading(s: string): string {
  return bold(s.toUpperCase());
}

/** Width-aware wrapping that keeps a hanging indent, for log lines in context. */
export function wrapText(text: string, width: number, indent = ""): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length + indent.length > width && cur) {
      lines.push(indent + cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(indent + cur);
  return lines.length ? lines : [indent];
}

export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

export const termWidth = () => Math.min(Math.max(process.stdout.columns || 80, 40), 120);
