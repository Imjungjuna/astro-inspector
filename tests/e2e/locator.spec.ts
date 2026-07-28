import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

async function mockSettingsEndpoint(
  page: Page,
  initialTriggerKey: "control" | "alt" | "meta" = "alt"
) {
  let triggerKey = initialTriggerKey;
  await page.route("**/_astro-ai-locator/settings", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      const body = request.postDataJSON() as {
        schemaVersion: number;
        triggerKey: "control" | "alt" | "meta";
      };
      triggerKey = body.triggerKey;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, triggerKey })
    });
  });
  return {
    current: () => triggerKey
  };
}

test("Alt hover reveals the page map, annotated parent, current target, and structured label", async ({
  page
}) => {
  await page.goto("/");
  const child = page.getByTestId("react-child-label");
  await child.evaluate((element) => {
    const wrapper = document.createElement("span");
    wrapper.dataset.testid = "unannotated-wrapper";
    element.replaceWith(wrapper);
    wrapper.append(element);
  });
  const unannotatedWrapper = page.getByTestId("unannotated-wrapper");
  const annotatedParent = page.getByTestId("react-child-button");
  await expect(unannotatedWrapper).not.toHaveAttribute(
    "data-astro-ai-locator-file"
  );

  await child.hover();
  await page.keyboard.down("Alt");

  await expect(page.locator("html")).toHaveAttribute(
    "data-astro-ai-locator-active",
    ""
  );
  const untouchedBoundary = page.getByTestId("card-beta");
  await expect(untouchedBoundary).toHaveCSS("outline-style", "dashed");
  await expect(untouchedBoundary).toHaveCSS("outline-width", "1px");
  await expect(untouchedBoundary).toHaveCSS(
    "outline-color",
    "rgba(107, 114, 128, 0.18)"
  );

  const overlay = page.locator("[data-astro-ai-locator-overlay]");
  const currentBox = overlay.locator(".box");
  const parentBox = overlay.locator(".parent-box");
  const label = currentBox.locator(".label");
  await expect(overlay).toBeVisible();
  await expect(currentBox).toHaveCSS("border-top-style", "solid");
  await expect(currentBox).toHaveCSS("border-top-width", "2px");
  await expect(currentBox).toHaveCSS(
    "border-top-color",
    "rgba(139, 92, 246, 0.85)"
  );
  await expect(currentBox).toHaveCSS(
    "background-color",
    "rgba(139, 92, 246, 0.1)"
  );
  await expect(parentBox).toBeVisible();
  await expect(parentBox).toHaveCSS("border-top-width", "0px");
  await expect(parentBox).toHaveCSS("outline-style", "solid");
  await expect(parentBox).toHaveCSS("outline-width", "2px");
  await expect(parentBox).toHaveCSS(
    "outline-color",
    "rgba(139, 92, 246, 0.4)"
  );
  await expect(parentBox).toHaveCSS("outline-offset", "2px");
  await expect(parentBox).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)"
  );
  await expect(parentBox.locator(".label")).toHaveCount(0);
  await expect(overlay.locator(".label")).toHaveCount(1);

  const parentBoxBounds = await parentBox.boundingBox();
  const annotatedParentBounds = await annotatedParent.boundingBox();
  const unannotatedWrapperBounds = await unannotatedWrapper.boundingBox();
  expect(parentBoxBounds).not.toBeNull();
  expect(annotatedParentBounds).not.toBeNull();
  expect(unannotatedWrapperBounds).not.toBeNull();
  if (
    !parentBoxBounds ||
    !annotatedParentBounds ||
    !unannotatedWrapperBounds
  ) {
    throw new Error("Overlay hierarchy does not have rendered bounds");
  }
  expect(parentBoxBounds.x).toBeCloseTo(annotatedParentBounds.x, 0);
  expect(parentBoxBounds.y).toBeCloseTo(annotatedParentBounds.y, 0);
  expect(parentBoxBounds.width).toBeCloseTo(annotatedParentBounds.width, 0);
  expect(parentBoxBounds.height).toBeCloseTo(
    annotatedParentBounds.height,
    0
  );
  expect(parentBoxBounds.width).toBeGreaterThan(
    unannotatedWrapperBounds.width
  );

  await expect(label).toHaveText(
    /^<span>│ReactIsland\.tsx│\d+:\d+$/u
  );
  await expect(label.locator(".label-separator")).toHaveText(["│", "│"]);
  await expect(label.locator(".label-tag")).toHaveCSS("font-weight", "700");
  await expect(label.locator(".label-tag")).toHaveCSS("opacity", "1");
  await expect(label.locator(".label-file")).toHaveCSS("font-weight", "500");
  await expect(label.locator(".label-file")).toHaveCSS("opacity", "0.9");
  await expect(label.locator(".label-location")).toHaveCSS(
    "font-weight",
    "400"
  );
  await expect(label.locator(".label-location")).toHaveCSS(
    "opacity",
    "0.75"
  );
  await expect(label.locator(".label-separator").first()).toHaveCSS(
    "opacity",
    "0.48"
  );
  await expect(label.locator(".label-separator").first()).toHaveCSS(
    "margin-left",
    "4px"
  );
  await expect(label.locator(".label-separator").first()).toHaveCSS(
    "margin-right",
    "4px"
  );

  await page.keyboard.up("Alt");
  await expect(overlay).toBeHidden();
});

