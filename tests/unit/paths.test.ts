import { describe, expect, it } from "vitest";
import { normalizeRelativeFile } from "../../src/manifest/paths.js";

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
