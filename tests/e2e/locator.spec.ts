import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  ColorPreset,
  ContextField,
  LocationFormat,
  LocatorSettings,
  ParentLevels,
  TriggerKey
} from "../../src/shared/contracts.js";

async function mockSettingsEndpoint(
  page: Page,
  initialTriggerKey: TriggerKey = "alt",
  initialColorPreset: ColorPreset = "violet",
  initialParentLevels: ParentLevels = 1,
  initialCopySettings: Partial<
    Pick<
      LocatorSettings,
      "copyMode" | "contextFields" | "locationFormat"
    >
  > = {}
) {
  let settings: LocatorSettings = {
    schemaVersion: 5,
    triggerKey: initialTriggerKey,
    colorPreset: initialColorPreset,
    parentLevels: initialParentLevels,
    copyMode: "hash",
    contextFields: ["location", "line"],
    locationFormat: "path",
    ...initialCopySettings
  };
  let rejectNextWrite = false;
  await page.route("**/@astro-inspector/settings", async (route) => {
    const request = route.request();
    if (request.method() === "PUT" && rejectNextWrite) {
      rejectNextWrite = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "settings write failed" })
      });
      return;
    }
    if (request.method() === "PUT") {
      settings = request.postDataJSON() as LocatorSettings;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(settings)
    });
  });
  return {
    current: () => ({
      ...settings,
      contextFields: [...settings.contextFields]
    }),
    rejectNextWrite: () => {
      rejectNextWrite = true;
    }
  };
}

/**
 * The whole suite shares one fixture dev server, and the real quit flag is per
 * process. Posting it for real would kill the locator for every later test, so
 * the session endpoint is always mocked here.
 */
async function mockSessionEndpoint(page: Page) {
  let disabled = false;
  await page.route("**/@astro-inspector/session", async (route) => {
    if (route.request().method() === "POST") {
      disabled = true;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        disabled,
        mcpCommand: "/fixture/node_modules/.bin/astro-inspector-mcp",
        mcpArgs: ["--project-root", "/fixture"]
      })
    });
  });
  return { isDisabled: () => disabled };
}

test("Quit Extension closes the locator until the dev server restarts", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  const session = await mockSessionEndpoint(page);
  await page.goto("/");

  const launcher = page.locator("[data-astro-ai-locator-launcher]");
  await expect(launcher).toBeVisible();
  expect(session.isDisabled()).toBe(false);

  await launcher.click();
  await page.locator("[data-ui-quit]").click();

  await expect(page.locator("[data-astro-ai-locator-toast]")).toContainText(
    "Restart the dev server"
  );
  await expect(launcher).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-astro-ai-locator-ready",
    ""
  );
  expect(session.isDisabled()).toBe(true);

  // The trigger key must be inert now that every listener is gone.
  await page.getByTestId("card-alpha").hover();
  await page.keyboard.down("Alt");
  await expect(page.locator("[data-astro-ai-locator-overlay]")).toHaveCount(0);
  await page.keyboard.up("Alt");

  // A reload keeps it closed because the dev server process holds the flag.
  await page.reload();
  await expect(page.locator("[data-astro-ai-locator-launcher]")).toHaveCount(0);
  await expect(
    page.locator("[data-astro-ai-locator-overlay]")
  ).toHaveCount(0);
});

test("Copy MCP Prompt puts an agent-ready setup message on the clipboard", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  await mockSessionEndpoint(page);
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));

  await page.locator("[data-astro-ai-locator-launcher]").click();
  // Located by attribute, not accessible name: the label itself is asserted
  // below and a name-based locator would stop matching when it flips.
  const copyButton = page.locator("[data-ui-copy-mcp]");
  await expect(copyButton).toHaveText("Copy MCP Prompt");

  // Quit sits left of Copy, and Copy carries the active overlay color.
  await expect(page.locator(".footer .footer-button")).toHaveText([
    "Quit Extension",
    "Copy MCP Prompt"
  ]);
  await expect(copyButton).toHaveCSS("background-color", "rgb(124, 58, 237)");

  await copyButton.click();

  // The label reverts after 1.8s, so check it before reading the clipboard.
  await expect(copyButton).toHaveText("Copied ✓");

  const copied = await page.evaluate(() =>
    navigator.clipboard.readText()
  );

  expect(copied).toContain("get_astro_element_by_hash");
  expect(copied).toContain(".cursor/mcp.json");
  const json = copied.slice(copied.indexOf("{"), copied.lastIndexOf("}") + 1);
  expect(JSON.parse(json)).toEqual({
    mcpServers: {
      "astro-inspector": {
        command: "/fixture/node_modules/.bin/astro-inspector-mcp",
        args: ["--project-root", "/fixture"]
      }
    }
  });

  await expect(copyButton).toHaveText("Copy MCP Prompt");
});

test("Alt hover reveals the page map, annotated parent, current target, and structured label", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
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
  const parentBoxes = overlay.locator(".parent-box");
  const parentBox = overlay.locator(
    '.parent-box[data-parent-level="1"]'
  );
  const label = overlay.locator(".label");
  await expect(overlay).toBeVisible();
  await expect(parentBoxes).toHaveCount(3);
  await expect(currentBox).toHaveCSS("border-top-style", "solid");
  await expect(currentBox).toHaveCSS("border-top-width", "2px");
  await expect(currentBox).toHaveCSS(
    "border-top-color",
    "rgba(139, 92, 246, 0.9)"
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
    "rgba(139, 92, 246, 0.7)"
  );
  await expect(parentBox).toHaveCSS("outline-offset", "2px");
  await expect(parentBox).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)"
  );
  await expect(parentBox.locator(".label")).toHaveCount(0);
  await expect(
    overlay.locator('.parent-box[data-parent-level="2"]')
  ).toBeHidden();
  await expect(
    overlay.locator('.parent-box[data-parent-level="3"]')
  ).toBeHidden();
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
  await expect(label.locator(".label-tag")).toHaveCSS("font-weight", "600");
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

