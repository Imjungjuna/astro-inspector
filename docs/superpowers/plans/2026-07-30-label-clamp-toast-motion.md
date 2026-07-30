# Viewport-safe Label and Pop Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep hover labels inside the viewport and replace the small
bottom-right toast with a larger, restartable bottom-center pop toast.

**Architecture:** Keep `createOverlay()` as the only presentation owner.
Separate the fixed label from the current target box, calculate its viewport
coordinates after content measurement, and style the existing standalone toast
with a CSS lifecycle animation. Exercise both behaviors through the real Astro
fixture in Playwright before changing production code.

**Tech Stack:** TypeScript, Shadow DOM, CSS keyframes, Astro fixture,
Playwright, Vitest.

## Global Constraints

- Preserve hit resolution, hover selection, parent boxes, hashes, clipboard
  payloads, registration, manifest, MCP, settings, FAB, and settings popover.
- Label viewport safety gap is exactly 8px.
- Label maximum width, one-line ellipsis, content order, and typography remain
  unchanged.
- Toast is bottom-center with a 20px safe-area-aware bottom gap.
- Toast uses 14px text, 12px 16px padding, a 44px minimum height, 10px radius,
  and a maximum width of `min(420px, calc(100vw - 32px))`.
- Toast lifecycle is approximately 1.8 seconds; entry settles within about
  220ms.
- Repeated calls restart the toast animation and timeout.
- Reduced motion removes scale, translation, and overshoot.
- Preserve the user's dirty `main`; do not stage, commit, push, or create a PR.

---

### Task 1: Viewport-safe Hover Label

**Files:**
- Modify: `tests/e2e/locator.spec.ts`
- Modify: `src/client/overlay.ts`

**Interfaces:**
- Consumes: `LocatorOverlay.show(target: Element): void`.
- Produces: one fixed `.label[data-placement]` positioned from the selected
  element `DOMRect`.

- [ ] **Step 1: Add failing edge-placement browser tests**

Add one Playwright test that repositions a real annotated fixture element:

```ts
test("hover label flips and clamps inside the viewport", async ({ page }) => {
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
  });
  await target.hover();
  await page.keyboard.down("Alt");

  await expect(label).toHaveAttribute("data-placement", "below");
  const topLeft = await label.boundingBox();
  expect(topLeft?.x).toBeGreaterThanOrEqual(8);
  expect(topLeft?.y).toBeGreaterThanOrEqual(8);

  await page.keyboard.up("Alt");
  await target.evaluate((element) => {
    const style = (element as HTMLElement).style;
    style.left = "auto";
    style.top = "auto";
    style.right = "0";
    style.bottom = "0";
    element.setAttribute(
      "data-astro-ai-locator-source-tag",
      `VeryLongSourceComponent${"X".repeat(200)}`
    );
  });
  await target.hover();
  await page.keyboard.down("Alt");

  await expect(label).toHaveAttribute("data-placement", "above");
  const bottomRight = await label.boundingBox();
  const viewport = page.viewportSize();
  expect(bottomRight?.x).toBeGreaterThanOrEqual(8);
  expect((bottomRight?.x ?? 0) + (bottomRight?.width ?? 0))
    .toBeLessThanOrEqual((viewport?.width ?? 0) - 8);
  await page.keyboard.up("Alt");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts \
  --grep "hover label flips and clamps"
```

Expected: FAIL because the label is still absolutely positioned inside the
target box, has no `data-placement`, and crosses viewport edges.

- [ ] **Step 3: Separate and position the label**

In `src/client/overlay.ts`:

- move `.label` next to `.box` in the shadow markup;
- change it to `position: fixed` and `display: none`;
- add `const LABEL_VIEWPORT_GAP = 8`;
- after setting label text, set `display: block`, measure it, and calculate:

```ts
const spaceAbove = rect.top - LABEL_VIEWPORT_GAP;
const spaceBelow =
  window.innerHeight - LABEL_VIEWPORT_GAP - rect.bottom;
const placement =
  spaceAbove >= labelRect.height
    ? "above"
    : spaceBelow >= labelRect.height
      ? "below"
      : spaceAbove >= spaceBelow
        ? "above"
        : "below";
const desiredTop =
  placement === "above"
    ? rect.top - labelRect.height
    : rect.bottom;
const maxTop = Math.max(
  LABEL_VIEWPORT_GAP,
  window.innerHeight - LABEL_VIEWPORT_GAP - labelRect.height
);
const maxLeft = Math.max(
  LABEL_VIEWPORT_GAP,
  window.innerWidth - LABEL_VIEWPORT_GAP - labelRect.width
);
label.style.left = `${Math.min(
  Math.max(rect.left, LABEL_VIEWPORT_GAP),
  maxLeft
)}px`;
label.style.top = `${Math.min(
  Math.max(desiredTop, LABEL_VIEWPORT_GAP),
  maxTop
)}px`;
label.dataset.placement = placement;
```

Hide the label with the existing overlay host and do not add new global event
listeners; existing `overlay.show()` calls on hover, scroll, and resize perform
the recalculation.

- [ ] **Step 4: Build and verify GREEN**

Run:

```bash
npm run build
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts \
  --grep "hover label|parent levels"
```

Expected: PASS for edge placement and existing structured-label/parent tests.

