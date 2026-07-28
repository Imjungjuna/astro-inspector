import path from "node:path";
import { describe, expect, it } from "vitest";
import { injectJsxSourceMetadata } from "../../src/integration/inject-jsx-source-metadata.js";

describe("injectJsxSourceMetadata", () => {
  it("annotates native JSX and component call sites with original locations", () => {
    const root = path.resolve("/project");
    const file = path.join(root, "src", "Actions.tsx");
    const source = [
      "const Actions = () => (",
      "  <Button>",
      "    <span>Save</span>",
      "  </Button>",
      ");"
    ].join("\n");

    const result = injectJsxSourceMetadata(source, file, root);

    expect(result?.code).toContain(
      '<Button data-astro-ai-locator-file="src/Actions.tsx" data-astro-ai-locator-loc="2:3" data-astro-ai-locator-source-tag="Button">'
    );
    expect(result?.code).toContain(
      '<span data-astro-ai-locator-file="src/Actions.tsx" data-astro-ai-locator-loc="3:5" data-astro-ai-locator-source-tag="span">'
    );
    expect(result?.map.sources).toEqual([file]);
  });

  it("does not duplicate existing locator attributes", () => {
    const root = path.resolve("/project");
    const file = path.join(root, "src", "Button.jsx");
    const source =
      '<button data-astro-ai-locator-file="src/Button.jsx" data-astro-ai-locator-loc="1:1">Save</button>';

    const result = injectJsxSourceMetadata(source, file, root);

    expect(
      result?.code.match(/data-astro-ai-locator-file=/gu)
    ).toHaveLength(1);
    expect(result?.code.match(/data-astro-ai-locator-loc=/gu)).toHaveLength(1);
    expect(
      result?.code.match(/data-astro-ai-locator-source-tag=/gu)
    ).toHaveLength(1);
  });
});
