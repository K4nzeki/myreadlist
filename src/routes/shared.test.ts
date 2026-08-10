import { describe, it, expect } from "vitest";
import {
  normalizeType,
  normalizeStatus,
  parsePipeLine,
  parseSpaceLine,
  localMonthKey,
} from "./shared";

describe("normalizeType", () => {
  it("matches case-insensitively", () => {
    expect(normalizeType("manga")).toBe("Manga");
    expect(normalizeType("MANHWA")).toBe("Manhwa");
    expect(normalizeType("Comic")).toBe("Comic");
  });

  it("returns null for an unknown type", () => {
    expect(normalizeType("Novel")).toBeNull();
    expect(normalizeType("")).toBeNull();
  });
});

describe("normalizeStatus", () => {
  it("matches case-insensitively", () => {
    expect(normalizeStatus("ongoing")).toBe("Ongoing");
    expect(normalizeStatus("FINISHED")).toBe("Finished");
  });

  it("returns null for an unknown status", () => {
    expect(normalizeStatus("Reading")).toBeNull();
  });
});

describe("parsePipeLine", () => {
  it("parses a well-formed pipe-delimited line", () => {
    expect(parsePipeLine("Solo Leveling | 179 | Finished | Manhwa | 1")).toEqual({
      title: "Solo Leveling",
      chapter: 179,
      status: "Finished",
      type: "Manhwa",
      reread: 1,
    });
  });

  it("returns null when there are too few fields", () => {
    expect(parsePipeLine("Solo Leveling | 179 | Finished")).toBeNull();
  });

  it("returns null for an unknown type or status", () => {
    expect(parsePipeLine("Title | 1 | Finished | Novel | 0")).toBeNull();
    expect(parsePipeLine("Title | 1 | Reading | Manga | 0")).toBeNull();
  });

  it("returns null for non-numeric chapter or reread", () => {
    expect(parsePipeLine("Title | abc | Finished | Manga | 0")).toBeNull();
    expect(parsePipeLine("Title | 1 | Finished | Manga | xyz")).toBeNull();
  });

  it("returns null when the title is empty", () => {
    expect(parsePipeLine(" | 1 | Finished | Manga | 0")).toBeNull();
  });
});

describe("parseSpaceLine", () => {
  it("parses a well-formed space-delimited line with a multi-word title", () => {
    expect(parseSpaceLine("One Piece 1100 Ongoing Manga 0")).toEqual({
      entry: {
        title: "One Piece",
        chapter: 1100,
        status: "Ongoing",
        type: "Manga",
        reread: 0,
      },
    });
  });

  it("errors when there are too few tokens", () => {
    expect(parseSpaceLine("One Piece 1100")).toEqual({
      error: "needs Title + Chapter Status Type Reread",
    });
  });

  it("errors on an unknown type", () => {
    expect(parseSpaceLine("Title 1 Finished Novel 0").error).toMatch(/unknown type/);
  });

  it("errors on an unknown status", () => {
    expect(parseSpaceLine("Title 1 Reading Manga 0").error).toMatch(/unknown status/);
  });

  it("errors on a non-numeric chapter", () => {
    expect(parseSpaceLine("Title abc Finished Manga 0").error).toMatch(/not a number/);
  });

  it("errors on a non-numeric reread", () => {
    expect(parseSpaceLine("Title 1 Finished Manga xyz").error).toMatch(/not a number/);
  });
});

describe("localMonthKey", () => {
  it("formats a date as YYYY-MM-01 using local month/year", () => {
    expect(localMonthKey(new Date(2026, 0, 15))).toBe("2026-01-01");
    expect(localMonthKey(new Date(2026, 10, 1))).toBe("2026-11-01");
  });

  it("pads single-digit months", () => {
    expect(localMonthKey(new Date(2025, 2, 28))).toBe("2025-03-01");
  });
});