test("hover label marks the source framework with a brand icon", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  await page.goto("/");

  const overlay = page.locator("[data-astro-ai-locator-overlay]");
  const label = overlay.locator(".label");
  const icon = label.locator(".label-icon");
  const astroMark = label.locator(".icon-astro");
  const reactMark = label.locator(".icon-react");

  await page.getByTestId("card-alpha").hover();
  await page.keyboard.down("Alt");

  await expect(label).toHaveAttribute("data-framework", "astro");
  await expect(icon).toBeVisible();
  await expect(astroMark).toBeVisible();
  await expect(reactMark).toBeHidden();
  await expect(astroMark).toHaveCSS("fill", "rgb(188, 82, 238)");
  await expect(icon).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(icon).toHaveCSS("border-radius", "50%");
  const iconBounds = await icon.boundingBox();
  expect(iconBounds?.width).toBeCloseTo(14, 0);
  expect(iconBounds?.height).toBeCloseTo(14, 0);

  // The same overlay instance has to swap marks, not stack them.
  await page.getByTestId("react-child-label").hover();
  await expect(label).toHaveAttribute("data-framework", "react");
  await expect(reactMark).toBeVisible();
  await expect(astroMark).toBeHidden();
  await expect(reactMark).toHaveCSS("fill", "rgb(97, 218, 251)");

  // An untracked extension drops the icon slot instead of leaving a gap.
  await page
    .getByTestId("react-child-label")
    .evaluate((element) =>
      element.setAttribute("data-astro-ai-locator-file", "src/Card.vue")
    );
  await page.getByTestId("card-alpha").hover();
  await page.getByTestId("react-child-label").hover();

  await expect(label).toHaveText(/Card\.vue/u);
  await expect(label).not.toHaveAttribute("data-framework", /.*/u);
  await expect(icon).toBeHidden();

  await page.keyboard.up("Alt");
});

test("hover label flips and clamps inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 320 });
  await mockSettingsEndpoint(page);
  await page.goto("/");
  const target = page.getByTestId("card-alpha");
  const label = page
    .locator("[data-astro-ai-locator-overlay]")
    .locator(".label");

  await target.evaluate((element) => {
    Object.assign((element as HTMLElement).style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "48px",
      height: "28px",
      zIndex: "1000"
    });
    element.setAttribute(
      "data-astro-ai-locator-source-tag",
      `VeryLongSourceComponent${"X".repeat(200)}`
    );
  });
  await target.hover();
  await page.keyboard.down("Alt");

  await expect(label).toHaveAttribute("data-placement", "below");
  await expect(label).toHaveCSS("box-sizing", "border-box");
  await expect(label).toHaveCSS("text-overflow", "ellipsis");
  await expect(label).toHaveCSS("white-space", "nowrap");
  const topLeft = await label.boundingBox();
  const initialViewport = page.viewportSize();
  expect(topLeft?.x).toBeGreaterThanOrEqual(8);
  expect(topLeft?.y).toBeGreaterThanOrEqual(8);
  expect((topLeft?.x ?? 0) + (topLeft?.width ?? 0)).toBeLessThanOrEqual(
    (initialViewport?.width ?? 0) - 8
  );
  expect((topLeft?.y ?? 0) + (topLeft?.height ?? 0)).toBeLessThanOrEqual(
    (initialViewport?.height ?? 0) - 8
  );

  await target.evaluate((element) => {
    const style = (element as HTMLElement).style;
    style.left = "auto";
    style.top = "auto";
    style.right = "0";
    style.bottom = "0";
    window.dispatchEvent(new Event("resize"));
  });

  await expect(label).toHaveAttribute("data-placement", "above");
  const bottomRight = await label.boundingBox();
  const viewport = page.viewportSize();
  expect(bottomRight?.x).toBeGreaterThanOrEqual(8);
  expect(bottomRight?.y).toBeGreaterThanOrEqual(8);
  expect((bottomRight?.x ?? 0) + (bottomRight?.width ?? 0)).toBeLessThanOrEqual(
    (viewport?.width ?? 0) - 8
  );
  expect(
    (bottomRight?.y ?? 0) + (bottomRight?.height ?? 0)
  ).toBeLessThanOrEqual((viewport?.height ?? 0) - 8);

  await page.setViewportSize({ width: 200, height: 280 });
  await expect
    .poll(async () => label.boundingBox())
    .not.toEqual(bottomRight);
  const resized = await label.boundingBox();
  const resizedViewport = page.viewportSize();
  expect(resized?.x).toBeGreaterThanOrEqual(8);
  expect(resized?.y).toBeGreaterThanOrEqual(8);
  expect((resized?.x ?? 0) + (resized?.width ?? 0)).toBeLessThanOrEqual(
    (resizedViewport?.width ?? 0) - 8
  );
  expect((resized?.y ?? 0) + (resized?.height ?? 0)).toBeLessThanOrEqual(
    (resizedViewport?.height ?? 0) - 8
  );
  expect(resized?.width ?? 0).toBeLessThan(bottomRight?.width ?? 0);
  await page.keyboard.up("Alt");
});

