import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * `stdin: "ignore"` on every spawn — inheriting stdin is what deadlocks git on
 * Windows under a stdio transport. `GIT_OPTIONAL_LOCKS=0` on reads so a query
 * never blocks on an index lock held by an editor.
 */
export function git(args: string[], cwd: string, opts: { write?: boolean } = {}): GitResult {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
      env: opts.write ? process.env : { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, stdout: e.stdout ?? "", stderr: e.stderr ?? String(err) };
  }
}

export function isGitRepo(cwd: string): boolean {
  return git(["rev-parse", "--git-dir"], cwd).ok;
}

/**
 * The common dir rather than the worktree git dir, so every worktree of a repo
 * shares one advisory lock and one hook install.
 */
export function gitCommonDir(cwd: string): string | null {
  const r = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  if (!r.ok) return null;
  const p = r.stdout.trim();
  return p ? p : null;
}

export function repoRoot(cwd: string): string | null {
  const r = git(["rev-parse", "--show-toplevel"], cwd);
  if (!r.ok) return null;
  const p = r.stdout.trim();
  return p ? p : null;
}

export function headSha(cwd: string): string | null {
  const r = git(["rev-parse", "--short", "HEAD"], cwd);
  return r.ok ? r.stdout.trim() || null : null;
}

export interface TrailerCommit {
  sha: string;
  date: string;
  subject: string;
  task: string;
  files: string[];
}

const RECORD = "";
const FIELD = "";

/**
 * One pass over history collecting every commit that carries a `Task:` trailer,
 * with the files it touched. This is the whole task-to-code link: the file list
 * is a query, never stored state.
 */
export function commitsWithTaskTrailer(cwd: string): TrailerCommit[] {
  const r = git(
    [
      "log",
      "--all",
      "--no-merges",
      `--format=${RECORD}%H${FIELD}%cI${FIELD}%s${FIELD}%(trailers:key=Task,valueonly,separator=%x2c)`,
      "--name-only",
    ],
    cwd,
  );
  if (!r.ok) return [];
  const out: TrailerCommit[] = [];
  for (const chunk of r.stdout.split(RECORD)) {
    if (!chunk.trim()) continue;
    const nl = chunk.indexOf("\n");
    const header = nl < 0 ? chunk : chunk.slice(0, nl);
    const [sha, date, subject, trailers] = header.split(FIELD);
    const task = (trailers ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
    if (!task) continue;
    const files = nl < 0
      ? []
      : chunk
          .slice(nl + 1)
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
    out.push({ sha: (sha ?? "").slice(0, 8), date: date ?? "", subject: subject ?? "", task, files });
  }
  return out;
}

/** Commits touching a path since a given sha — the plan staleness signal. */
export function commitsTouching(cwd: string, path: string, sinceSha?: string): number {
  const range = sinceSha ? [`${sinceSha}..HEAD`] : [];
  const r = git(["log", "--oneline", ...range, "--", path], cwd);
  if (!r.ok) return 0;
  return r.stdout.split("\n").filter((l) => l.trim()).length;
}

export function hasCairnsHook(commonDir: string, name: string): boolean {
  const p = join(commonDir, "hooks", name);
  if (!existsSync(p)) return false;
  try {
    return readFileSync(p, "utf8").includes("cairns:hook");
  } catch {
    return false;
  }
}
