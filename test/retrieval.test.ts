import { afterAll, describe, expect, test } from "bun:test";
import { appendLog } from "../src/lib/log.js";
import { related } from "../src/lib/related.js";
import { countAll, search } from "../src/lib/search.js";
import { writeSection } from "../src/lib/sections.js";
import { createTask, writeTask } from "../src/lib/task.js";
import { cleanup, tempBoard } from "./helpers.js";

afterAll(cleanup);

function closedTaskBoard() {
  const board = tempBoard();
  const t = createTask(board, {
    title: "Replace session cookie with JWT",
    targets: ["src/middleware.ts"],
  });
  appendLog(board, t.id, {
    author: "agent",
    kind: "dead-end",
    text: "middleware verification broke SSR streaming",
    mechanism: "middleware runs after the response flushes",
  });
  appendLog(board, t.id, {
    author: "agent",
    kind: "dead-end",
    text: "verification fails intermittently under load",
    mechanism: "unknown",
    evidence: "panic: nil map",
  });
  const outcome = "JWT signed with the existing KMS key; verification moved to the route handler";
  t.status = "done";
  t.closed = "2026-08-01";
  t.body = writeSection(t.body, "outcome", outcome);
  writeTask(t);
  appendLog(board, t.id, { author: "agent", kind: "outcome", text: outcome });
  return { board, task: t, outcome };
}

describe("search", () => {
  test("an outcome stored in both the task and the log appears once", () => {
    // `cairn done` writes to both places; a reader must not see it twice.
    const { board, outcome } = closedTaskBoard();
    const hits = search(board, "KMS");
    const matching = hits.filter((h) => h.text.includes(outcome.slice(0, 30)));
    expect(matching.length).toBe(1);
  });

  test("a closed task's outcome outranks the attempts that led to it", () => {
    const { board } = closedTaskBoard();
    const hits = search(board, "verification");
    expect(hits[0]?.entry?.kind).toBe("outcome");
  });

  test("every hit line carries date, author and task id", () => {
    const { board, task } = closedTaskBoard();
    for (const hit of search(board, "verification")) {
      expect(hit.line).toContain(task.id);
      expect(hit.line).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  test("an empty query returns nothing rather than everything", () => {
    const { board } = closedTaskBoard();
    expect(search(board, "")).toEqual([]);
    expect(search(board, "   ")).toEqual([]);
  });

  test("countAll reports the untruncated total so the caller can say what was dropped", () => {
    const { board } = closedTaskBoard();
    const limited = search(board, "verification", { limit: 1 });
    expect(limited.length).toBe(1);
    expect(countAll(board, "verification")).toBeGreaterThan(1);
  });

  test("a superseded entry is demoted, not hidden", () => {
    const board = tempBoard();
    const t = createTask(board, { title: "Caching" });
    const old = appendLog(board, t.id, {
      author: "x",
      kind: "decided",
      text: "cache in redis because it survives restarts",
    });
    appendLog(board, t.id, {
      author: "x",
      kind: "decided",
      text: "cache in memory because redis added a network hop",
      supersedes: old.id,
    });
    const hits = search(board, "cache");
    expect(hits.length).toBe(2);
    expect(hits[0]?.entry?.id).not.toBe(old.id);
  });
});

describe("related", () => {
  test("no match is reported as an absence, with the reason", () => {
    const board = tempBoard();
    const r = related(board, "src/nothing.ts");
    expect(r.empty).toBe(true);
    // No git in the fixture, so attribution genuinely is unavailable and the
    // caller has to be able to say "unknown" rather than "nothing".
    expect(r.hooksInstalled).toBe(false);
  });

  test("declared targets link a task even with no commits", () => {
    const { board, task } = closedTaskBoard();
    const r = related(board, "src/middleware.ts");
    expect(r.empty).toBe(false);
    expect(r.closed[0]?.task.id).toBe(task.id);
    // Intent, not evidence — the caller must be able to label it as such.
    expect(r.closed[0]?.method).toBe("targets");
    expect(r.closed[0]?.commits).toEqual([]);
  });

  test("an explained mechanism outranks an unknown one", () => {
    const { board } = closedTaskBoard();
    const findings = related(board, "src/middleware.ts").closed[0]?.findings ?? [];
    const deadEnds = findings.filter((f) => f.kind === "dead-end");
    expect(deadEnds[0]?.mechanism).toBe("middleware runs after the response flushes");
    expect(deadEnds[1]?.mechanism).toBe("unknown");
  });

  test("the outcome leads the findings", () => {
    const { board } = closedTaskBoard();
    expect(related(board, "src/middleware.ts").closed[0]?.findings[0]?.kind).toBe("outcome");
  });

  test("a directory query matches files beneath it", () => {
    const { board, task } = closedTaskBoard();
    expect(related(board, "src/").closed[0]?.task.id).toBe(task.id);
    expect(related(board, "src").closed[0]?.task.id).toBe(task.id);
  });

  test("an open task carries its findings, not just its id", () => {
    // The dead end most likely to be repeated belongs to work still in flight.
    const board = tempBoard();
    const t = createTask(board, { title: "Crest art", targets: ["scripts/crest.ts"] });
    appendLog(board, t.id, {
      author: "agent",
      kind: "dead-end",
      text: "the bulldog render read as a bear",
      mechanism: "the muzzle and brow silhouette match a bear at crest scale",
    });
    const row = related(board, "scripts/crest.ts").open[0];
    expect(row?.task.id).toBe(t.id);
    expect(row?.findings[0]?.text).toBe("the bulldog render read as a bear");
  });
});
