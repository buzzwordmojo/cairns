import { randomBytes } from "node:crypto";

// Crockford base32, lowercased. i/l/o/u are excluded so ids never read ambiguously.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const EPOCH_SECONDS = Math.floor(Date.UTC(2024, 0, 1) / 1000);

const TIME_CHARS = 6; // 30 bits of seconds — good through 2058
// 40 bits. At 20 bits a burst of 5000 ids inside one second collided ~11 times,
// which is exactly the failure this scheme exists to make unrepresentable.
const RAND_CHARS = 8;

function encode(value: number, width: number): string {
  let n = value;
  let out = "";
  for (let i = 0; i < width; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/**
 * Time-ordered so `sort()` on a list of ids is chronological, which is what the
 * log and the backlog index both rely on instead of storing an ordinal.
 */
export function mint(prefix: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000) - EPOCH_SECONDS);
  return `${prefix}-${encode(seconds, TIME_CHARS)}${randomChars(RAND_CHARS)}`;
}

/** One byte per character. 256 is a multiple of 32, so the modulo is unbiased. */
function randomChars(count: number): string {
  const bytes = randomBytes(count);
  let out = "";
  for (let i = 0; i < count; i++) out += ALPHABET[bytes[i]! % 32];
  return out;
}

export const newTaskId = (now?: number) => mint("t", now);
export const newLogId = (now?: number) => mint("l", now);

// Deliberately looser than what we mint: hand-written ids like `t-042` stay valid
// forever, because humans edit these files too.
const TASK_ID = /^t-[0-9a-z]{1,32}$/;
const LOG_ID = /^l-[0-9a-z]{1,32}$/;

export const isTaskId = (s: string) => TASK_ID.test(s);
export const isLogId = (s: string) => LOG_ID.test(s);

/** Accepts `042`, `t-042`, `T-042`. Returns null when it could not be an id. */
export function normalizeTaskId(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const candidate = s.startsWith("t-") ? s : `t-${s}`;
  return isTaskId(candidate) ? candidate : null;
}
