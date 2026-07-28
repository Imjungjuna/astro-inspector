# Monochrome List Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the compact fox launcher and render its accessible trigger list
inside a dense translucent-gray popover.

**Architecture:** Keep all UI and interaction ownership in the existing open
Shadow DOM created by `settings-panel.ts`. Change only launcher constants,
popover markup, and CSS; trigger persistence and panel event wiring keep their
existing interfaces.

**Tech Stack:** TypeScript, browser DOM and Pointer Events, Shadow DOM CSS,
Playwright.

## Global Constraints

- Launcher is exactly `46px`; the fox mark is exactly `25px`.
- Launcher default background is `rgba(7, 7, 16, 0.62)`, hover is
  `rgba(75, 85, 99, 0.78)`, and backdrop blur is `14px`.
- Popover width is `min(260px, calc(100vw - 24px))`.
- Popover background is `rgba(63, 63, 70, 0.8)`, backdrop blur is `18px`,
  text is `#f4f4f5`, and its border is translucent white.
- The speech-bubble pointer is removed and the FAB gap is `6px`.
- Trigger choices remain native buttons with `aria-pressed`.
- Section headings are white `12px` semibold text.
- Trigger labels and `Overlay Color` use near-white `#ececef` at regular (`400`)
  weight; modifier symbols remain semibold (`600`).
- Trigger and preference rows are exactly `28px` high with no trigger-row gap.
- The drag helper sentence is removed.
- Selected state uses purple only on the modifier keycap; row, hover, and
  focus states otherwise use neutral zinc/gray colors.
- `Overlay Color` chips remain the only color exception and stay non-interactive.
- Existing toggle, dismissal, drag, placement, trigger persistence, and
  reduced-motion behavior must not change.
- This package directory is untracked inside the parent `/Users/jungjun` Git
  repository, so no branch, staging, or commit action is performed.

---

### Task 1: Lock the monochrome list contract with E2E assertions

**Files:**
- Modify: `tests/e2e/locator.spec.ts:409-557`

**Interfaces:**
- Consumes: existing Shadow DOM selectors
  `[data-astro-ai-locator-launcher]`,
  `[data-astro-ai-locator-popover]`, and `[data-trigger-key]`
- Produces: test contract for `[data-modifier-keycap]`, stacked trigger row
  geometry, and selection conveyed only by keycap color

- [ ] **Step 1: Extend the existing launcher hierarchy test**

After reading the launcher bounding box, assert exact dimensions and neutral
background:

```ts
expect(launcherBox.width).toBe(46);
expect(launcherBox.height).toBe(46);
await expect(launcher).toHaveCSS(
  "background-color",
  "rgba(7, 7, 16, 0.62)"
);
await expect(launcher).toHaveCSS("backdrop-filter", "blur(14px)");

const foxMark = page.locator("[data-fox-mark]");
await expect(foxMark).toHaveCSS("width", "25px");
await expect(foxMark).toHaveCSS("height", "25px");
```

After opening the popover, assert its `260px` desktop width, translucent gray
background, `18px` blur, and zinc-100 text. Assert the drag helper is absent.
Read all three
trigger button boxes; each must be `28px` high, have the same `x`, and the next
row's `y` must equal the previous row's bottom:

```ts
const choices = popover.locator("[data-trigger-key]");
await expect(choices).toHaveCount(3);
const choiceBoxes = await choices.evaluateAll((buttons) =>
  buttons.map((button) => {
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, height: rect.height };
  })
);
expect(choiceBoxes[1]?.x).toBeCloseTo(choiceBoxes[0]?.x ?? 0, 0);
expect(choiceBoxes[0]?.height).toBe(28);
expect(choiceBoxes[1]?.y).toBe(
  (choiceBoxes[0]?.y ?? 0) + (choiceBoxes[0]?.height ?? 0)
);
```

Assert no `[data-selection-indicator]` exists. Assert selected and unselected
rows have the same transparent background. The initial `Option / Alt`
`[data-modifier-keycap]` must use `rgb(124, 58, 237)` background and white
text, while Control uses a neutral background. After changing to Control,
assert those keycap color states swap. Hover Control before changing it and
assert its row background becomes `rgba(255, 255, 255, 0.14)`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build
npx playwright test tests/e2e/locator.spec.ts --grep "floating launcher"
```

Expected: FAIL because the current launcher is `52px/#111111`, the fox is
`30px`, and trigger controls are laid out in three columns without selection
indicators.

---

### Task 2: Implement the smaller FAB and monochrome list

