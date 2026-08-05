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

  it("keeps a forwarded call site ahead of the wrapper's own attributes", () => {
    const root = path.resolve("/project");
    const file = path.join(root, "src", "Wrapper.astro");
    const source = [
      "---",
      "const props = Astro.props;",
      "---",
      '<button type="button" {...props}>',
      "  <slot />",
      "</button>",
      '<img src="a.png" {...props} />',
      "<Inner {...props}/>"
    ].join("\n");

    const result = injectAstroSourceMetadata(source, file, root);

    // intrinsic 태그는 HTML 문자열로 나가고 중복 속성은 **먼저 나온 값**이 이긴다.
    // 래퍼 자신의 좌표가 spread 뒤에 놓여야 호출부 좌표가 살아남는다.
    expect(result?.code).toContain(
      '<button type="button" {...props} data-astro-ai-locator-file="src/Wrapper.astro" data-astro-ai-locator-loc="4:1" data-astro-ai-locator-source-tag="button">'
    );
    expect(result?.code).toContain(
      '<img src="a.png" {...props} data-astro-ai-locator-file="src/Wrapper.astro" data-astro-ai-locator-loc="7:1" data-astro-ai-locator-source-tag="img" />'
    );
    // 컴포넌트 태그는 props **객체** 병합이라 방향이 반대다. spread 가 나중 키로
    // 덮으므로 주입은 spread 앞이어야 바깥 호출부가 이긴다.
    expect(result?.code).toContain(
      '<Inner data-astro-ai-locator-file="src/Wrapper.astro" data-astro-ai-locator-loc="8:1" data-astro-ai-locator-source-tag="Inner" {...props}/>'
    );
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