---

### Task 2: Larger Restartable Pop Toast

**Files:**
- Modify: `tests/e2e/locator.spec.ts`
- Modify: `src/client/overlay.ts`

**Interfaces:**
- Consumes: `LocatorOverlay.toast(message: string): void`.
- Produces: standalone `[data-astro-ai-locator-toast][data-visible]` with a
  restartable CSS animation.

- [ ] **Step 1: Add failing toast presentation and restart tests**

Add a Playwright test using the real Alt-click copy flow:

```ts
test("copy toast is centered, large, and restarts its pop animation", async ({
  page
}) => {
  await page.goto("/");
  const target = page.getByTestId("card-alpha");
  const toast = page.locator("[data-astro-ai-locator-toast]");

  await target.click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect(toast).toHaveAttribute("data-visible", "");
  await expect(toast).toHaveCSS("font-size", "14px");
  const firstBox = await toast.boundingBox();
  const viewport = page.viewportSize();
  expect(firstBox?.height).toBeGreaterThanOrEqual(44);
  expect((firstBox?.x ?? 0) + (firstBox?.width ?? 0) / 2)
    .toBeCloseTo((viewport?.width ?? 0) / 2, 0);
  const firstStart = await toast.evaluate(
    (element) => element.getAnimations()[0]?.startTime
  );

  await target.click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  const secondStart = await toast.evaluate(
    (element) => element.getAnimations()[0]?.startTime
  );
  expect(Number(secondStart)).toBeGreaterThan(Number(firstStart));
});
```

Extend the existing reduced-motion test to assert that the toast animation
name is `astro-ai-locator-toast-fade`.

- [ ] **Step 2: Run focused toast tests and verify RED**

Run:

```bash
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts \
  --grep "copy toast|settings popover removes motion"
```

Expected: FAIL because the current toast is 12px, bottom-right, 8px by 12px
padded, has no animation, and has no `data-visible` state.

- [ ] **Step 3: Add toast stylesheet and lifecycle**

Create one `style` element owned by `createOverlay()` with:

```css
[data-astro-ai-locator-toast] {
  position: fixed;
  left: 50%;
  bottom: calc(20px + env(safe-area-inset-bottom));
  z-index: 2147483647;
  min-height: 44px;
  max-width: min(420px, calc(100vw - 32px));
  padding: 12px 16px;
  overflow: hidden;
  border-radius: 10px;
  background: rgba(17, 24, 39, 0.94);
  color: white;
  font: 500 14px/20px ui-sans-serif, system-ui, sans-serif;
  opacity: 0;
  pointer-events: none;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  visibility: hidden;
  white-space: nowrap;
}
[data-astro-ai-locator-toast][data-visible] {
  animation: astro-ai-locator-toast-pop 1800ms both;
  visibility: visible;
}
@keyframes astro-ai-locator-toast-pop {
  0% {
    opacity: 0;
    transform: translate(-50%, 12px) scale(0.92);
  }
  7% {
    opacity: 1;
    transform: translate(-50%, 0) scale(1.04);
  }
  12.2%, 82% {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, 4px) scale(0.98);
  }
}
@media (prefers-reduced-motion: reduce) {
  [data-astro-ai-locator-toast][data-visible] {
    animation-name: astro-ai-locator-toast-fade;
  }
  @keyframes astro-ai-locator-toast-fade {
    0%, 100% { opacity: 0; }
    8%, 82% { opacity: 1; }
  }
}
```

Set `role="status"` and `aria-live="polite"`. In `toast(message)`:

```ts
window.clearTimeout(toastTimer);
toast.removeAttribute("data-visible");
toast.getAnimations().forEach((animation) => animation.cancel());
void toast.offsetWidth;
toast.textContent = message;
toast.setAttribute("data-visible", "");
toastTimer = window.setTimeout(() => {
  toast.removeAttribute("data-visible");
}, 1800);
```

Remove the toast stylesheet during `destroy()`.

- [ ] **Step 4: Build and verify focused GREEN**

Run:

```bash
npm run build
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts \
  --grep "copy toast|settings popover removes motion|Alt click registers"
```

Expected: PASS for size, centering, restart, copy feedback, and reduced motion.

---

### Task 3: Documentation and Full Regression

**Files:**
- Modify: `README.md`
- Modify: `docs/FUTURE_WORK.md`

**Interfaces:**
- Documents the viewport-safe label and bottom-center pop toast behavior.

- [ ] **Step 1: Update user-facing documentation**

In `README.md`, document label flip/clamp behavior and bottom-center copy
feedback. In `docs/FUTURE_WORK.md`, mark items 5 and 6 complete and preserve
the remaining rename, compact token, and disable work.

- [ ] **Step 2: Run complete verification**

Run:

```bash
npm run verify
```

Expected: TypeScript check, 92+ unit tests, MCP integration, 31+ browser E2E
tests, production output, and build all pass.

- [ ] **Step 3: Review final scope**

Run:

```bash
git diff --check
git status --short
git diff -- src/client/overlay.ts tests/e2e/locator.spec.ts README.md docs/FUTURE_WORK.md
```

Confirm no hit resolver, manifest, MCP, registration, settings, FAB, or
settings-popover changes were introduced and no generated test artifacts are
tracked.