**Files:**
- Modify: `src/client/settings-panel.ts`
- Test: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Retains: `createSettingsPanel(options): LocatorSettingsPanel`
- Retains: `LocatorSettingsPanel.setTriggerKey(triggerKey)` and `.destroy()`
- Produces: decorative `[data-modifier-keycap]` inside every trigger button

- [ ] **Step 1: Update launcher and popover constants**

Set `LAUNCHER_SIZE = 46`, `POPOVER_GAP = 6`, keep the `16px` default edge gap
and `12px` viewport gap, then update CSS to:

```css
.launcher {
  background: rgba(7, 7, 16, 0.62);
  backdrop-filter: blur(14px);
}
.launcher:hover {
  background: rgba(75, 85, 99, 0.78);
}
.fox-mark {
  width: 25px;
  height: 25px;
}
.popover {
  width: min(260px, calc(100vw - 24px));
  border-color: rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  background: rgba(63, 63, 70, 0.8);
  backdrop-filter: blur(18px);
  color: #f4f4f5;
}
```

Use a neutral focus ring and preserve the existing `LAUNCHER_SIZE`-based
clamping and popover placement calculations.

- [ ] **Step 2: Replace segmented markup with stacked semantic rows**

Remove `.current`, `currentLabel`, and `triggerLabel()`. Render:

```html
<p class="section-heading">Trigger</p>
<div class="choices">
  <button class="choice" type="button" data-trigger-key="control">
    <span class="keycap" data-modifier-keycap aria-hidden="true">⌃</span>
    <span>Control</span>
  </button>
  <button class="choice" type="button" data-trigger-key="alt">
    <span class="keycap" data-modifier-keycap aria-hidden="true">⌥</span>
    <span>Option / Alt</span>
  </button>
  <button class="choice" type="button" data-trigger-key="meta">
    <span class="keycap" data-modifier-keycap aria-hidden="true">⌘</span>
    <span>Command / Meta</span>
  </button>
</div>
```

Use a two-column grid (`24px 1fr`), `28px` row height, `0px` vertical gaps,
`4px` horizontal row padding, transparent row borders, a translucent-light
hover background, and an inset neutral focus outline. Keycaps are `22px`
squares with `16px` modifier symbols. Selected rows keep the same transparent
persistent background as unselected rows. Apply purple `#7c3aed` and white
text only to the selected keycap. Remove the helper paragraph from markup and
its `.hint` CSS.

- [ ] **Step 3: Align Preferences to the same list rhythm**

Use the same section heading style, a `28px` neutral row with `4px` horizontal
padding, and keep the four existing preview chips on the right. Do not add
click handlers or button semantics.

- [ ] **Step 4: Update selected-row state without changing persistence**

Keep the existing button iteration and set `aria-pressed` from
`button.dataset.triggerKey === currentTriggerKey`. CSS controls indicator
visibility from `[aria-pressed="true"]`; no new JavaScript state is needed.

- [ ] **Step 5: Build and run focused tests to verify GREEN**

Run:

```bash
npm run build
npx playwright test tests/e2e/locator.spec.ts --grep "floating launcher|launcher toggles|launcher is draggable|reduced motion"
```

Expected: all focused launcher/popover tests pass.

---

### Task 3: Documentation and full regression verification

**Files:**
- Modify: `README.md:38-48`
- Test: all existing unit, integration, browser, and production tests

**Interfaces:**
- Documents: smaller translucent-gray launcher and blurred list popover
- Verifies: npm package contents remain limited to `dist`, `README.md`, and
  package metadata

- [ ] **Step 1: Update user-facing UI wording**

Replace “검은 원형 여우 버튼” with “짙은 회색 원형 여우 버튼” and describe
the trigger selector as a vertical list whose active keycap is purple.

- [ ] **Step 2: Run fresh full verification**

Run:

```bash
npm run verify
npm pack --dry-run --json --cache /private/tmp/astro-ai-locator-npm-cache
```

Expected: TypeScript, 62 unit tests, MCP integration, all browser tests,
production-output verification, build, and package dry-run pass.

- [ ] **Step 3: Inspect the settled browser rendering**

Open the fixture at `1280×720`, toggle the FAB, wait longer than the 160ms
transition, and confirm:

- launcher and fox are visibly smaller;
- launcher reads as gray rather than black;
- trigger rows align to one vertical list;
- active check, keycap, and label align without horizontal shifting;
- shell, selected state, divider, and focus treatments are monochrome;
- four `Overlay Color` chips remain the only saturated colors.
