# Locator Overlay Visual Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-level purple locator treatment with a quiet gray
page map, one metadata-aware parent outline, one emphasized current outline,
and a structured current-element label.

**Architecture:** Keep hit resolution, trigger handling, selection, hashing,
manifest generation, and MCP untouched. `overlay.ts` continues to own all
visual rendering: global CSS draws every annotated boundary, while its
existing Shadow DOM host draws a parent box and current box. `show(target)`
derives only the nearest annotated ancestor for the additional parent layer
and populates pre-rendered label spans.

**Tech Stack:** TypeScript, DOM/Shadow DOM CSS, Playwright E2E, Astro fixture.

## Global Constraints

- All annotated elements use a gray `1px dashed` outline at `18%` opacity.
- The nearest ancestor carrying both source-file and source-location metadata
  uses a purple `2px solid` outline at `40%` opacity with a `2px` outward
  offset so an overlapping current border cannot cover it.
- The parent layer has no fill and no label, and is hidden when no annotated
  ancestor exists.
- The current element uses a purple `2px solid` border at `85%` opacity and a
  purple fill at exactly `10%` opacity.
- Only the current element has a label.
- Label positioning, sizing, overflow, flip/clamp behavior, and background
  `#6d28d9` remain unchanged.
- Label order is tag, extension-bearing filename, then line:column.
- Label spans use tag `700/1`, filename `500/.9`, location `400/.75`, and
  separators `400/.48` with `4px` inline margins.
- Do not modify hit resolution, target selection, clicks, pseudo-element or
  `pointer-events:none` handling, hashes, manifest, MCP, popover, or FAB.
- The package is untracked inside the parent home repository; do not stage,
  commit, branch, or merge.

---

### Task 1: Lock the visual hierarchy and structured label contract

**Files:**
- Modify: `tests/e2e/locator.spec.ts:32-290`
- Test: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Consumes: `[data-astro-ai-locator-overlay]`, annotated fixture DOM, and the
  existing Alt-trigger behavior
- Produces: regression contract for `.box`, `.parent-box`, `.label-tag`,
  `.label-file`, `.label-location`, and `.label-separator`

- [ ] **Step 1: Expand the first hover test**

Hover an annotated React child after wrapping it in one unannotated runtime
element. This proves the highlighted parent is metadata-aware rather than the
literal `parentElement`. While Alt is held, assert:

```ts
await expect(page.getByTestId("card-beta")).toHaveCSS(
  "outline",
  "rgba(107, 114, 128, 0.18) dashed 1px"
);
await expect(currentBox).toHaveCSS(
  "border",
  "2px solid rgba(139, 92, 246, 0.85)"
);
await expect(currentBox).toHaveCSS(
  "background-color",
  "rgba(139, 92, 246, 0.1)"
);
await expect(parentBox).toHaveCSS(
  "outline",
  "rgba(139, 92, 246, 0.4) solid 2px"
);
await expect(parentBox).toHaveCSS("outline-offset", "2px");
await expect(parentBox.locator(".label")).toHaveCount(0);
```

Compare the parent box geometry with the annotated button ancestor, not the
unannotated wrapper.

- [ ] **Step 2: Lock the label order and span styles**

Assert the current label reads:

```text
<span>│ReactIsland.tsx│5:9
```

Use a location regex but literal filename including `.tsx`. Assert the four
span classes and their computed styles:

```ts
await expect(label.locator(".label-tag")).toHaveCSS("font-weight", "700");
await expect(label.locator(".label-tag")).toHaveCSS("opacity", "1");
await expect(label.locator(".label-file")).toHaveCSS("font-weight", "500");
await expect(label.locator(".label-file")).toHaveCSS("opacity", "0.9");
await expect(label.locator(".label-location")).toHaveCSS("font-weight", "400");
await expect(label.locator(".label-location")).toHaveCSS("opacity", "0.75");
await expect(label.locator(".label-separator").first()).toHaveCSS(
  "opacity",
  "0.48"
);
await expect(label.locator(".label-separator").first()).toHaveCSS(
  "margin-left",
  "4px"
);
```

- [ ] **Step 3: Update existing label-order assertions**

Change existing forwarded-component, pseudo-element, real-overlay, and
pointer-transparent assertions from:

```text
<tag>│line:column│File.ext
```

to:

```text
<tag>│File.ext│line:column
```

Do not change their click, clipboard, manifest, or MCP assertions.

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```bash
npm run build
npx playwright test tests/e2e/locator.spec.ts --grep \
  "Alt hover|component call-site|React island|pseudo-element|stack-aware|pointer-events none"
```

Expected: FAIL because all boundaries are still purple, the current fill is
`8%`, no parent box exists, and the label is one text node in location-first
order.

---

### Task 2: Implement the three-level overlay without touching targeting

**Files:**
- Modify: `src/client/overlay.ts`
- Test: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Retains: `createOverlay(showAllBoundaries): LocatorOverlay`
- Retains: `LocatorOverlay.show(target)`, `.hide()`, `.toast()`, `.destroy()`
- Produces: visual-only `.parent-box` and structured label spans

- [ ] **Step 1: Replace the global annotated-boundary color**

Use:

```css
outline: 1px dashed rgba(107, 114, 128, 0.18) !important;
outline-offset: -1px !important;
```

Keep the cursor and pseudo-element hit-testing rules unchanged.

- [ ] **Step 2: Add parent and current box styles**

Render the parent layer before the current layer:

```html
<div class="parent-box"></div>
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

Use:

```css
.parent-box {
  position: fixed;
  display: none;
  box-sizing: border-box;
  border: 0;
  outline: 2px solid rgba(139, 92, 246, 0.4);
  outline-offset: 2px;
  background: transparent;
  pointer-events: none;
}
.box {
  border: 2px solid rgba(139, 92, 246, 0.85);
  background: rgba(139, 92, 246, 0.1);
}
.label-separator {
  margin-inline: 4px;
  opacity: 0.48;
}
```

Keep every existing `.label` positioning, width, padding, overflow, radius,
font family, ellipsis, and white-space declaration unchanged.

- [ ] **Step 3: Resolve only the annotated visual parent**

Inside `show(target)`, derive:

```ts
const parentTarget = target.parentElement?.closest(SOURCE_SELECTOR) ?? null;
```

`SOURCE_SELECTOR` must require both metadata attributes. If `parentTarget`
exists, copy its bounding rectangle into `.parent-box` and display it;
otherwise hide and clear the parent box. Do not return this ancestor to the
client and do not use it for target resolution or clicks.

- [ ] **Step 4: Populate label spans in the new order**

Retain the existing source/dom tag calculation and basename extraction, then
set:

```ts
tag.textContent = `<${tagLabel}>`;
file.textContent = fileName;
location.textContent = sourceLocation;
```

Do not replace the label with `textContent` or `innerHTML`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 1 command again. All visual assertions and the existing
selection/clipboard assertions must pass.

---

### Task 3: Preserve the complete locator pipeline

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-28-locator-overlay-visual-hierarchy.md`
- Test: all unit, integration, E2E, and production tests

**Interfaces:**
- Documents: gray page map, metadata-aware parent, current target, and label
  hierarchy
- Verifies: locator targeting, React islands, overlays,
  `pointer-events:none`, clipboard hashes, manifest/MCP, and production output

- [ ] **Step 1: Document the active overlay hierarchy**

Add concise README wording describing:

1. faint gray annotated boundaries;
2. low-opacity purple solid nearest annotated ancestor;
3. purple solid current target;
4. current-only tag/file/location label.

- [ ] **Step 2: Run fresh full verification**

Run:

```bash
npm run verify
```

Expected: TypeScript check, 62 unit tests, MCP integration, all Playwright
tests, production output, and final build pass.

- [ ] **Step 3: Inspect a real browser rendering**

Open the fixture in system Chrome, activate the locator over the nested React
label, and confirm the gray page map, dashed purple parent, solid purple
current target, and one structured purple label remain visually ordered.

## Self-review

- Spec coverage: every required outline, opacity, parent rule, label order,
  span style, and forbidden subsystem is assigned to Tasks 1–3.
- Placeholder scan: no TODO, TBD, or unspecified implementation step remains.
- Type consistency: the existing public `LocatorOverlay` interface is retained;
  all new selectors are private Shadow DOM implementation details consumed
  only by E2E tests.
