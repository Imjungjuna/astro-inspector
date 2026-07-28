# Floating Locator Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the trigger-only settings card with an always-visible,
bottom-left black fox FAB and an accessible, draggable settings popover.

**Architecture:** Keep the UI in its existing isolated Shadow DOM host.
`settings-panel.ts` owns launcher, popover, open state, viewport placement, and
browser position persistence. `index.ts` only supplies trigger-setting
callbacks and excludes the host from locator hit handling.

**Tech Stack:** TypeScript, browser DOM and Pointer Events, Shadow DOM CSS,
Vitest, Playwright.

## Global Constraints

- The FAB is always visible in development mode and defaults to 16px from the
  bottom-left viewport edge.
- The FAB is `#111111`, circular, 52px, and contains the supplied fox
  silhouette as a white inline SVG.
- The popover opens only by FAB click and starts closed after page load.
- Drag starts after 5px movement and must not also toggle the popover.
- Trigger labels are platform-neutral; no operating-system detection is added.
- `Overlay Color` shows four non-interactive preview chips only.
- Opening and closing uses a 160ms opacity/translate/scale transition and
  honors `prefers-reduced-motion`.
- Existing trigger storage, locator selection, manifest, and MCP behavior must
  remain unchanged.
- This package directory is not an independent Git repository; no commit is
  created from the parent home-directory repository.

---

### Task 1: Launcher and Popover Contract

**Files:**
- Create: `src/client/fox-mark.ts`
- Modify: `src/client/settings-panel.ts`
- Modify: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Produces: `FOX_MARK_PATH: string`, copied from the first silhouette path in
  `/Users/jungjun/.codex/attachments/827210f4-74da-4b0a-bcac-214fc7fa4b94/pasted-text.txt`
- Produces: always-mounted `[data-astro-ai-locator-launcher]`
- Produces: `[data-astro-ai-locator-popover]` with trigger and preferences
  sections
- Retains: `LocatorSettingsPanel.setTriggerKey()` and `.destroy()`

- [ ] **Step 1: Replace the old panel E2E expectations with failing FAB tests**

Add browser assertions equivalent to:

```ts
await page.goto("/");
const launcher = page.getByRole("button", {
  name: "Open Astro AI Locator settings"
});
await expect(launcher).toBeVisible();
await expect(launcher).toHaveAttribute("aria-expanded", "false");
await expect(page.locator("[data-fox-mark] path")).toHaveAttribute(
  "fill",
  "white"
);
await expect(page.locator("[data-astro-ai-locator-popover]")).toBeHidden();
await launcher.click();
await expect(page.locator("[data-astro-ai-locator-popover]")).toBeVisible();
await expect(page.locator("[data-ui-color-chip]")).toHaveCount(4);
```

The test must also assert that the launcher is approximately 16px from the
left and bottom edges in the default 1280×720 Playwright viewport.

- [ ] **Step 2: Run the focused browser test and verify RED**

Run:

```bash
npm run build
npx playwright test tests/e2e/locator.spec.ts --grep "floating launcher"
```

Expected: FAIL because the launcher, inline fox mark, and preferences section
do not exist.

- [ ] **Step 3: Add the fox asset constant**

Create `fox-mark.ts` with the exact first `<path d="...">` silhouette data from
the supplied SVG. Export only the path data, not the source SVG's white
full-canvas background path.

- [ ] **Step 4: Build the always-visible Shadow DOM structure**

Replace the old header and close button with:

```html
<section
  class="popover"
  data-astro-ai-locator-popover
  role="dialog"
  aria-label="Astro AI Locator settings"
  aria-hidden="true"
>
  <div class="trigger-section">
    <p class="current">Trigger: <strong></strong></p>
    <div class="choices">...</div>
    <p class="hint">Drag to move. Release the trigger key to interact normally.</p>
  </div>
  <div class="divider"></div>
  <div class="preferences-section">
    <p class="section-label">Preferences</p>
    <div class="preference-row">
      <span>Overlay Color</span>
      <span class="chips" aria-hidden="true">...</span>
    </div>
  </div>
</section>
<button
  class="launcher"
  data-astro-ai-locator-launcher
  type="button"
  aria-expanded="false"
  aria-controls="astro-ai-locator-popover"
  aria-label="Open Astro AI Locator settings"
>
  <svg data-fox-mark aria-hidden="true" viewBox="0 0 512 512">...</svg>
</button>
```

The host uses `left:16px; bottom:16px`; the launcher and popover use
`pointer-events:auto` while the host itself does not block the page.

- [ ] **Step 5: Implement the approved typography and contrast**

Use the exact sizes from the spec: 52px launcher, 320px card, 14px trigger
header, 11px helper and section label, 13px preference row, 16px section
padding, and 8px control gaps. Use a purple active button and neutral inactive
buttons without changing element dimensions between states.

- [ ] **Step 6: Run the focused test and verify GREEN**

Build and rerun the focused test. Expect launcher, logo, popover hierarchy, and
color chips assertions to pass.

### Task 2: Toggle, Dismissal, Motion, and Dragging

