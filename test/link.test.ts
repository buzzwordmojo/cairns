import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "../src/lib/args.js";
import { type Board, locate, writeActive } from "../src/lib/board.js";
import { link } from "../src/commands/link.js";
import { installHooks } from "../src/lib/githooks.js";
import { related } from "../src/lib/related.js";
import { createTask, readTask } from "../src/lib/task.js";
import { cleanup, tempBoard } from "./helpers.js";

afterAll(cleanup);

/** A real repo, because the trailer is produced by git running a real hook. */
function repo(): Board {
  const board = tempBoard();
  const g = (...args: string[]) => execFileSync("git", args, { cwd: board.root });
  g("init", "-q");
  g("config", "user.email", "test@cairns.invalid");
  g("config", "user.name", "cairns test");
  g("config", "commit.gpgsign", "false");
  const located = locate(board.root);
  installHooks(located);
  return located;
}

/** Returns the commit's stderr, so the warning is observable and not inferred. */
function commit(board: Board, file: string, message: string): string {
  const p = join(board.root, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${Math.random()}\n`);
  execFileSync("git", ["add", "-A"], { cwd: board.root });
  const out = execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: board.root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out;
}

function commitStderr(board: Board, file: string, message: string): string {
  const p = join(board.root, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${Math.random()}\n`);
  execFileSync("git", ["add", "-A"], { cwd: board.root });
  try {
    const r = execFileSync("sh", ["-c", `git commit -q -m ${JSON.stringify(message)} 2>&1 1>/dev/null`], {
      cwd: board.root,
      encoding: "utf8",
    });
    return r;
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? "");
  }
}

const trailerOf = (board: Board) =>
  execFileSync("git", ["log", "-1", "--format=%(trailers:key=Task,valueonly)"], {
    cwd: board.root,
    encoding: "utf8",
  }).trim();

function quietly<T>(fn: () => T): T {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}

describe("prepare-commit-msg", () => {
  test("says so out loud when no task is active, and still lets the commit through", () => {
    const board = repo();
    const stderr = commitStderr(board, "src/a.ts", "first");
    expect(stderr).toContain("no active task");
    expect(stderr).toContain("cairn start");
    expect(trailerOf(board)).toBe("");
  });

  test("CAIRNS_QUIET silences the warning", () => {
    const board = repo();
    mkdirSync(join(board.root, "src"), { recursive: true });
    writeFileSync(join(board.root, "src/a.ts"), "x\n");
    execFileSync("git", ["add", "-A"], { cwd: board.root });
    const out = execFileSync(
      "sh",
      ["-c", "CAIRNS_QUIET=1 git commit -q -m quiet 2>&1 1>/dev/null"],
      { cwd: board.root, encoding: "utf8" },
    );
    expect(out).toBe("");
  });

  test("stays quiet where a message is replayed rather than written", () => {
    const board = repo();
    commit(board, "src/a.ts", "one");
    commit(board, "src/b.ts", "two");
    // rebase and cherry-pick both report "$2" as "message", exactly like -m.
    const sh = (cmd: string) =>
      execFileSync("sh", ["-c", `${cmd} 2>&1 1>/dev/null`], {
        cwd: board.root,
        encoding: "utf8",
      });
    expect(sh("git commit --amend --no-edit")).not.toContain("cairns:");
    expect(sh("git rebase --force-rebase HEAD~1")).not.toContain("cairns:");
  });

  test("an active task stamps the trailer", () => {
    const board = repo();
    const t = createTask(board, { title: "active" });
    writeActive(board, t.id);
    commit(board, "src/a.ts", "with active");
    expect(trailerOf(board)).toBe(t.id);
  });

  test("a branch named after a task stamps it without cairn start", () => {
    const board = repo();
    const t = createTask(board, { title: "branchy" });
    commit(board, "src/seed.ts", "seed");
    execFileSync("git", ["checkout", "-q", "-b", `feat/${t.id}-links`], { cwd: board.root });
    commit(board, "src/b.ts", "on the branch");
    expect(trailerOf(board)).toBe(t.id);
  });

  test("a branch that merely looks like an id stamps nothing", () => {
    const board = repo();
    commit(board, "src/seed.ts", "seed");
    execFileSync("git", ["checkout", "-q", "-b", "hotfix-t-shirt-sizing"], { cwd: board.root });
    commit(board, "src/c.ts", "not a task");
    expect(trailerOf(board)).toBe("");
  });

  test("an explicit start beats the branch name", () => {
    const board = repo();
    const started = createTask(board, { title: "started" });
    const named = createTask(board, { title: "named" });
    commit(board, "src/seed.ts", "seed");
    execFileSync("git", ["checkout", "-q", "-b", named.id], { cwd: board.root });
    writeActive(board, started.id);
    commit(board, "src/d.ts", "both available");
    expect(trailerOf(board)).toBe(started.id);
  });
});

