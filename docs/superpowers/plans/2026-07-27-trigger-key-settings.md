# Trigger Key Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a machine-global configurable locator modifier and a draggable,
closable settings panel that reappears after the Astro dev server restarts.

**Architecture:** A Node-only settings store owns
`~/.astro-ai-locator/settings.json`, while an authenticated Vite middleware
exposes GET/PUT access to the browser. The browser keeps only panel position and
the dismissed Vite server ID in origin-scoped storage.

**Tech Stack:** TypeScript, Astro Integration API, Vite `configureServer`,
Connect middleware, Vitest, Playwright, browser Shadow DOM.

## Global Constraints

- Supported trigger keys are exactly `control`, `alt`, and `meta`.
- Missing or unreadable global settings fall back to `alt`.
- The browser never receives an absolute home-directory path.
- Settings writes are atomic and authenticated with the existing dev token.
- Closing the panel survives reload/HMR but resets after a dev-server restart.
- Production builds remain unchanged.
- This directory is not an independent Git worktree, so no Git commit command
  is run from the parent home-directory repository.

---

### Task 1: Global settings persistence

**Files:**
- Create: `src/settings/store.ts`
- Modify: `src/shared/contracts.ts`
- Create: `tests/unit/settings-store.test.ts`

**Interfaces:**
- Produces: `TriggerKey`, `LocatorSettings`, `DEFAULT_LOCATOR_SETTINGS`
- Produces: `LocatorSettingsStore.read(): Promise<LocatorSettings>`
- Produces: `LocatorSettingsStore.write(input): Promise<LocatorSettings>`

- [ ] **Step 1: Write failing store tests**

Cover a missing file returning `{ schemaVersion: 1, triggerKey: "alt" }`, a
valid file being parsed, invalid JSON falling back to the default, and a write
creating validated JSON in a temporary home fixture.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/unit/settings-store.test.ts
```

Expected: failure because `src/settings/store.ts` does not exist.

- [ ] **Step 3: Implement the minimal store**

Use `os.homedir()` plus `.astro-ai-locator/settings.json` by default. Validate
the two schema fields without shipping Node validation code to the browser.
Write to a unique sibling temporary file, then rename it over the destination.

- [ ] **Step 4: Verify GREEN**

Run the same Vitest command and expect all settings-store tests to pass.

### Task 2: Authenticated Vite settings endpoint

**Files:**
- Create: `src/integration/settings-handler.ts`
- Modify: `src/integration/vite-plugin.ts`
- Modify: `src/integration/index.ts`
- Modify: `src/shared/contracts.ts`
- Create: `tests/unit/settings-handler.test.ts`
- Modify: `tests/unit/vite-plugin.test.ts`
- Modify: `tests/unit/integration.test.ts`

**Interfaces:**
- Consumes: `LocatorSettingsStore`
- Produces: `GET /_astro-ai-locator/settings`
- Produces: `PUT /_astro-ai-locator/settings`
- Produces: injected `settingsEndpoint` and `serverInstanceId`

- [ ] **Step 1: Write failing middleware tests**

Assert authenticated GET, authenticated valid PUT, invalid-key HTTP 400,
wrong-token HTTP 403, and `cache-control: no-store`.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/unit/settings-handler.test.ts tests/unit/vite-plugin.test.ts tests/unit/integration.test.ts
```

Expected: failure because the settings handler and endpoint wiring are absent.

- [ ] **Step 3: Implement endpoint wiring**

Create one `LocatorSettingsStore` per Vite plugin instance. Register the
settings middleware with `configureServer`. Generate a separate random
`serverInstanceId` in the Astro integration and inject it with the endpoint.

- [ ] **Step 4: Verify GREEN**

Run the same focused tests and expect them all to pass.

### Task 3: Trigger-key behavior

**Files:**
- Create: `src/client/trigger-key.ts`
- Modify: `src/client/index.ts`
- Create: `tests/unit/trigger-key.test.ts`

**Interfaces:**
- Produces: `isTriggerKeyEvent(event, triggerKey): boolean`
- Produces: `isTriggerModifierPressed(event, triggerKey): boolean`

- [ ] **Step 1: Write failing table-driven tests**

Use hand-written expected booleans for Control, Alt, and Meta. Assert that a
second modifier or Shift makes the combination inexact.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/unit/trigger-key.test.ts
```

Expected: failure because the trigger helpers do not exist.

- [ ] **Step 3: Implement and connect the helpers**

Load settings once before installing listeners. Replace every hard-coded Alt
check. Add a `contextmenu` selection listener for Control-click and ignore
events originating inside locator UI.

- [ ] **Step 4: Verify GREEN**

Run the focused unit tests, then `npm run check`.

### Task 4: Draggable and closable settings panel

**Files:**
- Create: `src/client/settings-panel.ts`
- Modify: `src/client/index.ts`
- Modify: `src/client/overlay.ts`
- Modify: `tests/e2e/locator.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Produces: `createSettingsPanel(options)`
- Consumes: loaded trigger key and injected server instance ID
- Emits: async key changes and a close callback

- [ ] **Step 1: Write failing browser tests**

Assert that the panel appears during activation, saves a different modifier,
moves after dragging, keeps its position after reload, stays closed after
reload, and appears when the stored dismissed ID differs from the current
server ID.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run build
npx playwright test tests/e2e/locator.spec.ts
```

Expected: the new panel tests fail because no settings panel exists.

- [ ] **Step 3: Implement the panel**

Create a dedicated Shadow DOM host marked
`data-astro-ai-locator-settings`. Use pointer capture for dragging, clamp
coordinates to the viewport, persist position defensively, and persist the
dismissed `serverInstanceId`.

- [ ] **Step 4: Connect saving**

PUT `{ schemaVersion: 1, triggerKey }` with the session token. Apply the new key
only after a successful response; otherwise retain the old key and show a
toast.

- [ ] **Step 5: Verify GREEN**

Build and rerun the complete locator E2E file.

### Task 5: Documentation and full verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents: global path, UI behavior, supported keys, restart semantics

- [ ] **Step 1: Update usage documentation**

Replace Alt-only instructions with current-key instructions and document
`~/.astro-ai-locator/settings.json`, panel dragging, close behavior, and the
fact that other open pages need a reload.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run verify
```

Expected: TypeScript check, unit tests, MCP integration, E2E, production
fixture verification, and final build all exit successfully.

- [ ] **Step 3: Inspect the final diff**

Confirm there are no generated manifests, temporary settings files, or
unrelated user changes in the package directory.
