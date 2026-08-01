import { describe, expect, test } from "bun:test";
import { Frontmatter, parseDocument, serializeDocument } from "../src/lib/frontmatter.js";

describe("frontmatter", () => {
  test("never throws on malformed input", () => {
    const nasty = [
      "",
      "---",
      "---\n",
      "---\nkey without colon\n---\nbody",
      "---\n: leading colon\n---",
      "---\n\t\ttabs: yes\n---",
      "no frontmatter at all",
      "---\nunterminated: true\nstill going",
      "---\nnested:\n  a: 1\n  b: 2\n---\nbody",
    ];
    for (const text of nasty) {
      expect(() => parseDocument(text)).not.toThrow();
    }
  });

  test("an unterminated block reads as no frontmatter, not an error", () => {
    const doc = parseDocument("---\nid: t-1\nnever closed");
    expect(doc.body).toContain("never closed");
  });

  test("unknown keys survive a rewrite byte-for-byte", () => {
    // Forward compatibility: an older binary must not eat a newer field.
    const original = [
      "---",
      "id: t-abc",
      "title: Something",
      "x-future-field: keep me",
      "reviewers:",
      "  - alice",
      "  - bob",
      "---",
      "",
      "body text",
    ].join("\n");
    const doc = parseDocument(original);
    doc.fm.set("updated", "2026-08-01");
    const out = serializeDocument(doc.fm, doc.body);
    expect(out).toContain("x-future-field: keep me");
    expect(out).toContain("  - alice");
    expect(out).toContain("  - bob");
    expect(out).toContain("updated:");
  });

  test("absent field yields a default rather than an error", () => {
    const fm = Frontmatter.parse("id: t-1");
    expect(fm.get("nothing")).toBeUndefined();
    expect(fm.getOr("nothing", "fallback")).toBe("fallback");
    expect(fm.getList("nothing")).toEqual([]);
    expect(fm.getMap("nothing")).toEqual({});
  });

  test("reads inline and block lists the same way", () => {
    expect(Frontmatter.parse('targets: ["a.ts", "b.ts"]').getList("targets")).toEqual(["a.ts", "b.ts"]);
    expect(Frontmatter.parse("targets:\n  - a.ts\n  - b.ts").getList("targets")).toEqual(["a.ts", "b.ts"]);
  });

  test("set replaces in place and keeps canonical order for new keys", () => {
    const fm = Frontmatter.parse("id: t-1\ntitle: One");
    fm.set("title", "Two").set("status", "open");
    expect(fm.get("title")).toBe("Two");
    expect(fm.keys().indexOf("status")).toBeGreaterThan(fm.keys().indexOf("title"));
  });
});
