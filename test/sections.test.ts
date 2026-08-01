import { describe, expect, test } from "bun:test";
import { appendToSection, readSection, readSectionLines, writeSection } from "../src/lib/sections.js";

describe("sections", () => {
  test("write then read round-trips", () => {
    const body = writeSection("", "context", "why this matters");
    expect(readSection(body, "context")).toBe("why this matters");
  });

  test("writing one section leaves the others byte-identical", () => {
    let body = writeSection("", "context", "original context");
    body = writeSection(body, "outcome", "shipped");
    const before = readSection(body, "context");
    body = writeSection(body, "outcome", "shipped differently");
    expect(readSection(body, "context")).toBe(before);
    expect(readSection(body, "outcome")).toBe("shipped differently");
  });

  test("prose outside any section survives a write", () => {
    const body = writeSection("Some freeform preamble.\n", "outcome", "done");
    expect(body).toContain("Some freeform preamble.");
  });

  test("a hand-written heading with no sentinels is read", () => {
    const body = "## Context\n\nwritten by a human\n\n## Outcome\n\nshipped\n";
    expect(readSection(body, "context")).toBe("written by a human");
    expect(readSection(body, "outcome")).toBe("shipped");
  });

  test("a legacy heading alias still resolves", () => {
    expect(readSection("## Acceptance\n\n- a thing\n", "done-when")).toBe("- a thing");
    expect(readSection("## Background\n\nhistory\n", "context")).toBe("history");
  });

  test("writing over a hand-written heading adopts sentinels without losing content", () => {
    const body = writeSection("## Context\n\nold text\n", "context", "new text");
    expect(readSection(body, "context")).toBe("new text");
    expect(body).toContain("cairns:context:begin");
  });

  test("list items come back without their bullets", () => {
    const body = writeSection("", "done-when", "- first\n- second\n* third");
    expect(readSectionLines(body, "done-when")).toEqual(["first", "second", "third"]);
  });

  test("appending keeps what was already there", () => {
    let body = writeSection("", "notes", "- one");
    body = appendToSection(body, "notes", "- two");
    expect(readSectionLines(body, "notes")).toEqual(["one", "two"]);
  });

  test("an absent section reads as empty rather than throwing", () => {
    expect(readSection("", "context")).toBe("");
    expect(readSectionLines("nothing here", "done-when")).toEqual([]);
  });

  test("an unknown section name is ignored, not fatal", () => {
    expect(readSection("body", "nope")).toBe("");
    expect(writeSection("body", "nope", "x")).toBe("body");
  });

  test("sections are inserted in canonical order", () => {
    let body = writeSection("", "outcome", "last");
    body = writeSection(body, "done-when", "first");
    expect(body.indexOf("done-when:begin")).toBeLessThan(body.indexOf("outcome:begin"));
  });

  test("repeated writes do not accumulate blank lines", () => {
    let body = "";
    for (let i = 0; i < 10; i++) body = writeSection(body, "context", `pass ${i}`);
    expect(body).not.toMatch(/\n{3,}/);
  });
});
