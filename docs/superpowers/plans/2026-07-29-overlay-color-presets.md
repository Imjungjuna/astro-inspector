# Overlay Color Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four existing color chips persist a global preset and
recolor the locator overlay, label, selected trigger keycap, and selected chip
ring.

**Architecture:** Advance the global settings payload to schema v2 with a
v1-to-v2 read migration. Keep preset names in the shared contract and visual
tokens in a browser-only module. The runtime owns the last accepted full
settings object and updates mounted Shadow DOM hosts only after the authenticated
settings endpoint accepts a write.

**Tech Stack:** TypeScript, Astro integration/Vite middleware, native Shadow
DOM/CSS custom properties, Vitest, Playwright.

## Global Constraints

- Presets are exactly `neutral`, `violet`, `orange`, and `sky`.
- `violet` is the default and the migration value for schema v1.
- Trigger-row hover, page-map boundaries, popover surfaces, and FAB remain
  neutral.
- Current border, parent outline, fill, label, selected keycap, and selected
  chip ring use the chosen preset.
- Existing hit resolution, click handling, hashes, manifest, MCP, and production
  stripping do not change.
- A failed write must leave the last accepted UI and runtime theme active.
- The package directory is untracked inside the parent home repository; do not
  stage or commit files from this plan.

---

## File Structure

- Create `src/client/color-presets.ts` — browser-only preset token table and
  CSS-variable application.
- Modify `src/shared/contracts.ts` — preset names/type and schema v2 settings.
- Modify `src/settings/store.ts` — v1 migration, v2 validation/default/write.
- Modify `src/client/settings-api.ts` — v2 parse, fallback, and full-settings
  PUT.
- Modify `src/client/overlay.ts` — consume theme variables and support mounted
  theme updates.
- Modify `src/client/settings-panel.ts` — accessible color buttons, selection,
  shared pending state, and theme variables.
- Modify `src/client/index.ts` — own/persist the full accepted settings object.
- Modify `tests/unit/settings-store.test.ts` and
  `tests/unit/settings-handler.test.ts` — storage and endpoint contracts.
- Modify `tests/e2e/locator.spec.ts` — real browser selection/persistence and
  visual token behavior.
- Modify `README.md` and `docs/FUTURE_WORK.md` — document completed behavior.

### Task 1: Version and Migrate Global Settings

**Files:**

- Modify: `src/shared/contracts.ts`
- Modify: `src/settings/store.ts`
- Test: `tests/unit/settings-store.test.ts`
- Test: `tests/unit/settings-handler.test.ts`

**Interfaces:**

- Produces: `COLOR_PRESETS`, `ColorPreset`, and schema-v2 `LocatorSettings`.
- Produces: `parseLocatorSettings(value): LocatorSettings`, accepting valid
  persisted v1 or v2 and normalizing to v2.

- [x] **Step 1: Write failing store tests**

Change default/read/write expectations to:

```ts
{
  schemaVersion: 2,
  triggerKey: "alt",
  colorPreset: "violet"
}
```

Add a migration test that writes:

```ts
{ schemaVersion: 1, triggerKey: "control" }
```

and expects:

```ts
{ schemaVersion: 2, triggerKey: "control", colorPreset: "violet" }
```

Add a rejection test for:

```ts
{ schemaVersion: 2, triggerKey: "alt", colorPreset: "pink" }
```

- [x] **Step 2: Write failing settings-handler tests**

Require the GET default and successful PUT body/file to use schema v2. Add an
HTTP 400 assertion for an unknown color preset.

- [x] **Step 3: Run RED**

Run:

```bash
npx vitest run tests/unit/settings-store.test.ts tests/unit/settings-handler.test.ts
```

Expected: failures showing schema version 1 output and missing color validation.

- [x] **Step 4: Implement shared types and migration**

Add:

```ts
export const COLOR_PRESETS = ["neutral", "violet", "orange", "sky"] as const;
export type ColorPreset = (typeof COLOR_PRESETS)[number];

export interface LocatorSettings {
  schemaVersion: 2;
  triggerKey: TriggerKey;
  colorPreset: ColorPreset;
}
```

Set defaults to `alt/violet`. Validate trigger and preset with allowlists.
Normalize a valid schema-v1 object to schema v2 without writing the file during
`read()`. All calls to `write()` serialize only the normalized schema-v2
object.

- [x] **Step 5: Run GREEN**

Run the same focused Vitest command. Expected: all settings store/handler tests
pass.

### Task 2: Add Browser Preset Tokens and Accessible Controls

**Files:**

- Create: `src/client/color-presets.ts`
- Modify: `src/client/settings-api.ts`
- Modify: `src/client/overlay.ts`
- Modify: `src/client/settings-panel.ts`
- Modify: `src/client/index.ts`
- Test: `tests/e2e/locator.spec.ts`

**Interfaces:**

- Produces:

```ts
interface LocatorColorTheme {
  swatch: string;
  overlayRgb: string;
  solid: string;
  label: string;
}

function applyColorPreset(element: HTMLElement, preset: ColorPreset): void;
```

- Changes:

```ts
createOverlay(showAllBoundaries: boolean, colorPreset: ColorPreset)
LocatorOverlay.setColorPreset(colorPreset: ColorPreset): void
saveLocatorSettings(
  options: LocatorClientOptions,
  settings: LocatorSettings
): Promise<LocatorSettings>
```

- [x] **Step 1: Extend the E2E settings fake**

Store and return the full schema-v2 object:

```ts
let settings = {
  schemaVersion: 2 as const,
  triggerKey: initialTriggerKey,
  colorPreset: initialColorPreset
};
```

On PUT, replace the full object and expose `current()` for assertions.

- [x] **Step 2: Write the failing UI and theme test**

In the floating-launcher test, assert:

```ts
await expect(popover.getByRole("button", { name: "Neutral" })).toBeVisible();
await expect(popover.getByRole("button", { name: "Violet" }))
  .toHaveAttribute("aria-pressed", "true");
await expect(popover.getByRole("button", { name: "Orange" }))
  .toHaveAttribute("aria-pressed", "false");
await expect(popover.getByRole("button", { name: "Sky" })).toBeVisible();
```

Click Orange and assert the persisted payload is:

```ts
{
  schemaVersion: 2,
  triggerKey: "alt",
  colorPreset: "orange"
}
```

Assert the selected keycap is `rgb(234, 88, 12)`, the Orange chip is selected,
and trigger-row hover stays `rgba(255, 255, 255, 0.14)`.

Hover an annotated child with Alt and assert:

```text
current border rgba(251, 146, 60, 0.85)
current fill   rgba(251, 146, 60, 0.1)
parent outline rgba(251, 146, 60, 0.4)
label background rgb(194, 65, 12)
```

Reload, reopen the popover, and assert Orange is still selected.

- [x] **Step 3: Run browser RED**

Run:

```bash
npm run build
npx playwright test tests/e2e/locator.spec.ts --grep "floating launcher"
```

Expected: failure because chips are non-interactive spans and settings still
use schema v1.

- [x] **Step 4: Implement the visual token module**

Use these exact themes:

```ts
neutral: {
  swatch: "#111111",
  overlayRgb: "82, 82, 91",
  solid: "#3f3f46",
  label: "#27272a"
}
violet: {
  swatch: "#7c3aed",
  overlayRgb: "139, 92, 246",
  solid: "#7c3aed",
  label: "#6d28d9"
}
orange: {
  swatch: "#f97316",
  overlayRgb: "251, 146, 60",
  solid: "#ea580c",
  label: "#c2410c"
}
sky: {
  swatch: "#0ea5e9",
  overlayRgb: "56, 189, 248",
  solid: "#0284c7",
  label: "#0369a1"
}
```

`applyColorPreset()` sets `--locator-overlay-rgb`, `--locator-solid`,
and `--locator-label` on the supplied host.

- [x] **Step 5: Implement client settings parsing and runtime ownership**

Parse schema v2 with both allowlists and use `alt/violet` on load failure.
Change PUT to accept the full `LocatorSettings`. Pass the loaded settings into
`installReadyLocator()`, retain the last accepted object, and update the panel
and overlay only after the PUT succeeds.

- [x] **Step 6: Implement overlay theming**

Replace hardcoded purple values with:

```css
outline: 2px solid rgba(var(--locator-overlay-rgb), 0.4);
border: 2px solid rgba(var(--locator-overlay-rgb), 0.85);
background: rgba(var(--locator-overlay-rgb), 0.1);
```

Use `var(--locator-label)` for the label. Apply the initial preset to the host
and implement `setColorPreset()` with the same helper.

- [x] **Step 7: Implement accessible color buttons**

Replace the preview spans with four native buttons in a named group. Each
button gets `data-color-preset`, an accessible name, a fixed swatch custom
property, and `aria-pressed`.

The selected chip ring uses:

```css
box-shadow:
  0 0 0 2px rgba(63, 63, 70, 0.8),
  0 0 0 4px var(--locator-solid);
```

The selected trigger keycap uses `var(--locator-solid)`. Keep the current
neutral gray row-hover declaration unchanged. Disable both trigger and color
buttons while the shared settings write is pending.

- [x] **Step 8: Run browser GREEN**

Run the build and focused Playwright command from Step 3. Expected: pass.

### Task 3: Documentation and Full Regression

**Files:**

- Modify: `README.md`
- Modify: `docs/FUTURE_WORK.md`

**Interfaces:**

- Documents the user-visible controls and schema-v2 global setting.

- [x] **Step 1: Update documentation**

Replace the “future theming preview” statement with the four clickable
presets, violet default, global persistence, and exact affected surfaces.
Change “settings endpoint reads and writes exactly three allowed modifiers” to
describe validated trigger and preset allowlists. Mark the color preset backlog
item complete without deleting the remaining future-work decisions.

- [x] **Step 2: Run complete verification**

Run:

```bash
npm run verify
```

Expected:

- TypeScript check/build pass;
- all unit and MCP integration tests pass;
- all Playwright tests pass;
- production output test confirms no locator UI or metadata.

- [x] **Step 3: Perform mutation check**

Confirm the test suite would fail if:

- the default changes away from violet;
- v1 migration drops the existing trigger key;
- Orange updates only the panel but not the overlay;
- row hover becomes preset-colored;
- an unknown preset reaches disk.