test("Alt click registers the source and copies its hash", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const card = page.getByTestId("card-alpha");
  await card.click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  await expect(page.locator("[data-astro-ai-locator-toast]")).toContainText(
    "Copied"
  );

  const manifestPath = path.resolve(
    "tests/fixtures/basic/.astro-ai-locator/manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    entries: Record<
      string,
      { file: string; sourceTag: string; domTag: string }
    >;
  };
  expect(manifest.entries[copied]).toMatchObject({
    file: "src/components/Card.astro",
    sourceTag: "article",
    domTag: "article"
  });
});

test("component call-site metadata reaches its rendered child DOM", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const button = page.getByTestId("forwarded-button");

  await button.hover();
  await page.keyboard.down("Alt");
  await expect(
    page.locator("[data-astro-ai-locator-overlay] .label")
  ).toHaveText(
    /^<ForwardedButton→button>│index\.astro│\d+:\d+$/u
  );
  await page.keyboard.up("Alt");
  await button.click({ modifiers: ["Alt"] });

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const manifestPath = path.resolve(
    "tests/fixtures/basic/.astro-ai-locator/manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    entries: Record<
      string,
      { file: string; sourceTag: string; domTag: string }
    >;
  };

  expect(manifest.entries[copied]).toMatchObject({
    file: "src/pages/index.astro",
    sourceTag: "ForwardedButton",
    domTag: "button"
  });
});

test("React island descendants are selectable at their exact JSX source", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const child = page.getByTestId("react-child-label");

  await expect(child).toHaveAttribute(
    "data-astro-ai-locator-file",
    "src/components/ReactIsland.tsx"
  );
  await child.hover();
  await page.keyboard.down("Alt");
  await expect(page.locator("[data-astro-ai-locator-overlay]")).toBeVisible();
  await page.keyboard.up("Alt");
  await child.click({ modifiers: ["Alt"] });

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const manifestPath = path.resolve(
    "tests/fixtures/basic/.astro-ai-locator/manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    entries: Record<
      string,
      { file: string; sourceTag: string; domTag: string }
    >;
  };

  expect(manifest.entries[copied]).toMatchObject({
    file: "src/components/ReactIsland.tsx",
    sourceTag: "span",
    domTag: "span"
  });
});

test("a stretched pseudo-element cannot block its underlying source element", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const rating = page.getByTestId("pseudo-rating");
  const box = await rating.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("Pseudo rating has no rendered box");
  }
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };

  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.getAttribute("data-testid"),
      point
    )
  ).toBe("pseudo-stretched-link");

  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Alt");
  await expect(
    page.locator("[data-astro-ai-locator-overlay] .label")
  ).toHaveText(/^<span>│ReactIsland\.tsx│\d+:\d+$/u);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const manifestPath = path.resolve(
    "tests/fixtures/basic/.astro-ai-locator/manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    entries: Record<string, { sourceTag: string; domTag: string }>;
  };
  expect(manifest.entries[copied]).toMatchObject({
    sourceTag: "span",
    domTag: "span"
  });
});