test("parent levels skip zero-size and duplicate metadata ancestors", async ({
  page
}) => {
  const settings = await mockSettingsEndpoint(page);
  await page.goto("/");
  const child = page.getByTestId("react-child-label");
  const expectedRects = await child.evaluate((element) => {
    const file = element.getAttribute("data-astro-ai-locator-file");
    const loc = element.getAttribute("data-astro-ai-locator-loc");
    const originalParent = element.parentElement;
    if (!file || !loc || !originalParent) {
      throw new Error("Fixture child is missing locator metadata");
    }

    const makeWrapper = (
      testId: string,
      padding: number
    ): HTMLSpanElement => {
      const wrapper = document.createElement("span");
      wrapper.dataset.testid = testId;
      wrapper.setAttribute("data-astro-ai-locator-file", file);
      wrapper.setAttribute("data-astro-ai-locator-loc", loc);
      wrapper.style.display = "inline-block";
      wrapper.style.padding = `${padding}px`;
      return wrapper;
    };

    const nearest = makeWrapper("parent-nearest", 4);
    const duplicate = makeWrapper("parent-duplicate", 0);
    const zero = makeWrapper("parent-zero", 0);
    const second = makeWrapper("parent-second", 8);
    const third = makeWrapper("parent-third", 12);
    originalParent.replaceChild(third, element);
    third.append(second);
    second.append(zero);
    zero.append(duplicate);
    duplicate.append(nearest);
    nearest.append(element);

    zero.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    duplicate.getBoundingClientRect = () =>
      nearest.getBoundingClientRect();

    return [nearest, second, third].map((parent) => {
      const rect = parent.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      };
    });
  });

  await page.locator("[data-astro-ai-locator-launcher]").click();
  await page
    .getByRole("group", { name: "Parent levels" })
    .getByRole("button", { name: "3", exact: true })
    .click();
  await expect.poll(settings.current).toMatchObject({ parentLevels: 3 });
  await page.keyboard.press("Escape");
  await child.hover();
  await page.keyboard.down("Alt");

  const overlay = page.locator("[data-astro-ai-locator-overlay]");
  const parentBoxes = overlay.locator(".parent-box");
  const expectedOpacity = [0.7, 0.6, 0.45];
  for (const [index, opacity] of expectedOpacity.entries()) {
    const parentBox = parentBoxes.nth(index);
    await expect(parentBox).toBeVisible();
    await expect(parentBox).toHaveCSS(
      "outline-color",
      `rgba(139, 92, 246, ${opacity})`
    );
    await expect(parentBox).toHaveCSS("outline-width", "2px");
    await expect(parentBox).toHaveCSS("outline-offset", "2px");
    await expect(parentBox).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)"
    );
    await expect(parentBox.locator(".label")).toHaveCount(0);

    const actualRect = await parentBox.boundingBox();
    const expectedRect = expectedRects[index];
    expect(actualRect).not.toBeNull();
    expect(expectedRect).toBeDefined();
    if (!actualRect || !expectedRect) {
      throw new Error(`Parent level ${index + 1} has no rendered rect`);
    }
    expect(actualRect.x).toBeCloseTo(expectedRect.x, 0);
    expect(actualRect.y).toBeCloseTo(expectedRect.y, 0);
    expect(actualRect.width).toBeCloseTo(expectedRect.width, 0);
    expect(actualRect.height).toBeCloseTo(expectedRect.height, 0);
  }
  await expect(overlay.locator(".label")).toHaveCount(1);
  await page.keyboard.up("Alt");

  await page.locator("[data-astro-ai-locator-launcher]").click();
  await page
    .getByRole("group", { name: "Parent levels" })
    .getByRole("button", { name: "0", exact: true })
    .click();
  await expect.poll(settings.current).toMatchObject({ parentLevels: 0 });
  await page.keyboard.press("Escape");
  await child.hover();
  await page.keyboard.down("Alt");
  for (const parentBox of await parentBoxes.all()) {
    await expect(parentBox).toBeHidden();
  }
  await expect(overlay.locator(".box")).toBeVisible();
  await expect(overlay.locator(".label")).toHaveCount(1);
  await page.keyboard.up("Alt");
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

test("copy toast is centered, large, and restarts its pop animation", async ({
  page
}) => {
  await page.setViewportSize({ width: 240, height: 320 });
  await page.goto("/");
  const target = page.getByTestId("card-alpha");
  const toast = page.locator("[data-astro-ai-locator-toast]");
  await toast.evaluate((element) => {
    const state = { animationNames: [] as string[] };
    (
      window as unknown as {
        __astroAiLocatorToastAnimationState: typeof state;
      }
    ).__astroAiLocatorToastAnimationState = state;
    element.addEventListener("animationstart", (event) => {
      state.animationNames.push((event as AnimationEvent).animationName);
    });
  });

  await target.click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect(toast).toHaveAttribute("data-visible", "");
  await expect(toast).toHaveCSS("font-size", "14px");
  await expect(toast).toHaveCSS(
    "animation-name",
    "astro-ai-locator-toast-pop"
  );
  await expect(toast).toHaveCSS("box-sizing", "border-box");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __astroAiLocatorToastAnimationState: {
                animationNames: string[];
              };
            }
          ).__astroAiLocatorToastAnimationState.animationNames
      )
    )
    .toEqual(["astro-ai-locator-toast-pop"]);

  await toast.evaluate((element) => {
    element.textContent = `Copied ${"a-very-long-locator-message-".repeat(20)}`;
  });
  const untransformedHeight = await toast.evaluate((element) => {
    const animation = element.getAnimations()[0];
    if (!animation) {
      throw new Error("Normal toast animation was not created");
    }
    animation.pause();
    animation.currentTime = 126;
    return (element as HTMLElement).offsetHeight;
  });
  const firstBox = await toast.boundingBox();
  const viewport = page.viewportSize();
  expect(untransformedHeight).toBeGreaterThanOrEqual(44);
  expect(firstBox?.x).toBeGreaterThanOrEqual(16);
  expect((firstBox?.x ?? 0) + (firstBox?.width ?? 0)).toBeLessThanOrEqual(
    (viewport?.width ?? 0) - 16
  );
  expect((firstBox?.x ?? 0) + (firstBox?.width ?? 0) / 2).toBeCloseTo(
    (viewport?.width ?? 0) / 2,
    0
  );
  await toast.evaluate((element) => {
    element.getAnimations()[0]?.play();
  });

  await page.waitForTimeout(1000);
  await target.click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __astroAiLocatorToastAnimationState: {
                animationNames: string[];
              };
            }
          ).__astroAiLocatorToastAnimationState.animationNames
      )
    )
    .toEqual([
      "astro-ai-locator-toast-pop",
      "astro-ai-locator-toast-pop"
    ]);

  await page.waitForTimeout(1000);
  await expect(toast).toHaveAttribute("data-visible", "");
  await expect(toast).not.toHaveAttribute("data-visible", "", {
    timeout: 1200
  });
});