describe("cairn link", () => {
  test("records the files a past commit touched, apart from declared targets", () => {
    const board = repo();
    const t = createTask(board, { title: "backfill me", targets: ["src/declared.ts"] });
    commit(board, "src/orphan.ts", "made before the task existed");
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: board.root, encoding: "utf8" }).trim();

    const cwd = process.cwd();
    process.chdir(board.root);
    try {
      expect(quietly(() => link(parseArgs([t.id, sha])))).toBe(0);
    } finally {
      process.chdir(cwd);
    }

    const reread = readTask(board, t.id)!;
    expect(reread.linked).toContain("src/orphan.ts");
    expect(reread.targets).toEqual(["src/declared.ts"]);
    // The board's own churn is not what the task changed about the code.
    expect(reread.linked.some((p) => p.startsWith(".tasks/"))).toBe(false);
  });

  test("related reports a backfill under its own provenance", () => {
    const board = repo();
    const t = createTask(board, { title: "backfilled" });
    commit(board, "src/orphan.ts", "orphan");
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: board.root, encoding: "utf8" }).trim();

    const cwd = process.cwd();
    process.chdir(board.root);
    try {
      quietly(() => link(parseArgs([t.id, sha])));
      const r = related(board, "src/orphan.ts", { rebuild: true });
      expect(r.empty).toBe(false);
      expect(r.open[0]!.method).toBe("linked");
      expect(r.open[0]!.task.id).toBe(t.id);
    } finally {
      process.chdir(cwd);
    }
  });

  test("refuses a revision git cannot resolve rather than recording nothing", () => {
    const board = repo();
    const t = createTask(board, { title: "bad rev" });
    commit(board, "src/a.ts", "seed");

    const cwd = process.cwd();
    process.chdir(board.root);
    try {
      expect(quietly(() => link(parseArgs([t.id, "deadbeef"])))).toBe(1);
    } finally {
      process.chdir(cwd);
    }
    expect(readTask(board, t.id)!.linked).toEqual([]);
  });

  test("accepts a range", () => {
    const board = repo();
    const t = createTask(board, { title: "ranged" });
    commit(board, "src/one.ts", "one");
    commit(board, "src/two.ts", "two");
    commit(board, "src/three.ts", "three");

    const cwd = process.cwd();
    process.chdir(board.root);
    try {
      quietly(() => link(parseArgs([t.id, "HEAD~2..HEAD"])));
    } finally {
      process.chdir(cwd);
    }
    const reread = readTask(board, t.id)!;
    expect(reread.linked).toContain("src/two.ts");
    expect(reread.linked).toContain("src/three.ts");
    expect(reread.linked).not.toContain("src/one.ts");
  });
});

describe("hook upgrades", () => {
  test("a chained hook stays chained when the body changes", () => {
    const board = tempBoard();
    execFileSync("git", ["init", "-q"], { cwd: board.root });
    const located = locate(board.root);
    const path = join(located.gitDir!, "hooks", "post-commit");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "#!/bin/sh\necho someone elses hook\n");

    expect(installHooks(located).find((h) => h.name === "post-commit")!.result).toBe("chained");
    // Simulate an older cairns body so the upgrade path runs.
    writeFileSync(path, readFileSync(path, "utf8").replace("Best effort", "Best-effort"));

    const again = installHooks(located).find((h) => h.name === "post-commit")!;
    expect(again.result).toBe("chained");
    // The backup must still be invoked, not merely left on disk.
    expect(readFileSync(path, "utf8")).toContain("$0.pre-cairns");
  });
});
