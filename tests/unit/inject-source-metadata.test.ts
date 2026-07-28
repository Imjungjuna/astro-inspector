import path from "node:path";
import { describe, expect, it } from "vitest";
import { injectAstroSourceMetadata } from "../../src/integration/inject-source-metadata.js";

describe("injectAstroSourceMetadata", () => {
  it("annotates native Astro elements with original source locations", () => {
    const root = path.resolve("/project");
    const file = path.join(root, "src", "Card.astro");
    const source = [
      "---",
      'import Card from "./Card.astro";',
      "---",
      "<Card />",
      "<article><h2>Title</h2></article>"
    ].join("\n");

    const result = injectAstroSourceMetadata(source, file, root);

    expect(result?.code).toContain(
      '<article data-astro-ai-locator-file="src/Card.astro" data-astro-ai-locator-loc="5:1" data-astro-ai-locator-source-tag="article">'
    );
    expect(result?.code).toContain(
      '<h2 data-astro-ai-locator-file="src/Card.astro" data-astro-ai-locator-loc="5:10" data-astro-ai-locator-source-tag="h2">'
    );
    expect(result?.code).toContain(
      '<Card data-astro-ai-locator-file="src/Card.astro" data-astro-ai-locator-loc="4:1" data-astro-ai-locator-source-tag="Card" />'
    );
    expect(result?.map.sources).toEqual([file]);
  });

  it("does not duplicate locator attributes on a second transform", () => {
    const root = path.resolve("/project");
    const file = path.join(root, "src", "Card.astro");
    const source = "<article>Card</article>";

    const first = injectAstroSourceMetadata(source, file, root);
    const second = injectAstroSourceMetadata(first?.code ?? source, file, root);

    expect(
      second?.code.match(/data-astro-ai-locator-file=/gu)
    ).toHaveLength(1);
    expect(second?.code.match(/data-astro-ai-locator-loc=/gu)).toHaveLength(1);
    expect(
      second?.code.match(/data-astro-ai-locator-source-tag=/gu)
    ).toHaveLength(1);
  });
});
