# Parent Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users globally choose `0`, `1`, `2`, or `3` visually useful metadata-bearing parent outlines while preserving the locator's existing hit resolution and popover design.

**Architecture:** Advance the shared settings contract to schema v3 and migrate v1/v2 settings to `parentLevels: 1`. Add one compact control row to the existing Shadow DOM settings panel, then replace the overlay's single parent box with a fixed three-box pool populated by an upward metadata-ancestor traversal. The runtime remains the settings source of truth and redraws the active target only after a persisted settings response is accepted.

**Tech Stack:** TypeScript 6, browser DOM and Shadow DOM APIs, Astro/Vite development integration, Vitest 4, Playwright 1.61.

## Global Constraints

- Allowed values are exactly `0 | 1 | 2 | 3`; the default is `1`.
- The settings object is exactly `{ schemaVersion: 3, triggerKey, colorPreset, parentLevels }`.
- Schema v1 migrates to violet and parent level 1; schema v2 preserves its color and migrates to parent level 1.
- The existing global settings path and authenticated GET/PUT endpoint do not change.
- The popover keeps its current width, padding, dark theme, section structure, and 28px row height.
- Current target is `2px solid / 90%` with 10% fill; parent levels are `2px solid / 70%`, `60%`, and `45%`.
- Parent boxes have `outline-offset: 2px`, no fill, and no label.
- Skip metadata ancestors with zero-size rects or rects matching an already accepted parent within `0.5px` on left, top, width, and height.
- Do not deduplicate parent rects against the current target rect.
- Do not change hit resolution, hover-target selection, pointer scheduling, hashes, manifest, MCP, click, clipboard, FAB, or color-preset behavior.
- Create exactly three parent boxes once; never add or remove boxes during hover.
- This package directory is not a standalone Git repository, so each task ends with a test/review checkpoint rather than staging or committing the untracked parent repository.

---

## File Map

- `src/shared/contracts.ts`: Own `ParentLevels`, allowed values, and the schema-v3 `LocatorSettings` interface.
- `src/settings/store.ts`: Validate v3, migrate v1/v2, provide schema-v3 defaults, and persist only normalized v3 data.
- `src/client/settings-api.ts`: Validate settings endpoint responses as schema v3 and provide the browser fallback.
- `src/client/settings-panel.ts`: Render and operate the accessible `Parent Levels` segmented control.
- `src/client/overlay.ts`: Resolve useful metadata ancestors and render them into the fixed three-box pool.
- `src/client/index.ts`: Apply accepted parent-level changes to the mounted overlay and redraw an active target.
- `tests/unit/settings-store.test.ts`: Cover defaults, migrations, v3 persistence, and invalid parent levels.
- `tests/unit/settings-handler.test.ts`: Cover schema-v3 GET/PUT and invalid parent-level responses.
- `tests/e2e/locator.spec.ts`: Cover popover controls, persistence, visual hierarchy, box reuse, and skip rules.
- `README.md`: Document the preference and visual hierarchy.
- `docs/FUTURE_WORK.md`: Mark the parent-level work complete.

---

### Task 1: Settings schema v3 and migration

**Files:**
- Modify: `src/shared/contracts.ts:1-27`
- Modify: `src/settings/store.ts:1-68`
- Modify: `src/client/settings-api.ts:1-49`
- Test: `tests/unit/settings-store.test.ts`
- Test: `tests/unit/settings-handler.test.ts`

**Interfaces:**
- Produces: `PARENT_LEVELS`, `type ParentLevels = 0 | 1 | 2 | 3`.
- Produces: `LocatorSettings` with `schemaVersion: 3` and `parentLevels: ParentLevels`.
- Produces: `parseLocatorSettings(value: unknown): LocatorSettings`, accepting valid schema v1, v2, or v3 and returning normalized schema v3.
- Consumes later: settings panel, overlay bootstrap, and E2E mock all use the same shared type.

- [ ] **Step 1: Write failing store migration and validation tests**

Update the existing expectations and add explicit lower/upper bound coverage:

```ts
it("migrates valid schema-v1 settings to schema v3", async () => {
  await writeFile(
    settingsPath,
    JSON.stringify({ schemaVersion: 1, triggerKey: "control" }),
    "utf8"
  );

  await expect(new LocatorSettingsStore(settingsPath).read()).resolves.toEqual({
    schemaVersion: 3,
    triggerKey: "control",
    colorPreset: "violet",
    parentLevels: 1
  });
});

it("migrates valid schema-v2 settings to schema v3", async () => {
  await writeFile(
    settingsPath,
    JSON.stringify({
      schemaVersion: 2,
      triggerKey: "meta",
      colorPreset: "sky"
    }),
    "utf8"
  );

  await expect(new LocatorSettingsStore(settingsPath).read()).resolves.toEqual({
    schemaVersion: 3,
    triggerKey: "meta",
    colorPreset: "sky",
    parentLevels: 1
  });
});

it.each([0, 3] as const)(
  "persists schema-v3 parent level %s",
  async (parentLevels) => {
    const value = {
      schemaVersion: 3 as const,
      triggerKey: "alt" as const,
      colorPreset: "orange" as const,
      parentLevels
    };

    await expect(store.write(value)).resolves.toEqual(value);
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual(value);
  }
);

it.each([-1, 1.5, 4, "1"])(
  "rejects invalid parent level %s without touching the file",
  async (parentLevels) => {
    await expect(
      store.write({
        schemaVersion: 3,
        triggerKey: "alt",
        colorPreset: "violet",
        parentLevels
      })
    ).rejects.toThrow("parent levels");
    await expect(readdir(directory)).resolves.toEqual([]);
  }
);
```

Use each test's own temporary `directory`, `settingsPath`, and `store`, following the fixtures already present in the file.

- [ ] **Step 2: Write failing endpoint tests**

Change authenticated GET and valid PUT expectations to:

```ts
{
  schemaVersion: 3,
  triggerKey: "alt",
  colorPreset: "violet",
  parentLevels: 1
}
```

Add:

```ts
it("rejects an unsupported parent level without writing it", async () => {
  const { handler } = await fixture();
  const recorder = responseRecorder();

  await handler(
    requestFor("PUT", {
      schemaVersion: 3,
      triggerKey: "alt",
      colorPreset: "violet",
      parentLevels: 4
    }),
    recorder.response,
    vi.fn()
  );

  expect(recorder.response.statusCode).toBe(400);
  expect(JSON.parse(recorder.body())).toMatchObject({
    error: expect.stringContaining("parent levels")
  });
});
```

- [ ] **Step 3: Run the focused unit tests and confirm RED**

Run:

```bash
./node_modules/.bin/vitest run tests/unit/settings-store.test.ts tests/unit/settings-handler.test.ts
```

Expected: FAIL because defaults and responses still use schema v2 and `parentLevels` is not validated.

- [ ] **Step 4: Add the shared parent-level contract**

In `src/shared/contracts.ts` add:

```ts
export const PARENT_LEVELS = [0, 1, 2, 3] as const;

export type ParentLevels = (typeof PARENT_LEVELS)[number];

export interface LocatorSettings {
  schemaVersion: 3;
  triggerKey: TriggerKey;
  colorPreset: ColorPreset;
  parentLevels: ParentLevels;
}
```

- [ ] **Step 5: Normalize all server-side settings to schema v3**

In `src/settings/store.ts`, set:

```ts
export const DEFAULT_LOCATOR_SETTINGS: LocatorSettings = {
  schemaVersion: 3,
  triggerKey: "alt",
  colorPreset: "violet",
  parentLevels: 1
};

function isParentLevels(value: unknown): value is ParentLevels {
  return PARENT_LEVELS.includes(value as ParentLevels);
}
```

Implement the parser branches in this order:

```ts
if (value.schemaVersion === 1) {
  return {
    schemaVersion: 3,
    triggerKey: value.triggerKey,
    colorPreset: "violet",
    parentLevels: 1
  };
}

if (value.schemaVersion === 2) {
  if (!("colorPreset" in value) || !isColorPreset(value.colorPreset)) {
    throw new Error("Invalid locator settings or color preset");
  }
  return {
    schemaVersion: 3,
    triggerKey: value.triggerKey,
    colorPreset: value.colorPreset,
    parentLevels: 1
  };
}

if (
  value.schemaVersion !== 3 ||
  !("colorPreset" in value) ||
  !isColorPreset(value.colorPreset)
) {
  throw new Error("Invalid locator settings or color preset");
}
if (
  !("parentLevels" in value) ||
  !isParentLevels(value.parentLevels)
) {
  throw new Error("Invalid locator settings or parent levels");
}
return {
  schemaVersion: 3,
  triggerKey: value.triggerKey,
  colorPreset: value.colorPreset,
  parentLevels: value.parentLevels
};
```