test("stack-aware hit resolution selects a smaller annotated element under a real overlay", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const rating = page.getByTestId("stack-rating");
  const box = await rating.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("Stack rating has no rendered box");
  }
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };

  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.getAttribute("data-testid"),
      point
    )
  ).toBe("stack-overlay");

  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Alt");
  await expect(
    page.locator("[data-astro-ai-locator-overlay] .label")
  ).toHaveText(/^<span>│ReactIsland\.tsx│\d+:\d+$/u);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const manifestPath = path.resolve(
    "tests/fixtures/basic/.astro-ai-locator/manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    entries: Record<string, { sourceTag: string; domTag: string }>;
  };
  expect(manifest.entries[copied]).toMatchObject({
    sourceTag: "span",
    domTag: "span"
  });
});

test("an annotated pointer-events none child remains selectable", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const rating = page.getByTestId("pointer-none-rating");
  const box = await rating.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    throw new Error("Pointer-transparent rating has no rendered box");
  }
  const point = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };

  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.getAttribute("data-testid"),
      point
    )
  ).toBe("pointer-none-card");

  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Alt");
  await expect(
    page.locator("[data-astro-ai-locator-overlay] .label")
  ).toHaveText(/^<span>│ReactIsland\.tsx│\d+:\d+$/u);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const manifestPath = path.resolve(
    "tests/fixtures/basic/.astro-ai-locator/manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    entries: Record<string, { sourceTag: string; domTag: string }>;
  };
  expect(manifest.entries[copied]).toMatchObject({
    sourceTag: "span",
    domTag: "span"
  });
});

test("repeated DOM instances from one source tag share one hash", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByTestId("card-alpha")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const first = await page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByTestId("card-beta")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const second = await page.evaluate(() => navigator.clipboard.readText());

  expect(first).toBe(second);
});

test("the copied browser hash resolves to the same entry through MCP", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByTestId("card-alpha")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const hash = await page.evaluate(() => navigator.clipboard.readText());
  const fixtureRoot = path.resolve("tests/fixtures/basic");
  const manifest = JSON.parse(
    await readFile(
      path.join(fixtureRoot, ".astro-ai-locator", "manifest.json"),
      "utf8"
    )
  ) as {
    entries: Record<
      string,
      {
        file: string;
        line: number;
        column: number;
        sourceTag: string;
        domTag: string;
      }
    >;
  };
  const expectedEntry = manifest.entries[hash];
  expect(expectedEntry).toBeDefined();
  if (!expectedEntry) {
    throw new Error(`Manifest entry was not written for ${hash}`);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve("dist/mcp/cli.js"),
      "--project-root",
      fixtureRoot
    ],
    stderr: "pipe"
  });
  const client = new Client({
    name: "astro-ai-locator-e2e",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "get_astro_element_by_hash",
        arguments: { hash }
      })
    );
    const text = result.content.find((item) => item.type === "text");
    expect(text).toBeDefined();
    const resolved = JSON.parse(text?.text ?? "{}") as {
      hash: string;
      relativeFile: string;
      line: number;
      column: number;
      sourceTag: string;
      domTag: string;
    };
    expect(resolved).toMatchObject({
      hash,
      relativeFile: expectedEntry.file,
      line: expectedEntry.line,
      column: expectedEntry.column,
      sourceTag: expectedEntry.sourceTag,
      domTag: expectedEntry.domTag
    });
  } finally {
    await client.close();
  }
});