for (const copyCase of [
  {
    name: "Tag only",
    fields: ["tag"] as ContextField[],
    locationFormat: "path" as LocationFormat,
    target: "forwarded-button"
  },
  {
    name: "Path only",
    fields: ["location"] as ContextField[],
    locationFormat: "path" as LocationFormat,
    target: "card-alpha"
  },
  {
    name: "Path with Line",
    fields: ["location", "line"] as ContextField[],
    locationFormat: "path" as LocationFormat,
    target: "card-alpha"
  },
  {
    name: "Tag with Module name and Line",
    fields: ["tag", "location", "line"] as ContextField[],
    locationFormat: "moduleName" as LocationFormat,
    target: "forwarded-button"
  },
  {
    name: "Module name",
    fields: ["location"] as ContextField[],
    locationFormat: "moduleName" as LocationFormat,
    target: "card-alpha"
  }
]) {
  test(`Copy As copies ${copyCase.name}`, async ({ page }) => {
    await mockSettingsEndpoint(page, "alt", "violet", 1, {
      copyMode: "context",
      contextFields: copyCase.fields,
      locationFormat: copyCase.locationFormat
    });
    await page.goto("/");
    await page.evaluate(() => navigator.clipboard.writeText(""));

    const target = page.getByTestId(copyCase.target);
    const metadata = await target.evaluate((element) => ({
      file: element.getAttribute("data-astro-ai-locator-file"),
      location: element.getAttribute("data-astro-ai-locator-loc"),
      sourceTag: element.getAttribute("data-astro-ai-locator-source-tag"),
      domTag: element.localName
    }));
    if (!metadata.file || !metadata.location || !metadata.sourceTag) {
      throw new Error("Copy As fixture is missing locator metadata");
    }

    const tag =
      metadata.sourceTag === metadata.domTag
        ? `<${metadata.sourceTag}>`
        : `<${metadata.sourceTag}→${metadata.domTag}>`;
    const workspacePath = `/tests/fixtures/basic/${metadata.file}`;
    const locationValue =
      copyCase.locationFormat === "moduleName"
        ? path.posix.basename(metadata.file)
        : workspacePath;
    const expectedParts: string[] = [];
    if (copyCase.fields.includes("tag")) {
      expectedParts.push(tag);
    }
    if (copyCase.fields.includes("location")) {
      expectedParts.push(
        copyCase.fields.includes("line")
          ? `${locationValue}:${metadata.location}`
          : locationValue
      );
    }
    const expected = expectedParts.join(" | ");

    await target.click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(expected);
    await expect(
      page.locator("[data-astro-ai-locator-toast]")
    ).toContainText("Copied context");
  });
}

test("Copy As prompt fallback receives the exact Context payload", async ({
  page
}) => {
  await mockSettingsEndpoint(page, "alt", "violet", 1, {
    copyMode: "context",
    contextFields: ["tag", "location", "line"],
    locationFormat: "path"
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: async () => {
        throw new Error("clipboard blocked");
      }
    });
    Document.prototype.execCommand = () => false;
    window.prompt = (message, value) => {
      document.documentElement.dataset.copyPromptMessage = message;
      document.documentElement.dataset.copyPromptValue = value ?? "";
      return null;
    };
  });
  await page.goto("/");

  const target = page.getByTestId("forwarded-button");
  const location = await target.getAttribute("data-astro-ai-locator-loc");
  if (!location) {
    throw new Error("Copy As fixture is missing a source location");
  }
  const expected =
    `<ForwardedButton→button> | /tests/fixtures/basic/src/pages/index.astro:${location}`;
  await target.click({ modifiers: ["Alt"] });

  await expect(page.locator("html")).toHaveAttribute(
    "data-copy-prompt-value",
    expected
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-copy-prompt-message",
    "Copy Astro locator context:"
  );
});

test("Copy As does not copy when registration fails", async ({ page }) => {
  await mockSettingsEndpoint(page, "alt", "violet", 1, {
    copyMode: "context",
    contextFields: ["tag"],
    locationFormat: "path"
  });
  await page.route("**/@astro-inspector/register", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "registration failed" })
    });
  });
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText("untouched"));

  await page
    .getByTestId("card-alpha")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("untouched");
  await expect(
    page.locator("[data-astro-ai-locator-toast]")
  ).toContainText("Registration failed with HTTP 500");
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

test("a forwarded component resolves to its call site, not its definition", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  await mockSessionEndpoint(page);
  await page.goto("/");

  const forwarded = page.getByTestId("forwarded-button");
  await expect(forwarded).toHaveAttribute(
    "data-astro-ai-locator-file",
    /index\.astro$/u
  );
  await expect(forwarded).toHaveAttribute(
    "data-astro-ai-locator-source-tag",
    "ForwardedButton"
  );
});