Keep the existing trigger-key validation before these branches so its error remains specific.
Update the existing invalid-trigger and invalid-color write payloads to schema
v3 and include `parentLevels: 1`, ensuring each test reaches the validation
branch named by its assertion.

- [ ] **Step 6: Make the browser settings API accept only normalized v3**

Import `PARENT_LEVELS` and `ParentLevels`, add the same `isParentLevels` predicate, change the fallback to schema v3, and require:

```ts
value.schemaVersion === 3 &&
isTriggerKey(value.triggerKey) &&
isColorPreset(value.colorPreset) &&
isParentLevels(value.parentLevels)
```

Return all four fields without browser-side v1/v2 migration; the server owns migration and always responds with normalized v3.

- [ ] **Step 7: Run focused and complete unit tests**

Run:

```bash
./node_modules/.bin/vitest run tests/unit/settings-store.test.ts tests/unit/settings-handler.test.ts
npm test
npm run check
```

Expected: all commands PASS. Review that every new write contains `schemaVersion: 3` and `parentLevels`.

---

### Task 2: Accessible Parent Levels popover control

**Files:**
- Modify: `src/client/settings-panel.ts:1-539`
- Modify: `tests/e2e/locator.spec.ts:1-36`
- Modify: `tests/e2e/locator.spec.ts:513-686`

**Interfaces:**
- Consumes: `PARENT_LEVELS`, `ParentLevels`, and schema-v3 `LocatorSettings`.
- Produces: one `[role="group"][aria-label="Parent levels"]` containing four buttons with `data-parent-level` and `aria-pressed`.
- Produces: full-settings update requests that change only `parentLevels`.

- [ ] **Step 1: Upgrade the E2E settings mock**

Change the helper signature and initial object to:

```ts
async function mockSettingsEndpoint(
  page: Page,
  initialTriggerKey: TriggerKey = "alt",
  initialColorPreset: ColorPreset = "violet",
  initialParentLevels: ParentLevels = 1
) {
  let settings: LocatorSettings = {
    schemaVersion: 3,
    triggerKey: initialTriggerKey,
    colorPreset: initialColorPreset,
    parentLevels: initialParentLevels
  };
```

Import `ParentLevels`, change every exact settings expectation in this E2E file to schema v3, and include the expected parent level.

- [ ] **Step 2: Add failing popover accessibility and persistence assertions**

Extend `"the floating launcher exposes the settings hierarchy"`:

```ts
await expect(popover).toContainText("Parent Levels");
const parentGroup = popover.getByRole("group", {
  name: "Parent levels"
});
const parentButtons = parentGroup.getByRole("button");
await expect(parentButtons).toHaveCount(4);
await expect(parentGroup.getByRole("button", { name: "1" })).toHaveAttribute(
  "aria-pressed",
  "true"
);
await expect(parentGroup.getByRole("button", { name: "0" })).toHaveAttribute(
  "aria-pressed",
  "false"
);
await expect(popover.locator(".preference-row")).toHaveCount(2);
for (const row of await popover.locator(".preference-row").all()) {
  await expect(row).toHaveCSS("height", "28px");
}
```

Add a focused persistence test:

```ts
test("parent level preference persists schema v3", async ({ page }) => {
  const settings = await mockSettingsEndpoint(page);
  await page.goto("/");
  await page.locator("[data-astro-ai-locator-launcher]").click();

  const group = page
    .locator("[data-astro-ai-locator-popover]")
    .getByRole("group", { name: "Parent levels" });
  const levelThree = group.getByRole("button", { name: "3" });
  await levelThree.click();

  await expect.poll(settings.current).toEqual({
    schemaVersion: 3,
    triggerKey: "alt",
    colorPreset: "violet",
    parentLevels: 3
  });
  await expect(levelThree).toHaveAttribute("aria-pressed", "true");
  await expect(levelThree).toHaveCSS(
    "background-color",
    "rgb(124, 58, 237)"
  );
  await expect(group.getByRole("button", { name: "1" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});
```

- [ ] **Step 3: Run the focused browser test and confirm RED**

Run:

```bash
npm run build
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts --grep "floating launcher|parent level preference"
```

Expected: FAIL because the `Parent levels` group does not exist.

- [ ] **Step 4: Render the new 28px preference row**

Generate markup from the shared constant:

```ts
const parentLevelButtonsMarkup = PARENT_LEVELS.map(
  (level) =>
    `<button class="level-button" type="button" data-parent-level="${level}" aria-label="${level}" aria-pressed="false">${level}</button>`
).join("");
```

Append below `Overlay Color` without changing its markup:

```html
<div class="preference-row">
  <span>Parent Levels</span>
  <span class="level-group" role="group" aria-label="Parent levels">
    ${parentLevelButtonsMarkup}
  </span>
</div>
```

Use compact square native buttons:

```css
.level-group {
  display: flex;
  align-items: center;
  gap: 3px;
}
.level-button {
  display: grid;
  width: 22px;
  height: 22px;
  padding: 0;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  cursor: pointer;
  font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, Monaco,
    Consolas, monospace;
}
.level-button:hover {
  background: rgba(255, 255, 255, 0.14);
}
.level-button[aria-pressed="true"] {
  border-color: var(--locator-solid);
  background: var(--locator-solid);
}
.level-button:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}
.level-button:disabled {
  cursor: wait;
  opacity: 0.62;
}
```

- [ ] **Step 5: Wire selection and shared pending state**

Collect the controls:

```ts
const parentLevelButtons = Array.from(
  shadow.querySelectorAll<HTMLButtonElement>("[data-parent-level]")
);
```

In `updateSelectedSettings()` set `aria-pressed` by comparing `Number(button.dataset.parentLevel)` with `currentSettings.parentLevels`. Include the buttons in:

```ts
const settingsButtons = [
  ...choiceButtons,
  ...colorButtons,
  ...parentLevelButtons
];
```

Add click handling:

```ts
parentLevelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const parentLevels = Number(button.dataset.parentLevel);
    if (
      !PARENT_LEVELS.includes(parentLevels as ParentLevels) ||
      parentLevels === currentSettings.parentLevels
    ) {
      return;
    }
    requestSettingsChange({
      ...currentSettings,
      parentLevels: parentLevels as ParentLevels
    });
  });
});
```

- [ ] **Step 6: Run focused E2E and static checks**

Run:

```bash
npm run build
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts --grep "floating launcher|parent level preference|overlay color presets"
npm run check
```

Expected: PASS. Confirm existing trigger rows still hover neutral grey and the popover remains 260px wide.

---

### Task 3: Three-box pool and useful ancestor traversal

**Files:**
- Modify: `src/client/overlay.ts:1-184`
- Modify: `src/client/index.ts:184-252`
- Test: `tests/e2e/locator.spec.ts:38-161`
- Test: `tests/e2e/locator.spec.ts` near the parent preference test

**Interfaces:**
- Consumes: `ParentLevels`.
- Changes: `createOverlay(showAllBoundaries, colorPreset, parentLevels)`.
- Produces: `LocatorOverlay.setParentLevels(parentLevels: ParentLevels): void`.
- Internal: `collectParentRects(target: Element, limit: ParentLevels): DOMRect[]`.

- [ ] **Step 1: Add failing default hierarchy assertions**

Make the first hover test deterministic by calling `mockSettingsEndpoint(page)` before navigation. Select the nearest box by stable level:

```ts
const parentBox = overlay.locator(
  '.parent-box[data-parent-level="1"]'
);
await expect(overlay.locator(".parent-box")).toHaveCount(3);
await expect(currentBox).toHaveCSS(
  "border-top-color",
  "rgba(139, 92, 246, 0.9)"
);
await expect(parentBox).toHaveCSS(
  "outline-color",
  "rgba(139, 92, 246, 0.6)"
);
await expect(
  overlay.locator('.parent-box[data-parent-level="2"]')
).toBeHidden();
await expect(
  overlay.locator('.parent-box[data-parent-level="3"]')
).toBeHidden();
```

Keep the existing assertions proving no parent fill or label and that the closest metadata ancestor, rather than an unannotated wrapper, supplies the rect.

- [ ] **Step 2: Add a failing three-level traversal test**

Create deterministic metadata wrappers around the React child in the page. Give valid wrappers different padding, patch one metadata wrapper to a zero rect, and patch another to duplicate the nearest accepted rect:

```ts
const expectedRects = await child.evaluate((element) => {
  const file = element.getAttribute("data-astro-ai-locator-file");
  const loc = element.getAttribute("data-astro-ai-locator-loc");
  if (!file || !loc || !element.parentElement) {
    throw new Error("Fixture child is missing locator metadata");
  }

  const makeWrapper = (
    testId: string,
    padding: number
  ): HTMLDivElement => {
    const wrapper = document.createElement("div");
    wrapper.dataset.testid = testId;
    wrapper.setAttribute("data-astro-ai-locator-file", file);
    wrapper.setAttribute("data-astro-ai-locator-loc", loc);
    wrapper.style.display = "block";
    wrapper.style.padding = `${padding}px`;
    return wrapper;
  };

  const nearest = makeWrapper("parent-nearest", 4);
  const duplicate = makeWrapper("parent-duplicate", 0);
  const zero = makeWrapper("parent-zero", 0);
  const second = makeWrapper("parent-second", 8);
  const third = makeWrapper("parent-third", 12);
  const originalParent = element.parentElement;
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
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  });
});
```

Open the settings panel, select level 3, close it, hover the child with Alt, then assert:

```ts
const parentBoxes = overlay.locator(".parent-box");
for (const [index, opacity] of [0.6, 0.4, 0.2].entries()) {
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
  await expect(parentBox).toHaveCSS("left", `${expectedRects[index]?.left}px`);
  await expect(parentBox).toHaveCSS("top", `${expectedRects[index]?.top}px`);
  await expect(parentBox).toHaveCSS(
    "width",
    `${expectedRects[index]?.width}px`
  );
  await expect(parentBox).toHaveCSS(
    "height",
    `${expectedRects[index]?.height}px`
  );
}
```

This proves zero-size and duplicate candidates do not consume requested levels because traversal reaches `second` and `third`.

- [ ] **Step 3: Add a failing immediate level-zero assertion**

While the same target is active, invoke the mounted overlay API through the settings UI flow by releasing Alt, selecting `0`, and pressing Alt over the same child again:

```ts
await page.keyboard.up("Alt");
await page.locator("[data-astro-ai-locator-launcher]").click();
await page
  .getByRole("group", { name: "Parent levels" })
  .getByRole("button", { name: "0" })
  .click();
await page.keyboard.press("Escape");
await child.hover();
await page.keyboard.down("Alt");

for (const parentBox of await parentBoxes.all()) {
  await expect(parentBox).toBeHidden();
}
await expect(overlay.locator(".box")).toBeVisible();
await expect(overlay.locator(".label")).toHaveCount(1);
```

- [ ] **Step 4: Run the focused E2E tests and confirm RED**

Run:

```bash
npm run build
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts --grep "Alt hover|three parent|parent level preference"
```

Expected: FAIL because only one parent box exists, current opacity is 85%, and the overlay ignores `parentLevels`.

- [ ] **Step 5: Build the fixed parent-box pool**

Change `createOverlay` to accept the initial level. Render exactly:

```html
<div class="parent-box" data-parent-level="1"></div>
<div class="parent-box" data-parent-level="2"></div>
<div class="parent-box" data-parent-level="3"></div>
<div class="box">
  <span class="label">
    <span class="label-tag"></span>
    <span class="label-separator" aria-hidden="true">│</span>
    <span class="label-file"></span>
    <span class="label-separator" aria-hidden="true">│</span>
    <span class="label-location"></span>
  </span>
</div>
```

Set current and parent colors:

```css
.box {
  border: 2px solid rgba(var(--locator-overlay-rgb), 0.9);
  background: rgba(var(--locator-overlay-rgb), 0.1);
}
.parent-box {
  display: none;
  border: 0;
  outline: 2px solid transparent;
  outline-offset: 2px;
  background: transparent;
}
.parent-box[data-parent-level="1"] {
  outline-color: rgba(var(--locator-overlay-rgb), 0.7);
}
.parent-box[data-parent-level="2"] {
  outline-color: rgba(var(--locator-overlay-rgb), 0.6);
}
.parent-box[data-parent-level="3"] {
  outline-color: rgba(var(--locator-overlay-rgb), 0.45);
}
```

Collect with `querySelectorAll`, assert a pool length of exactly three during initialization, and keep the array for the overlay lifetime.

- [ ] **Step 6: Implement useful-parent collection**

Add:

```ts
const RECT_TOLERANCE = 0.5;

function hasVisibleRect(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function hasMatchingRect(rect: DOMRect, accepted: DOMRect[]): boolean {
  return accepted.some(
    (candidate) =>
      Math.abs(candidate.left - rect.left) <= RECT_TOLERANCE &&
      Math.abs(candidate.top - rect.top) <= RECT_TOLERANCE &&
      Math.abs(candidate.width - rect.width) <= RECT_TOLERANCE &&
      Math.abs(candidate.height - rect.height) <= RECT_TOLERANCE
  );
}

function collectParentRects(
  target: Element,
  limit: ParentLevels
): DOMRect[] {
  const accepted: DOMRect[] = [];
  let ancestor = target.parentElement;
  while (ancestor && accepted.length < limit) {
    if (ancestor.matches(SOURCE_SELECTOR)) {
      const rect = ancestor.getBoundingClientRect();
      if (hasVisibleRect(rect) && !hasMatchingRect(rect, accepted)) {
        accepted.push(rect);
      }
    }
    ancestor = ancestor.parentElement;
  }
  return accepted;
}

function positionBox(box: HTMLElement, rect: DOMRect): void {
  box.style.display = "block";
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}
```

Do not pass the current target rect into `hasMatchingRect`.

- [ ] **Step 7: Reuse and clear the pool on every show**

Keep `let currentParentLevels = parentLevels`. At the start of `show(target)`:

```ts
const parentRects = collectParentRects(target, currentParentLevels);
parentBoxes.forEach((parentBox, index) => {
  const parentRect = parentRects[index];
  if (parentRect) {
    positionBox(parentBox, parentRect);
  } else {
    parentBox.style.display = "none";
  }
});
```

Add:

```ts
setParentLevels(nextParentLevels) {
  currentParentLevels = nextParentLevels;
  parentBoxes.forEach((parentBox, index) => {
    if (index >= nextParentLevels) {
      parentBox.style.display = "none";
    }
  });
}
```

The method only updates overlay state and hides surplus boxes. The runtime owns redraw when a target is active.

- [ ] **Step 8: Pass initial parent levels from the runtime**

In `src/client/index.ts`:

```ts
const overlay = createOverlay(
  options.showAllBoundaries,
  initialSettings.colorPreset,
  initialSettings.parentLevels
);
```

After a successful save:

```ts
overlay.setColorPreset(settings.colorPreset);
overlay.setParentLevels(settings.parentLevels);
```

- [ ] **Step 9: Run focused E2E and full existing E2E**

Run:

```bash
npm run build
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts --grep "Alt hover|three parent|parent level preference|overlay color presets"
npm run test:e2e
```

Expected: all tests PASS, including pseudo-element, real overlay, `pointer-events:none`, React island, repeated-list, MCP, drag, and reduced-motion cases.

---

### Task 4: Accepted-setting redraw and failure behavior

**Files:**
- Modify: `src/client/index.ts:236-261`
- Test: `tests/e2e/locator.spec.ts` near the parent-level tests

**Interfaces:**
- Consumes: accepted schema-v3 settings from `saveLocatorSettings`.
- Produces: parent-level toast, active-target redraw for color/parent changes, and trigger deactivation only when the trigger itself changes.

- [ ] **Step 1: Add a failing active redraw test**

Open the popover before activation, keep it open while activating a known child,
then click level 0. Locator UI pointer events are already excluded from hit
resolution, so moving from the child to the popover preserves `activeTarget`
until the accepted setting is applied:

```ts
const settings = await mockSettingsEndpoint(page);
await page.goto("/");
await page.locator("[data-astro-ai-locator-launcher]").click();

const parentGroup = page
  .locator("[data-astro-ai-locator-popover]")
  .getByRole("group", { name: "Parent levels" });
const child = page.getByTestId("react-child-label");
await child.hover();
await page.keyboard.down("Alt");
const overlayHost = page.locator("[data-astro-ai-locator-overlay]");
await expect(
  overlayHost.locator('.parent-box[data-parent-level="1"]')
).toBeVisible();

await parentGroup.getByRole("button", { name: "0" }).click();
await expect.poll(settings.current).toEqual({
  schemaVersion: 3,
  triggerKey: "alt",
  colorPreset: "violet",
  parentLevels: 0
});

await expect(page.locator("html")).toHaveAttribute(
  "data-astro-ai-locator-active",
  ""
);
await expect(overlayHost).toHaveCount(1);
await expect(overlayHost.locator(".box")).toBeVisible();
for (const parentBox of await overlayHost.locator(".parent-box").all()) {
  await expect(parentBox).toBeHidden();
}
await page.keyboard.up("Alt");
```

