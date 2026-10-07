import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Board, TASK_FILE, indexPath, locate } from "../src/lib/board.js";
import { buildIndex, getFreshIndex, loadIndex, saveIndex } from "../src/lib/index-cache.js";
import { related } from "../src/lib/related.js";
import { createTask } from "../src/lib/task.js";
import { cleanup, tempBoard } from "./helpers.js";

afterAll(cleanup);

/** A real repo with no hooks: trailers are written into the message directly. */
function repo(): Board {
  const board = tempBoard();
  const g = (...args: string[]) => execFileSync("git", args, { cwd: board.root });
  g("init", "-q");
  g("config", "user.email", "test@cairns.invalid");
  g("config", "user.name", "cairns test");
  g("config", "commit.gpgsign", "false");
  return locate(board.root);
}

function commit(board: Board, file: string, task: string): string {
  const p = join(board.root, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${Math.random()}\n`);
  execFileSync("git", ["add", "--", file], { cwd: board.root });
  execFileSync("git", ["commit", "-q", "-m", `touch ${file}`, "-m", `Task: ${task}`], { cwd: board.root });
  return head(board);
}

const head = (board: Board) =>
  execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: board.root, encoding: "utf8" }).trim();

/** The shape matchbook was in: tasks still siblings of the page, so reindex refuses. */
function makeLegacy(board: Board): void {
  const legacy = join(board.dir, "t-legacy0000000");
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, TASK_FILE), "---\nid: t-legacy0000000\ntitle: legacy\n---\n");
}

describe("index freshness", () => {
  test("buildIndex records the HEAD it indexed", () => {
    const board = repo();
    const t = createTask(board, { title: "a" });
    const sha = commit(board, "src/a.ts", t.id);
    expect(buildIndex(board).head).toBe(sha);
  });

  test("a fresh cached index is used as-is, not rebuilt", () => {
    const board = repo();
    const t = createTask(board, { title: "a" });
    commit(board, "src/a.ts", t.id);
    const idx = buildIndex(board);
    // A marker no rebuild could produce proves the cached file was the answer.
    idx.paths["marker.ts"] = { [t.id]: ["cafebabe"] };
    saveIndex(board, idx);

    const r = getFreshIndex(board);
    expect(r.stale).toBeNull();
    expect(r.index.paths["marker.ts"]).toBeDefined();
  });

  test("an index recorded at an older sha is rebuilt and the newer trailer hits appear", () => {
    const board = repo();
    const old = createTask(board, { title: "old work" });
    const oldSha = commit(board, "src/old.ts", old.id);
    saveIndex(board, buildIndex(board));

    // Commits land while the post-commit refresh fails silently, as in matchbook.
    const fresh = createTask(board, { title: "new work" });
    commit(board, "src/new.ts", fresh.id);
    commit(board, "src/new.ts", fresh.id);
    expect(loadIndex(board)!.head).toBe(oldSha);

    const r = related(board, "src/new.ts");
    expect(r.stale).toBeNull();
    expect(r.open.map((row) => row.task.id)).toContain(fresh.id);
    expect(r.open.find((row) => row.task.id === fresh.id)!.method).toBe("trailer");
    expect(r.open.find((row) => row.task.id === fresh.id)!.commits.length).toBe(2);
    // And the rebuilt index is saved, so the next query is fast again.
    expect(loadIndex(board)!.head).toBe(head(board));
  });

  test("an index written before head was recorded counts as stale", () => {
    const board = repo();
    const t = createTask(board, { title: "a" });
    commit(board, "src/a.ts", t.id);
    mkdirSync(dirname(indexPath(board)), { recursive: true });
    writeFileSync(indexPath(board), JSON.stringify({ built: "2026-08-03T00:00:00Z", head: "", paths: {}, tasks: {} }));

    expect(related(board, "src/a.ts").open[0]?.task.id).toBe(t.id);
    expect(loadIndex(board)!.head).toBe(head(board));
  });

  test("a board whose rebuild fails still answers, says it is stale, and names the commit", () => {
    const board = repo();
    const old = createTask(board, { title: "old work" });
    const oldSha = commit(board, "src/shared.ts", old.id);
    saveIndex(board, buildIndex(board));

    const fresh = createTask(board, { title: "new work" });
    const newSha = commit(board, "src/shared.ts", fresh.id);
    makeLegacy(board);

    const r = related(board, "src/shared.ts");
    expect(r.stale).not.toBeNull();
    expect(r.stale!.head).toBe(oldSha);
    expect(r.stale!.current).toBe(newSha);
    expect(r.stale!.reason).toContain("migrate");
    // The answer is still given from what the old index knew.
    expect(r.open.find((row) => row.task.id === old.id)?.method).toBe("trailer");
    // The cache is left alone rather than overwritten with a guess.
    expect(loadIndex(board)!.head).toBe(oldSha);
  });

  test("a failed rebuild with no index at all says none was ever built", () => {
    const board = repo();
    const t = createTask(board, { title: "a" });
    const sha = commit(board, "src/a.ts", t.id);
    makeLegacy(board);

    const r = getFreshIndex(board);
    expect(r.stale).toEqual({ head: null, built: null, current: sha, reason: expect.stringContaining("migrate") });
    expect(Object.keys(r.index.paths)).toEqual([]);
  });

  test("without git the cached index is returned and never called stale", () => {
    const board = tempBoard();
    saveIndex(board, { built: "x", head: "", paths: { "a.ts": { "t-1": ["s"] } }, tasks: {} });
    const r = getFreshIndex(board);
    expect(r.stale).toBeNull();
    expect(r.index.paths["a.ts"]).toBeDefined();
  });
});