test("locator attributes survive hydration unchanged", async ({
  page,
  request
}) => {
  await mockSettingsEndpoint(page);
  await mockSessionEndpoint(page);

  // 1. SSR 이 내려보낸 원본 HTML 에서 값을 읽는다.
  const html = await (await request.get("/")).text();
  const ssrMatches = [
    ...html.matchAll(
      /data-astro-ai-locator-file="([^"]*ReactIsland\.tsx)"\s+data-astro-ai-locator-loc="(\d+:\d+)"/gu
    )
  ].map((match) => `${match[1]}@${match[2]}`);
  expect(ssrMatches.length).toBeGreaterThan(0);

  // 2. 브라우저가 하이드레이션에 쓰는 client 모듈에서 같은 값을 읽는다.
  //    하이드레이션은 서버가 보낸 속성을 덮어쓰지 않으므로 DOM 만 봐서는 두 파이프라인의
  //    불일치가 드러나지 않는다. 실제로 갈라지는 지점은 두 파이프라인이 내보낸 모듈이다.
  const clientModule = await (
    await request.get("/src/components/ReactIsland.tsx")
  ).text();
  const clientMatches = [
    ...clientModule.matchAll(
      /"data-astro-ai-locator-file": "([^"]*ReactIsland\.tsx)",\s*"data-astro-ai-locator-loc": "(\d+:\d+)"/gu
    )
  ].map((match) => `${match[1]}@${match[2]}`);

  expect(clientMatches).toEqual(ssrMatches);

  // 3. 하이드레이션 뒤 DOM 도 같은 값을 유지한다.
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute(
    "data-astro-ai-locator-ready",
    ""
  );
  const domMatches = await page.evaluate(() =>
    [...document.querySelectorAll("[data-astro-ai-locator-file]")]
      .map((element) => ({
        file: element.getAttribute("data-astro-ai-locator-file") ?? "",
        loc: element.getAttribute("data-astro-ai-locator-loc") ?? ""
      }))
      .filter((entry) => entry.file.endsWith("ReactIsland.tsx"))
      .map((entry) => `${entry.file}@${entry.loc}`)
  );

  expect(domMatches).toEqual(ssrMatches);
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