- [ ] **Step 2: Confirm the focused test is RED**

Run:

```bash
npm run build
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts --grep "active parent level"
```

Expected: FAIL because the current callback always calls `setActive(false)` and does not distinguish parent-level changes.

- [ ] **Step 3: Apply accepted settings without unnecessary deactivation**

Replace the unconditional toast/deactivation branch with:

```ts
const triggerChanged =
  settings.triggerKey !== previousSettings.triggerKey;
const colorChanged =
  settings.colorPreset !== previousSettings.colorPreset;
const parentLevelsChanged =
  settings.parentLevels !== previousSettings.parentLevels;

overlay.setColorPreset(settings.colorPreset);
overlay.setParentLevels(settings.parentLevels);

if (colorChanged) {
  overlay.toast(`Overlay color changed to ${settings.colorPreset}`);
} else if (parentLevelsChanged) {
  overlay.toast(`Parent levels changed to ${settings.parentLevels}`);
} else {
  overlay.toast(`Trigger changed to ${settings.triggerKey}`);
}

if (triggerChanged) {
  setActive(false);
} else if (activeTarget) {
  overlay.show(activeTarget);
}
```

Do not mutate `currentSettings`, the panel, or the overlay before `saveLocatorSettings` resolves. The existing catch path therefore leaves both saved and displayed settings unchanged.

- [ ] **Step 4: Add and verify failed-write behavior**

Extend the E2E settings mock with a one-shot failure:

```ts
let rejectNextWrite = false;
await page.route("**/_astro-ai-locator/settings", async (route) => {
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
  current: () => ({ ...settings }),
  rejectNextWrite: () => {
    rejectNextWrite = true;
  }
};
```

With level 1 selected, call `settings.rejectNextWrite()`, click level 3, and
assert:

```ts
await expect(group.getByRole("button", { name: "1" })).toHaveAttribute(
  "aria-pressed",
  "true"
);
await expect(group.getByRole("button", { name: "3" })).toHaveAttribute(
  "aria-pressed",
  "false"
);
```

Activate the locator again and assert only level 1 is visible. This verifies rejected writes do not update the panel or overlay.

- [ ] **Step 5: Run E2E and type checks**

Run:

```bash
npm run check
npm run test:e2e
```

Expected: PASS with the same overlay host reused and no listener reinstall.

---

### Task 5: Documentation and complete regression

**Files:**
- Modify: `README.md:90-124`
- Modify: `docs/FUTURE_WORK.md:61-79`
- Modify: `docs/FUTURE_WORK.md:194-209`

**Interfaces:**
- Documents: global persistence, default level 1, exact 0–3 meanings, and useful metadata-parent semantics.

- [ ] **Step 1: Update README user guidance**

Change the overlay walkthrough to explain that the current target uses the strongest outline and up to three metadata-bearing ancestors can be shown. Add under preferences:

```markdown
- Choose `0`, `1`, `2`, or `3` under `Parent Levels`. The default is `1`.
  `0` hides parent outlines; higher values walk outward through visually
  distinct ancestors carrying both source-file and source-location metadata.
```

Change “Trigger and color choices” to “Trigger, color, and parent-level choices”.

- [ ] **Step 2: Mark the future-work item complete**

Preserve the design notes for historical context, but mark the Parent Levels section and recommended implementation step 5 as completed. Do not mark compact hashes, copy modes, label clamp, toast animation, or disable mode complete.

- [ ] **Step 3: Run the full release gate**

Run:

```bash
npm run verify
```

Expected sequence:

1. TypeScript check passes.
2. All unit tests pass.
3. MCP stdio integration passes.
4. All Playwright E2E tests pass, including locator, React island, pseudo-element, real overlay, `pointer-events:none`, repeated list, settings, drag, and reduced-motion coverage.
5. Production-output integration passes.
6. Final TypeScript build passes.

- [ ] **Step 4: Final review checkpoint**

Inspect the final diff limited to:

```text
src/shared/contracts.ts
src/settings/store.ts
src/client/settings-api.ts
src/client/settings-panel.ts
src/client/overlay.ts
src/client/index.ts
tests/unit/settings-store.test.ts
tests/unit/settings-handler.test.ts
tests/e2e/locator.spec.ts
README.md
docs/FUTURE_WORK.md
```

Confirm there are exactly three pooled parent boxes, no application-DOM mutations, no hit-resolver edits, and no manifest/MCP/hash changes.
