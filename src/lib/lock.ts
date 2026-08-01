import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Board } from "./board.js";

const STALE_MS = 15_000;

/**
 * Advisory lock scoped to the git common directory, so all worktrees of a repo
 * share one. Held across id allocation and file mutation only — never across a
 * git commit or console output.
 */
export function withLock<T>(board: Board, fn: () => T): T {
  const base = board.gitDir ?? board.dir;
  const lockDir = join(base, "cairns.lock");
  const deadline = Date.now() + 5_000;

  for (;;) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (isStale(lockDir)) {
        try {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        } catch {
          /* another process won the cleanup race; fall through to retry */
        }
      }
      if (Date.now() > deadline) {
        // Proceeding without the lock beats refusing to record a finding.
        return fn();
      }
      sleep(25);
    }
  }

  try {
    writeFileSync(join(lockDir, "pid"), String(process.pid));
  } catch {
    /* the lock is the directory; the pid file is only for diagnosis */
  }
  try {
    return fn();
  } finally {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      /* nothing useful to do; the next holder will treat it as stale */
    }
  }
}

function isStale(lockDir: string): boolean {
  try {
    const age = Date.now() - statSync(lockDir).mtimeMs;
    if (age < STALE_MS) return false;
    const pid = Number(readFileSync(join(lockDir, "pid"), "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  } catch {
    return true;
  }
}

function sleep(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}