test("a real DOM overlay blocks annotated elements behind it", async ({
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
  ).toHaveText(/^<a>│ReactIsland\.tsx│\d+:\d+$/u);
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
    sourceTag: "a",
    domTag: "a"
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
    "Open Astro Inspector settings"
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
  await expect(popover).toContainText("Copy As");
  await expect(popover).toContainText("Preferences");
  await expect(popover).toContainText("Overlay Color");
  await expect(popover).toContainText("Parent Levels");
  const sectionHeadings = popover.locator(".section-heading");
  await expect(sectionHeadings).toHaveCount(3);
  for (const heading of await sectionHeadings.all()) {
    await expect(heading).toHaveCSS("color", "rgb(244, 244, 245)");
    await expect(heading).toHaveCSS("font-size", "12px");
    await expect(heading).toHaveCSS("font-weight", "600");
  }
  await expect(popover.getByText(/^Drag to move\./u)).toHaveCount(0);
  await expect(popover.locator("[data-ui-color-chip]")).toHaveCount(4);
  const preferenceRows = popover.locator(".preference-row");
  await expect(preferenceRows).toHaveCount(2);
  for (const row of await preferenceRows.all()) {
    await expect(row).toHaveCSS("height", "28px");
    await expect(row).toHaveCSS("font-weight", "400");
    await expect(row).toHaveCSS("color", "rgb(250, 250, 250)");
  }
  const parentGroup = popover.getByRole("group", {
    name: "Parent levels"
  });
  const parentButtons = parentGroup.getByRole("button");
  await expect(parentButtons).toHaveCount(4);
  await expect(
    parentGroup.getByRole("button", { name: "1", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    parentGroup.getByRole("button", { name: "0", exact: true })
  ).toHaveAttribute("aria-pressed", "false");
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
  await expect.poll(() => settings.current().triggerKey).toBe("control");
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

test("Copy As defaults to Hash between Trigger and Preferences", async ({
  page
}) => {
  await mockSettingsEndpoint(page);
  await page.goto("/");
  await page.locator("[data-astro-ai-locator-launcher]").click();

  const popover = page.locator("[data-astro-ai-locator-popover]");
  await expect(popover.locator(".section-heading")).toHaveText([
    "Trigger",
    "Copy As",
    "Preferences"
  ]);

  const copySection = popover.locator("[data-copy-as-section]");
  const copyModes = copySection.getByRole("radiogroup", {
    name: "Copy mode"
  });
  const hashMode = copyModes.getByRole("radio", { name: "Hash" });
  const contextMode = copyModes.getByRole("radio", {
    name: "Context"
  });
  const cue = contextMode.locator("[data-context-cue]");
  const contextPanel = copySection.locator("[data-context-options]");
  const triggerChoice = popover.getByRole("button", {
    name: "Option / Alt"
  });

  await expect(hashMode).toHaveAttribute("aria-checked", "true");
  await expect(contextMode).toHaveAttribute("aria-checked", "false");
  await expect(contextMode).toHaveAttribute("aria-expanded", "false");
  await expect(contextMode).toHaveAttribute(
    "aria-controls",
    "astro-ai-locator-context-options"
  );
  await expect(
    copySection.locator("[data-context-disclosure]")
  ).toHaveCount(0);
  await expect(cue).toHaveCSS("pointer-events", "none");
  await expect(cue).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(
    hashMode.locator("[data-copy-mode-keycap]")
  ).toHaveText("#");
  await expect(
    contextMode.locator("[data-copy-mode-keycap]")
  ).toHaveText("@");
  await expect(
    hashMode.locator("[data-copy-mode-keycap]")
  ).toHaveCSS("background-color", "rgb(124, 58, 237)");
  await expect(
    contextMode.locator("[data-copy-mode-keycap]")
  ).toHaveCSS("background-color", "rgba(255, 255, 255, 0.1)");
  await expect(contextPanel).toHaveAttribute("aria-hidden", "true");
  await expect(
    copySection.locator('[data-context-field="location"]')
  ).toHaveAttribute("tabindex", "-1");
  await expect(
    hashMode.locator("[data-copy-mode-keycap]")
  ).toHaveCSS("font-weight", "400");
  await expect(
    contextMode.locator("[data-copy-mode-keycap]")
  ).toHaveCSS("font-weight", "400");
  await expect(
    popover
      .getByRole("group", { name: "Parent levels" })
      .getByRole("button")
      .first()
  ).toHaveCSS("font-weight", "400");

  const triggerBox = await triggerChoice.boundingBox();
  const hashBox = await hashMode.boundingBox();
  const contextBox = await contextMode.boundingBox();
  expect(hashBox?.width).toBeCloseTo(triggerBox?.width ?? 0, 0);
  expect(contextBox?.width).toBeCloseTo(triggerBox?.width ?? 0, 0);
});

test("Copy As changes show copy-specific feedback", async ({ page }) => {
  await mockSettingsEndpoint(page);
  await page.goto("/");
  await page.locator("[data-astro-ai-locator-launcher]").click();

  const copySection = page.locator("[data-copy-as-section]");
  const toast = page.locator("[data-astro-ai-locator-toast]");
  const hashMode = copySection.getByRole("radio", { name: "Hash" });
  const contextMode = copySection.getByRole("radio", { name: "Context" });
  const tag = copySection.getByRole("checkbox", { name: "Tag" });
  const moduleName = copySection.getByRole("radio", {
    name: "Module name"
  });

  await contextMode.click();
  await expect(toast).toHaveText("Copy mode changed to Context");

  await tag.click();
  await expect(toast).toHaveText("Copy context updated");

  await moduleName.click();
  await expect(toast).toHaveText("Copy context updated");

  await hashMode.click();
  await expect(toast).toHaveText("Copy mode changed to Hash");
});

test("Copy As enforces Location and Line dependencies while retaining format", async ({
  page
}) => {
  const settings = await mockSettingsEndpoint(page);
  await page.goto("/");
  await page.locator("[data-astro-ai-locator-launcher]").click();

  const copySection = page.locator("[data-copy-as-section]");
  const contextMode = copySection.getByRole("radio", { name: "Context" });
  const cue = contextMode.locator("[data-context-cue]");
  await contextMode.click();

  const contextPanel = copySection.locator("[data-context-options]");
  const tag = copySection.getByRole("checkbox", { name: "Tag" });
  const location = copySection.getByRole("checkbox", {
    name: "Location"
  });
  const line = copySection.getByRole("checkbox", { name: "Line" });
  const formatPanel = copySection.locator("[data-location-format-options]");
  const pathOption = copySection.getByRole("radio", {
    name: "Path",
    exact: true
  });
  const moduleName = copySection.getByRole("radio", {
    name: "Module name"
  });

  await expect.poll(settings.current).toMatchObject({
    copyMode: "context",
    contextFields: ["location", "line"],
    locationFormat: "path"
  });
  await expect(contextMode).toHaveAttribute("aria-expanded", "true");
  await expect(contextPanel).toHaveAttribute("aria-hidden", "false");
  await expect(contextPanel).toHaveCSS(
    "transition-duration",
    /^0\.18s(?:, 0\.18s)?$/u
  );
  await expect(cue).toHaveCSS("transition-duration", "0.18s");
  await expect(tag).toHaveAttribute("aria-checked", "false");
  await expect(location).toHaveAttribute("aria-checked", "true");
  await expect(location).toHaveAttribute(
    "aria-controls",
    "astro-ai-locator-location-format-options"
  );
  await expect(line).toHaveAttribute("aria-checked", "true");
  await expect(line).not.toHaveAttribute("aria-controls", /.+/u);
  await expect(pathOption).toHaveAttribute("aria-checked", "true");
  await expect(moduleName).toHaveAttribute("aria-checked", "false");
  await expect(formatPanel).toHaveAttribute("aria-hidden", "false");
  await expect(formatPanel).toHaveCSS(
    "transition-duration",
    /^0\.18s(?:, 0\.18s)?$/u
  );

  const modeBox = await contextMode.boundingBox();
  const locationBox = await location.boundingBox();
  const pathBox = await pathOption.boundingBox();
  expect(modeBox).not.toBeNull();
  expect(locationBox).not.toBeNull();
  expect(pathBox).not.toBeNull();
  expect(locationBox?.x ?? 0).toBeGreaterThan(modeBox?.x ?? 0);
  expect(pathBox?.x ?? 0).toBeGreaterThan(locationBox?.x ?? 0);

  await location.click();
  await expect.poll(settings.current).toMatchObject({
    copyMode: "hash",
    contextFields: []
  });
  await expect(location).toHaveAttribute("aria-checked", "false");
  await expect(line).toHaveAttribute("aria-checked", "false");
  await expect(line).toBeDisabled();
  await expect(formatPanel).toHaveAttribute("aria-hidden", "true");
  await expect(contextMode).toHaveAttribute("aria-expanded", "true");

  await location.click();
  await expect.poll(settings.current).toMatchObject({
    copyMode: "context",
    contextFields: ["location"],
    locationFormat: "path"
  });
  await expect(line).toBeEnabled();
  await expect(line).toHaveAttribute("aria-checked", "false");
  await expect(formatPanel).toHaveAttribute("aria-hidden", "false");

  await moduleName.click();
  await expect.poll(settings.current).toMatchObject({
    copyMode: "context",
    contextFields: ["location"],
    locationFormat: "moduleName"
  });
  await expect(moduleName).toHaveAttribute("aria-checked", "true");

  await line.click();
  await expect.poll(settings.current).toMatchObject({
    contextFields: ["location", "line"]
  });
  await location.click();
  await location.click();
  await expect.poll(settings.current).toMatchObject({
    copyMode: "context",
    contextFields: ["location"],
    locationFormat: "moduleName"
  });
  await expect(moduleName).toHaveAttribute("aria-checked", "true");
  await expect(line).toHaveAttribute("aria-checked", "false");
});

test("Copy As keeps Context disclosure independent and starts closed after reload", async ({
  page
}) => {
  const settings = await mockSettingsEndpoint(
    page,
    "alt",
    "violet",
    1,
    { contextFields: [] }
  );
  await page.goto("/");
  await page.locator("[data-astro-ai-locator-launcher]").click();

  const copySection = page.locator("[data-copy-as-section]");
  const hashMode = copySection.getByRole("radio", { name: "Hash" });
  const contextMode = copySection.getByRole("radio", {
    name: "Context"
  });
  const tag = copySection.getByRole("checkbox", { name: "Tag" });

  await contextMode.click();
  await expect(contextMode).toHaveAttribute("aria-expanded", "true");
  await expect(hashMode).toHaveAttribute("aria-checked", "true");
  await expect(contextMode).toHaveAttribute("aria-checked", "false");
  expect(settings.current().contextFields).toEqual([]);

  await tag.click();
  await expect.poll(settings.current).toMatchObject({
    copyMode: "context",
    contextFields: ["tag"]
  });
  await expect(contextMode).toHaveAttribute("aria-checked", "true");

  await hashMode.click();
  await expect(hashMode).toHaveAttribute("aria-checked", "true");
  await expect(contextMode).toHaveAttribute("aria-expanded", "true");
  await contextMode.click();
  await expect(contextMode).toHaveAttribute("aria-checked", "true");
  await expect(contextMode).toHaveAttribute("aria-expanded", "true");
  await contextMode.click();
  await expect(contextMode).toHaveAttribute("aria-expanded", "false");
  await contextMode.click();
  await expect(contextMode).toHaveAttribute("aria-expanded", "true");
  await hashMode.click();
  await expect(contextMode).toHaveAttribute("aria-expanded", "true");

  await page.reload();
  await page.locator("[data-astro-ai-locator-launcher]").click();
  await expect(
    page
      .locator("[data-copy-as-section]")
      .getByRole("radio", { name: "Context" })
  ).toHaveAttribute("aria-expanded", "false");
});

test("Copy As restores accepted state after a rejected settings write", async ({
  page
}) => {
  const settings = await mockSettingsEndpoint(page);
  await page.goto("/");
  await page.locator("[data-astro-ai-locator-launcher]").click();

  const copySection = page.locator("[data-copy-as-section]");
  await copySection.getByRole("radio", { name: "Context" }).click();
  const tag = copySection.getByRole("checkbox", { name: "Tag" });
  settings.rejectNextWrite();
  await tag.click();

  await expect(
    page.locator("[data-astro-ai-locator-toast]")
  ).toContainText("HTTP 500");
  await expect(tag).toHaveAttribute("aria-checked", "false");
  await expect(
    copySection.getByRole("radio", { name: "Context" })
  ).toHaveAttribute("aria-checked", "true");
});

test("overlay color presets persist and recolor locator accents", async ({
  page
}) => {
  const settings = await mockSettingsEndpoint(page);
  await page.goto("/");

  const launcher = page.locator("[data-astro-ai-locator-launcher]");
  const popover = page.locator("[data-astro-ai-locator-popover]");
  await launcher.click();

  const colorGroup = popover.getByRole("group", {
    name: "Overlay color"
  });
  const neutral = colorGroup.getByRole("button", { name: "Neutral" });
  const violet = colorGroup.getByRole("button", { name: "Violet" });
  const orange = colorGroup.getByRole("button", { name: "Orange" });
  const sky = colorGroup.getByRole("button", { name: "Sky" });
  await expect(neutral).toBeVisible();
  await expect(violet).toHaveAttribute("aria-pressed", "true");
  await expect(orange).toHaveAttribute("aria-pressed", "false");
  await expect(sky).toBeVisible();

  await orange.click();
  await expect.poll(settings.current).toEqual({
    schemaVersion: 5,
    triggerKey: "alt",
    colorPreset: "orange",
    parentLevels: 1,
    copyMode: "hash",
    contextFields: ["location", "line"],
    locationFormat: "path"
  });
  await expect(orange).toHaveAttribute("aria-pressed", "true");
  await expect(violet).toHaveAttribute("aria-pressed", "false");
  await expect(orange).toHaveCSS(
    "box-shadow",
    "rgba(63, 63, 70, 0.8) 0px 0px 0px 2px, rgb(234, 88, 12) 0px 0px 0px 4px"
  );

  const altChoice = popover.getByRole("button", { name: "Option / Alt" });
  await expect(altChoice.locator("[data-modifier-keycap]")).toHaveCSS(
    "background-color",
    "rgb(234, 88, 12)"
  );
  const controlChoice = popover.getByRole("button", { name: "Control" });
  await controlChoice.hover();
  await expect(controlChoice).toHaveCSS(
    "background-color",
    "rgba(255, 255, 255, 0.14)"
  );

  await page.keyboard.press("Escape");
  const child = page.getByTestId("react-child-label");
  await child.hover();
  await page.keyboard.down("Alt");

  const overlay = page.locator("[data-astro-ai-locator-overlay]");
  await expect(overlay.locator(".box")).toHaveCSS(
    "border-top-color",
    "rgba(251, 146, 60, 0.9)"
  );
  await expect(overlay.locator(".box")).toHaveCSS(
    "background-color",
    "rgba(251, 146, 60, 0.1)"
  );
  await expect(
    overlay.locator('.parent-box[data-parent-level="1"]')
  ).toHaveCSS(
    "outline-color",
    "rgba(251, 146, 60, 0.7)"
  );
  await expect(overlay.locator(".label")).toHaveCSS(
    "background-color",
    "rgb(194, 65, 12)"
  );
  await page.keyboard.up("Alt");

  await page.reload();
  await page.locator("[data-astro-ai-locator-launcher]").click();
  await expect(
    page
      .getByRole("group", { name: "Overlay color" })
      .getByRole("button", { name: "Orange" })
  ).toHaveAttribute("aria-pressed", "true");
});

test("parent level preference persists schema v5", async ({ page }) => {
  const settings = await mockSettingsEndpoint(page);
  await page.goto("/");

  await page.locator("[data-astro-ai-locator-launcher]").click();
  const group = page
    .locator("[data-astro-ai-locator-popover]")
    .getByRole("group", { name: "Parent levels" });
  const levelOne = group.getByRole("button", {
    name: "1",
    exact: true
  });
  const levelThree = group.getByRole("button", {
    name: "3",
    exact: true
  });

  await levelThree.click();

  await expect.poll(settings.current).toEqual({
    schemaVersion: 5,
    triggerKey: "alt",
    colorPreset: "violet",
    parentLevels: 3,
    copyMode: "hash",
    contextFields: ["location", "line"],
    locationFormat: "path"
  });
  await expect(levelThree).toHaveAttribute("aria-pressed", "true");
  await expect(levelThree).toHaveCSS(
    "background-color",
    "rgb(124, 58, 237)"
  );
  await expect(levelOne).toHaveAttribute("aria-pressed", "false");
});

test("parent level changes redraw an active target without deactivating the locator", async ({
  page
}) => {
  const settings = await mockSettingsEndpoint(page);
  await page.goto("/");

  const child = page.getByTestId("react-child-label");
  await child.hover();
  await page.keyboard.down("Alt");

  const overlay = page.locator("[data-astro-ai-locator-overlay]");
  await expect(
    overlay.locator('.parent-box[data-parent-level="1"]')
  ).toBeVisible();
  await page.locator("[data-astro-ai-locator-launcher]").click();
  const parentGroup = page
    .locator("[data-astro-ai-locator-popover]")
    .getByRole("group", { name: "Parent levels" });
  await parentGroup
    .getByRole("button", { name: "0", exact: true })
    .click();
  await expect.poll(settings.current).toMatchObject({ parentLevels: 0 });

  await expect(page.locator("html")).toHaveAttribute(
    "data-astro-ai-locator-active",
    ""
  );
  await expect(overlay).toHaveCount(1);
  await expect(overlay.locator(".box")).toBeVisible();
  for (const parentBox of await overlay.locator(".parent-box").all()) {
    await expect(parentBox).toBeHidden();
  }
  await page.keyboard.up("Alt");
});

test("a rejected parent level write preserves the accepted UI and overlay", async ({
  page
}) => {
  const settings = await mockSettingsEndpoint(page);
  await page.goto("/");
  await page.locator("[data-astro-ai-locator-launcher]").click();

  const parentGroup = page
    .locator("[data-astro-ai-locator-popover]")
    .getByRole("group", { name: "Parent levels" });
  const levelOne = parentGroup.getByRole("button", {
    name: "1",
    exact: true
  });
  const levelThree = parentGroup.getByRole("button", {
    name: "3",
    exact: true
  });
  settings.rejectNextWrite();
  await levelThree.click();
  await expect(
    page.locator("[data-astro-ai-locator-toast]")
  ).toContainText("HTTP 500");

  await expect(levelOne).toHaveAttribute("aria-pressed", "true");
  await expect(levelThree).toHaveAttribute("aria-pressed", "false");
  expect(settings.current().parentLevels).toBe(1);

  await page.keyboard.press("Escape");
  await page.getByTestId("react-child-label").hover();
  await page.keyboard.down("Alt");
  const overlay = page.locator("[data-astro-ai-locator-overlay]");
  await expect(
    overlay.locator('.parent-box[data-parent-level="1"]')
  ).toBeVisible();
  await expect(
    overlay.locator('.parent-box[data-parent-level="2"]')
  ).toBeHidden();
  await expect(
    overlay.locator('.parent-box[data-parent-level="3"]')
  ).toBeHidden();
  await page.keyboard.up("Alt");
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
    "Open Astro Inspector settings"
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

  await page
    .getByTestId("card-alpha")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect(
    page.locator("[data-astro-ai-locator-toast]")
  ).toHaveCSS("animation-name", "astro-ai-locator-toast-fade");
  const reducedMotionToast = page.locator(
    "[data-astro-ai-locator-toast]"
  );
  const reducedMotionFrames = await reducedMotionToast.evaluate(
    (element) => {
      const animation = element.getAnimations()[0];
      const effect = animation?.effect;
      if (!animation || !(effect instanceof KeyframeEffect)) {
        throw new Error("Reduced-motion toast animation was not created");
      }
      const hasTransformKeyframe = effect
        .getKeyframes()
        .some((frame) => "transform" in frame);
      animation.pause();
      animation.currentTime = 0;
      const startTransform = getComputedStyle(element).transform;
      animation.currentTime = 900;
      const middleTransform = getComputedStyle(element).transform;
      return {
        hasTransformKeyframe,
        middleTransform,
        startTransform
      };
    }
  );
  expect(reducedMotionFrames.hasTransformKeyframe).toBe(false);
  expect(reducedMotionFrames.middleTransform).toBe(
    reducedMotionFrames.startTransform
  );

  const launcher = page.locator("[data-astro-ai-locator-launcher]");
  const popover = page.locator("[data-astro-ai-locator-popover]");
  await launcher.click();
  await expect(popover).toBeVisible();
  await expect(popover).toHaveCSS("transition-duration", "0s");

  const copySection = page.locator("[data-copy-as-section]");
  const contextMode = copySection.getByRole("radio", {
    name: "Context"
  });
  await contextMode.click();
  await expect(
    copySection.locator("[data-context-options]")
  ).toHaveCSS("transition-duration", "0s");
  await expect(
    copySection.locator("[data-location-format-options]")
  ).toHaveCSS("transition-duration", "0s");
  await expect(
    contextMode.locator("[data-context-cue]")
  ).toHaveCSS("transition-duration", "0s");
});