test("the floating launcher exposes the settings hierarchy", async ({
  page
}) => {
  const settings = await mockSettingsEndpoint(page);
  await page.goto("/");

  const launcher = page.locator("[data-astro-ai-locator-launcher]");
  const popover = page.locator("[data-astro-ai-locator-popover]");
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");
  await expect(launcher).toHaveAttribute(
    "aria-label",
    "Open Astro AI Locator settings"
  );
  await expect(page.locator("[data-fox-mark] path")).toHaveAttribute(
    "fill",
    "white"
  );
  await expect(popover).toBeHidden();

  const launcherBox = await launcher.boundingBox();
  const viewport = page.viewportSize();
  expect(launcherBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!launcherBox || !viewport) {
    throw new Error("Floating launcher does not have a viewport position");
  }
  expect(launcherBox.width).toBe(46);
  expect(launcherBox.height).toBe(46);
  expect(launcherBox.x).toBeCloseTo(16, 0);
  expect(viewport.height - launcherBox.y - launcherBox.height).toBeCloseTo(
    16,
    0
  );
  await expect(launcher).toHaveCSS(
    "background-color",
    "rgba(7, 7, 16, 0.62)"
  );
  await expect(launcher).toHaveCSS("backdrop-filter", "blur(14px)");
  const foxMark = page.locator("[data-fox-mark]");
  await expect(foxMark).toHaveCSS("width", "25px");
  await expect(foxMark).toHaveCSS("height", "25px");
  await launcher.hover();
  await expect(launcher).toHaveCSS("cursor", "pointer");

  await launcher.click();
  await expect(launcher).toHaveAttribute("aria-expanded", "true");
  await expect(popover).toBeVisible();
  await expect(popover).toHaveCSS("width", "260px");
  await expect(popover).toHaveCSS(
    "background-color",
    "rgba(63, 63, 70, 0.8)"
  );
  await expect(popover).toHaveCSS("backdrop-filter", "blur(18px)");
  await expect(popover).toHaveCSS("color", "rgb(244, 244, 245)");
  await expect(popover).toContainText("Trigger");
  await expect(popover).toContainText("Option / Alt");
  await expect(popover).toContainText("Preferences");
  await expect(popover).toContainText("Overlay Color");
  const sectionHeadings = popover.locator(".section-heading");
  await expect(sectionHeadings).toHaveCount(2);
  for (const heading of await sectionHeadings.all()) {
    await expect(heading).toHaveCSS("color", "rgb(244, 244, 245)");
    await expect(heading).toHaveCSS("font-size", "12px");
    await expect(heading).toHaveCSS("font-weight", "600");
  }
  await expect(popover.getByText(/^Drag to move\./u)).toHaveCount(0);
  await expect(popover.locator("[data-ui-color-chip]")).toHaveCount(4);
  await expect(popover.locator(".preference-row")).toHaveCSS(
    "height",
    "28px"
  );
  await expect(popover.locator(".preference-row")).toHaveCSS(
    "font-weight",
    "400"
  );
  await expect(popover.locator(".preference-row")).toHaveCSS(
    "color",
    "rgb(250, 250, 250)"
  );
  await expect(popover).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)"
  );
  const pointerContent = await popover.evaluate(
    (element) => getComputedStyle(element, "::after").content
  );
  expect(pointerContent).toBe("none");

  const choices = popover.locator("[data-trigger-key]");
  await expect(choices).toHaveCount(3);
  for (const choice of await choices.all()) {
    await expect(choice).toHaveCSS("height", "28px");
    await expect(choice).toHaveCSS("font-weight", "400");
  }
  const choiceBoxes = await choices.evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { x: rect.x, y: rect.y, height: rect.height };
    })
  );
  expect(choiceBoxes[1]?.x).toBeCloseTo(choiceBoxes[0]?.x ?? 0, 0);
  expect(choiceBoxes[0]?.height).toBeCloseTo(28, 1);
  expect(choiceBoxes[1]?.height).toBeCloseTo(28, 1);
  expect(choiceBoxes[2]?.height).toBeCloseTo(28, 1);
  expect(choiceBoxes[1]?.y).toBeCloseTo(
    (choiceBoxes[0]?.y ?? 0) + (choiceBoxes[0]?.height ?? 0)
  );
  expect(choiceBoxes[2]?.y).toBeCloseTo(
    (choiceBoxes[1]?.y ?? 0) + (choiceBoxes[1]?.height ?? 0)
  );

  const controlChoice = popover.getByRole("button", { name: "Control" });
  const altChoice = popover.getByRole("button", { name: "Option / Alt" });
  const controlKeycap = controlChoice.locator("[data-modifier-keycap]");
  const altKeycap = altChoice.locator("[data-modifier-keycap]");
  await expect(
    popover.locator("[data-selection-indicator]")
  ).toHaveCount(0);
  await expect(altChoice).toHaveAttribute("aria-pressed", "true");
  await expect(altChoice).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)"
  );
  await expect(controlChoice).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)"
  );
  await expect(controlChoice).toHaveCSS("color", "rgb(250, 250, 250)");
  await expect(altChoice).toHaveCSS("color", "rgb(250, 250, 250)");
  await expect(altKeycap).toHaveCSS(
    "background-color",
    "rgb(124, 58, 237)"
  );
  await expect(altKeycap).toHaveCSS("width", "22px");
  await expect(altKeycap).toHaveCSS("height", "22px");
  await expect(altKeycap).toHaveCSS("font-size", "16px");
  await expect(altKeycap).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(controlKeycap).toHaveCSS(
    "background-color",
    "rgba(255, 255, 255, 0.1)"
  );
  await expect(controlKeycap).toHaveCSS("color", "rgb(255, 255, 255)");

  const popoverBox = await popover.boundingBox();
  const altKeycapBox = await altKeycap.boundingBox();
  expect(popoverBox).not.toBeNull();
  expect(altKeycapBox).not.toBeNull();
  if (!popoverBox || !altKeycapBox) {
    throw new Error("Trigger keycap does not have a viewport position");
  }
  expect(
    launcherBox.y - (popoverBox.y + popoverBox.height)
  ).toBeCloseTo(6, 0);
  expect(altKeycapBox.x - popoverBox.x).toBeCloseTo(13, 0);

  await controlChoice.hover();
  await expect(controlChoice).toHaveCSS(
    "background-color",
    "rgba(255, 255, 255, 0.14)"
  );
  await controlChoice.click();
  await expect.poll(settings.current).toBe("control");
  await expect(controlChoice).toHaveAttribute("aria-pressed", "true");
  await expect(controlKeycap).toHaveCSS(
    "background-color",
    "rgb(124, 58, 237)"
  );
  await expect(controlKeycap).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(altKeycap).toHaveCSS(
    "background-color",
    "rgba(255, 255, 255, 0.1)"
  );
});