**Files:**
- Modify: `src/client/settings-panel.ts`
- Modify: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Produces: click toggle with synchronized `aria-expanded`, `aria-hidden`, and
  launcher accessible name
- Produces: outside-pointer and Escape dismissal
- Produces: 5px drag threshold and persisted `{ x, y }` launcher coordinates
- Produces: viewport-clamped popover placement above or below the launcher

- [ ] **Step 1: Write failing interaction tests**

Add tests that:

```ts
await launcher.click();
await expect(popover).toBeVisible();
await page.keyboard.press("Escape");
await expect(popover).toBeHidden();
await expect(launcher).toBeFocused();

await launcher.click();
await page.getByTestId("card-alpha").click();
await expect(popover).toBeHidden();
```

Add a drag test that moves the launcher more than 5px, asserts the popover did
not open, reloads, and checks that the launcher returns to the saved position.
Also drag toward each viewport edge and assert its bounding box remains at
least 12px inside the viewport.

- [ ] **Step 2: Run the focused interaction tests and verify RED**

Run:

```bash
npx playwright test tests/e2e/locator.spec.ts --grep "floating launcher|launcher drag"
```

Expected: FAIL because click/drag disambiguation and the new dismissal
semantics are absent.

- [ ] **Step 3: Implement open-state control**

Keep the popover mounted for animation. Toggle a `data-open` attribute and
synchronize:

```ts
launcher.setAttribute("aria-expanded", String(open));
launcher.setAttribute(
  "aria-label",
  open
    ? "Close Astro AI Locator settings"
    : "Open Astro AI Locator settings"
);
popover.setAttribute("aria-hidden", String(!open));
```

Use a document capture listener for outside pointer-down and a window keydown
listener for Escape. Do not prevent application events; only close the
popover. Escape returns focus to the launcher.

- [ ] **Step 4: Implement motion**

The closed CSS state is opacity 0, 6px launcher-facing translation, scale
0.98, visibility hidden, and pointer-events none. The open state is opacity 1,
zero translation, scale 1, visible, and interactive. Use 160ms easing and set
transition duration and transforms to none under
`@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 5: Implement thresholded launcher dragging**

Track pointer-down coordinates and use `Math.hypot(dx, dy) >= 5`. Once the
threshold is crossed:

- capture the pointer;
- position the host with viewport `left` and `top`;
- clamp the 52px launcher inside a 12px viewport gap;
- save the final coordinates to the existing position storage key;
- suppress the click generated by that drag.

Keyboard-generated launcher clicks continue to toggle normally.

- [ ] **Step 6: Implement popover placement**

Measure the mounted card. Prefer a 12px gap above the launcher; switch below
when there is insufficient space. Clamp horizontal card position and expose
the launcher-facing arrow position through CSS custom properties.

- [ ] **Step 7: Verify GREEN**

Run the focused interaction tests and a TypeScript check:

```bash
npx playwright test tests/e2e/locator.spec.ts --grep "floating launcher|launcher drag"
npm run check
```

### Task 3: Client Contract Cleanup and Regression

**Files:**
- Modify: `src/client/index.ts`
- Modify: `src/client/settings-panel.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/integration/index.ts`
- Modify: `tests/unit/integration.test.ts`
- Modify: `tests/e2e/locator.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Removes: `LocatorClientOptions.serverInstanceId`
- Removes: trigger-activation-driven `settingsPanel.show()` / `.hide()`
- Retains: `settingsPanel.setTriggerKey()` / `.destroy()`

- [ ] **Step 1: Write failing contract and regression expectations**

Update the integration test so the injected client options no longer contain
`serverInstanceId`. Add an E2E assertion that pressing and releasing the
trigger key does not change popover visibility. Add a test with reduced motion
emulation that verifies the popover transition duration is `0s`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx vitest run tests/unit/integration.test.ts
npx playwright test tests/e2e/locator.spec.ts --grep "floating launcher"
```

Expected: FAIL while the old client option and trigger-driven panel methods
remain.

- [ ] **Step 3: Remove obsolete visibility coordination**

Remove server-instance generation and injection. Simplify
`LocatorSettingsPanel` to:

```ts
export interface LocatorSettingsPanel {
  setTriggerKey(triggerKey: TriggerKey): void;
  destroy(): void;
}
```

`setActive()` continues to control only source boundaries and the target
overlay. Successful trigger changes deactivate the old modifier state but
leave the popover open.

- [ ] **Step 4: Update documentation**

Document the always-visible bottom-left launcher, black-and-white fox,
click-toggle behavior, draggable launcher, platform-neutral labels, and
non-interactive preferences preview. Remove the old close-until-server-restart
instructions.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run verify
npm pack --dry-run
```

Expected: TypeScript, 62+ unit tests, MCP integration, all existing and new
browser tests, production output, final build, and package contents pass
without including fixture output or source SVG attachments.

- [ ] **Step 6: Inspect generated and modified files**

Confirm no `.tmp` or `.tgz` files were created in the package and that package
contents remain limited by the existing `files` allowlist.
