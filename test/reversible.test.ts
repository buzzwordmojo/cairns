import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Board } from "../src/lib/board.js";
import { locate, taskPath } from "../src/lib/board.js";
import { uninstall } from "../src/commands/uninstall.js";
import {
  hooksInstalled,
  installHooks,
  installMergeDriver,
  removeHooks,
  removeMergeDriver,
} from "../src/lib/githooks.js";
import { installProtocol, protocolInstalled, removeProtocol } from "../src/lib/protocol.js";
import { createTask } from "../src/lib/task.js";
import { cleanup, tempBoard } from "./helpers.js";

afterAll(cleanup);

/** A real repo, because gitDir is resolved by asking git, not by guessing a path. */
function gitBoard(): Board {
  const board = tempBoard();
  execFileSync("git", ["init", "-q"], { cwd: board.root });
  return locate(board.root);
}

function quietly<T>(fn: () => T): T {
  const out = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = out;
  }
}

describe(".gitattributes", () => {
  test("an existing rule survives both install and removal", () => {
    const board = tempBoard();
    const p = join(board.root, ".gitattributes");
    writeFileSync(p, "*.png binary\n");

    installMergeDriver(board);
    expect(readFileSync(p, "utf8")).toContain("*.png binary");

    expect(removeMergeDriver(board)).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("*.png binary\n");
  });

  test("an unmarked line from an older install is marked in place, not duplicated", () => {
    const board = tempBoard();
    const p = join(board.root, ".gitattributes");
    writeFileSync(p, ".tasks/**/log.ndjson merge=union\n");

    installMergeDriver(board);
    const text = readFileSync(p, "utf8");
    expect(text).toContain("# cairns:attributes");
    expect(text.split("merge=union").length - 1).toBe(1);
  });

  test("a file that held nothing but our block is deleted, not left empty", () => {
    const board = tempBoard();
    installMergeDriver(board);
    removeMergeDriver(board);
    expect(existsSync(join(board.root, ".gitattributes"))).toBe(false);
  });

  test("removal reports false when there was nothing of ours to remove", () => {
    const board = tempBoard();
    writeFileSync(join(board.root, ".gitattributes"), "*.png binary\n");
    expect(removeMergeDriver(board)).toBe(false);
  });
});

describe("agent protocol block", () => {
  test("hand-written instructions around the block survive removal", () => {
    const board = tempBoard();
    const file = join(board.root, "CLAUDE.md");
    const original = "# House rules\n\nAlways use tabs.\n";
    writeFileSync(file, original);

    installProtocol(board, file);
    expect(protocolInstalled(board)).toBe(true);

    expect(removeProtocol(board).removed).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(protocolInstalled(board)).toBe(false);
  });

  test("a file we created outright is deleted rather than left as a stub", () => {
    const board = tempBoard();
    installProtocol(board, join(board.root, "CLAUDE.md"));
    removeProtocol(board);
    expect(existsSync(join(board.root, "CLAUDE.md"))).toBe(false);
  });
});

describe("git hooks", () => {
  test("a hook cairns wrote is removed", () => {
    const board = gitBoard();
    installHooks(board);
    expect(hooksInstalled(board)).toBe(true);

    expect(removeHooks(board).every((h) => h.result === "removed")).toBe(true);
    expect(hooksInstalled(board)).toBe(false);
  });

  test("a chained hook comes back byte for byte", () => {
    const board = gitBoard();
    const path = join(board.gitDir!, "hooks", "post-commit");
    const theirs = "#!/bin/sh\necho someone else was here\n";
    writeFileSync(path, theirs);

    expect(installHooks(board).find((h) => h.name === "post-commit")?.result).toBe("chained");

    const removal = removeHooks(board).find((h) => h.name === "post-commit");
    expect(removal?.result).toBe("restored");
    expect(readFileSync(path, "utf8")).toBe(theirs);
  });

  test("a foreign hook is reported, never deleted", () => {
    // Silently deleting someone else's hook is a far worse failure than leaving
    // a stale one behind, so removal has to be able to decline.
    const board = gitBoard();
    const path = join(board.gitDir!, "hooks", "post-commit");
    const theirs = "#!/bin/sh\nexit 0\n";
    writeFileSync(path, theirs);

    const removal = removeHooks(board).find((h) => h.name === "post-commit");
    expect(removal?.result).toBe("foreign");
    expect(readFileSync(path, "utf8")).toBe(theirs);
  });
});

describe("cairn uninstall", () => {
  function inBoard<T>(board: Board, fn: () => T): T {
    const cwd = process.cwd();
    process.chdir(board.root);
    try {
      return fn();
    } finally {
      process.chdir(cwd);
    }
  }

  test("the board survives — the plumbing goes, the memory stays", () => {
    const board = gitBoard();
    const task = createTask(board, { title: "Something learned the hard way" });
    installHooks(board);
    installMergeDriver(board);
    installProtocol(board, join(board.root, "CLAUDE.md"));

    inBoard(board, () => quietly(() => uninstall({ positional: [], flags: {} })));

    expect(hooksInstalled(board)).toBe(false);
    expect(existsSync(join(board.root, ".gitattributes"))).toBe(false);
    expect(existsSync(join(board.root, "CLAUDE.md"))).toBe(false);
    expect(existsSync(taskPath(board, task.id))).toBe(true);
  });

  test("--purge is what it takes to lose the board", () => {
    const board = gitBoard();
    createTask(board, { title: "Something learned the hard way" });
    installHooks(board);

    inBoard(board, () => quietly(() => uninstall({ positional: [], flags: { purge: true } })));

    expect(existsSync(board.dir)).toBe(false);
  });
});
