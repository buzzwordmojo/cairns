import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Board } from "../src/lib/board.js";

const made: string[] = [];

/** A board on disk with no git repo, so tests never touch the real one. */
export function tempBoard(): Board {
  const root = mkdtempSync(join(tmpdir(), "cairns-test-"));
  made.push(root);
  const dir = join(root, ".tasks");
  mkdirSync(dir, { recursive: true });
  return { root, dir, gitDir: null };
}

export function cleanup(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}
