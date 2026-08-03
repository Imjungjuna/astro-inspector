import { describe, expect, it } from "vitest";
import {
  FRAMEWORK_ICON_SVG,
  frameworkFromFile
} from "../../src/client/source-framework.js";

describe("frameworkFromFile", () => {
  it("maps tracked extensions to their framework", () => {
    expect(frameworkFromFile("src/components/Card.astro")).toBe("astro");
    expect(frameworkFromFile("src/components/Island.tsx")).toBe("react");
    expect(frameworkFromFile("src/components/Legacy.jsx")).toBe("react");
  });

  it("ignores extension casing", () => {
    expect(frameworkFromFile("src/Card.ASTRO")).toBe("astro");
    expect(frameworkFromFile("src/Island.TSX")).toBe("react");
  });

  it("returns null for untracked or missing extensions", () => {
    expect(frameworkFromFile("src/components/Card.vue")).toBeNull();
    expect(frameworkFromFile("src/components/Card.svelte")).toBeNull();
    expect(frameworkFromFile("src/utils/helper.ts")).toBeNull();
    expect(frameworkFromFile("Makefile")).toBeNull();
    expect(frameworkFromFile("")).toBeNull();
  });

  it("does not treat a dotted directory as an extension", () => {
    expect(frameworkFromFile("packages/ui.astro/src/Card.tsx")).toBe("react");
    expect(frameworkFromFile("packages/ui.astro/src/README")).toBeNull();
  });
});

describe("FRAMEWORK_ICON_SVG", () => {
  it("carries a class hook and no hardcoded fill", () => {
    for (const [framework, svg] of Object.entries(FRAMEWORK_ICON_SVG)) {
      expect(svg).toContain(`class="icon-${framework}"`);
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).not.toContain("fill=");
      expect(svg).not.toContain("<defs");
    }
  });
});