test("the launcher toggles independently from the locator trigger", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  await page.goto("/");

  const launcher = page.locator("[data-astro-ai-locator-launcher]");
  const popover = page.locator("[data-astro-ai-locator-popover]");
  await launcher.click();
  await expect(popover).toBeVisible();

  await page.getByTestId("card-alpha").hover();
  await page.keyboard.down("Alt");
  await expect(page.locator("html")).toHaveAttribute(
    "data-astro-ai-locator-active",
    ""
  );
  await expect(popover).toBeVisible();
  await page.keyboard.up("Alt");
  await expect(popover).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(launcher).toBeFocused();
  await expect(launcher).toHaveAttribute(
    "aria-label",
    "Open Astro AI Locator settings"
  );

  await launcher.click();
  await expect(popover).toBeVisible();
  await page.getByTestId("card-alpha").click();
  await expect(popover).toBeHidden();
});

test("the launcher is draggable and remembers its position", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  await page.goto("/");

  const launcher = page.locator("[data-astro-ai-locator-launcher]");
  const popover = page.locator("[data-astro-ai-locator-popover]");
  const before = await launcher.boundingBox();
  expect(before).not.toBeNull();
  if (!before) {
    throw new Error("Floating launcher is missing a draggable box");
  }

  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    before.x + before.width / 2 + 140,
    before.y + before.height / 2 - 100
  );
  await page.mouse.up();
  await expect(popover).toBeHidden();

  const moved = await launcher.boundingBox();
  expect(moved).not.toBeNull();
  expect(moved?.x).toBeGreaterThan(before.x + 100);
  expect(moved?.y).toBeLessThan(before.y - 60);

  await page.reload();
  const restored = await launcher.boundingBox();
  expect(restored?.x).toBeCloseTo(moved?.x ?? 0, 0);
  expect(restored?.y).toBeCloseTo(moved?.y ?? 0, 0);

  if (!restored) {
    throw new Error("Floating launcher position was not restored");
  }
  await page.mouse.move(
    restored.x + restored.width / 2,
    restored.y + restored.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(-100, -100);
  await page.mouse.up();
  const clamped = await launcher.boundingBox();
  expect(clamped?.x).toBeGreaterThanOrEqual(12);
  expect(clamped?.y).toBeGreaterThanOrEqual(12);
  await launcher.click();
  await expect(popover).toHaveAttribute("data-placement", "below");
});

test("the settings popover removes motion when reduced motion is preferred", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockSettingsEndpoint(page);
  await page.goto("/");

  const launcher = page.locator("[data-astro-ai-locator-launcher]");
  const popover = page.locator("[data-astro-ai-locator-popover]");
  await launcher.click();
  await expect(popover).toBeVisible();
  await expect(popover).toHaveCSS("transition-duration", "0s");
});
