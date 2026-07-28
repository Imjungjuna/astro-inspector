import { describe, expect, it } from "vitest";
import {
  createElementHash,
  normalizeRelativeFile
} from "../../src/manifest/hash.js";

describe("normalizeRelativeFile", () => {
  it("normalizes Windows separators without changing case", () => {
    expect(normalizeRelativeFile("src\\components\\Card.astro")).toBe(
      "src/components/Card.astro"
    );
  });

  it("removes a leading dot segment", () => {
    expect(normalizeRelativeFile("./src/pages/index.astro")).toBe(
      "src/pages/index.astro"
    );
  });
});

describe("createElementHash", () => {
  it("is deterministic for one source element", () => {
    const entry = {
      file: "src/components/Card.astro",
      line: 12,
      column: 5,
      sourceTag: "article",
      domTag: "article"
    };

    expect(createElementHash(entry)).toBe(createElementHash(entry));
    expect(createElementHash(entry)).toMatch(/^astro_hash_[a-f0-9]{24}$/);
  });

  it("changes when the source position changes", () => {
    const first = createElementHash({
      file: "src/components/Card.astro",
      line: 12,
      column: 5,
      sourceTag: "article",
      domTag: "article"
    });
    const second = createElementHash({
      file: "src/components/Card.astro",
      line: 13,
      column: 5,
      sourceTag: "article",
      domTag: "article"
    });

    expect(first).not.toBe(second);
  });
});
