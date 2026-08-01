import { describe, expect, test } from "bun:test";
import { type Block, estimateTokens, fit } from "../src/lib/budget.js";

const block = (name: string, priority: number, count: number): Block => ({
  name,
  priority,
  lines: Array.from({ length: count }, (_, i) => `${name} line ${i} ${"x".repeat(40)}`),
});

describe("budget", () => {
  test("under budget, nothing is touched", () => {
    const blocks = [block("a", 100, 2), block("b", 50, 2)];
    const r = fit(blocks, 1000);
    expect(r.dropped).toEqual([]);
    expect(r.overBudget).toBe(false);
    expect(r.lines.length).toBe(4);
  });

  test("the lowest priority block is trimmed first", () => {
    // 400 tokens fits the high-priority block whole once the other is trimmed.
    const r = fit([block("keep", 100, 20), block("drop", 10, 20)], 400);
    expect(r.dropped.map((d) => d.name)).toEqual(["drop"]);
    expect(r.lines.join("\n")).toContain("keep line 19");
  });

  test("trimming leaves a marker saying what was lost", () => {
    const r = fit([block("big", 10, 40)], 60);
    expect(r.lines.join("\n")).toMatch(/… \d+ more/);
    expect(r.dropped[0]?.lines).toBeGreaterThan(0);
  });

  test("degrades rather than failing when the budget is absurd", () => {
    const r = fit([block("a", 100, 30), block("b", 50, 30)], 1);
    expect(() => r.lines.join("\n")).not.toThrow();
    expect(r.overBudget).toBe(true);
  });

  test("a highest-priority block outlives everything else", () => {
    const r = fit([block("warn", 99, 3), block("backlog", 1, 200)], 40);
    expect(r.lines.join("\n")).toContain("warn line 0");
  });

  test("drops for one block are reported as a single total", () => {
    const r = fit([block("a", 1, 100), block("b", 2, 100)], 30);
    const names = r.dropped.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("token estimate tracks length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("termination", () => {
  test("always terminates, whatever the budget", () => {
    // A trim that cannot shrink a block used to loop forever here.
    for (const budget of [0, 1, 5, 5.5, -10, 40, 1000]) {
      for (const size of [1, 4, 5, 6, 7, 50]) {
        const r = fit([block("a", 1, size), block("b", 2, size)], budget);
        expect(Array.isArray(r.lines)).toBe(true);
      }
    }
  });
});
