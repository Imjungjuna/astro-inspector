# Copy As Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace absolute/project-relative copy choices with one
workspace-relative Location that can render as Path or Module name, while
making Context a full-width animated disclosure row.

**Architecture:** Upgrade global settings to schema v5, calculate a validated
`workspaceFile` during the existing registration request, and keep output
selection inside the pure clipboard formatter. Rework only the Copy As markup
and state transitions; hit resolution, manifests, MCP, overlay, and click
registration remain unchanged.

**Tech Stack:** TypeScript, Astro integration, Vite JavaScript API, Shadow DOM,
Vitest, Playwright.

## Global Constraints

- Preserve all existing uncommitted color, parent-level, and Copy As work.
- Do not change hit resolution, hover selection, hashes, manifest schema, MCP
  schema, pseudo-element handling, `pointer-events:none` support, overlay
  placement, FAB, or toast design.
- Path output is workspace-root-relative, POSIX-separated, and starts with `/`.
- Module name is the final filename segment with its extension.
- Path and Module name are mutually exclusive; Path is the default.
- Line requires Location and appends to the selected Location representation.
- Context disclosure state is page-local and starts closed.
- The Context cue is visual only and has no separate hover behavior.
- Character keycaps and Parent Levels use font weight 400.
- Do not commit, stage, push, or create a PR from the user's dirty `main`
  workspace unless separately requested.

---

### Task 1: Settings Schema v5 and Migration

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/settings/store.ts`
- Modify: `src/client/settings-api.ts`
- Modify: `tests/unit/settings-store.test.ts`
- Modify: `tests/unit/settings-handler.test.ts`
- Modify: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Produces:
  `ContextField = "tag" | "location" | "line"`,
  `LocationFormat = "path" | "moduleName"`, and schema-v5
  `LocatorSettings`.
- Consumes: existing trigger, color, and parent-level allowlists.

- [ ] **Step 1: Change unit expectations to schema v5 and add v4 migration tests**

Add literal migration cases to `tests/unit/settings-store.test.ts`:

```ts
expect(parseLocatorSettings({
  schemaVersion: 4,
  triggerKey: "meta",
  colorPreset: "sky",
  parentLevels: 2,
  copyMode: "context",
  contextFields: ["tag", "module", "line"],
  modulePath: "absolute"
})).toEqual({
  schemaVersion: 5,
  triggerKey: "meta",
  colorPreset: "sky",
  parentLevels: 2,
  copyMode: "context",
  contextFields: ["tag", "location", "line"],
  locationFormat: "path"
});
```

Cover old relative and absolute values, empty Hash fields, Line without
Location, duplicate fields, unknown Location Format, and v1-v3 defaults.
Update settings-handler request/response fixtures and the E2E settings mock to
the complete schema-v5 shape.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- tests/unit/settings-store.test.ts tests/unit/settings-handler.test.ts
```

Expected: FAIL because contracts and parsers still require schema v4,
`module`, and `modulePath`.

- [ ] **Step 3: Implement the schema-v5 contract**

In `src/shared/contracts.ts`, replace:

```ts
export const CONTEXT_FIELDS = ["tag", "module", "line"] as const;
export const MODULE_PATHS = ["relative", "absolute"] as const;
```

with:

```ts
export const CONTEXT_FIELDS = ["tag", "location", "line"] as const;
export const LOCATION_FORMATS = ["path", "moduleName"] as const;
```

Change `LocatorSettings` to schema version 5 and replace `modulePath` with
`locationFormat`.

- [ ] **Step 4: Implement store migration and validation**

In `src/settings/store.ts`:

- default to `["location", "line"]` and `"path"`;
- migrate schemas v1-v3 directly to v5 defaults;
- parse schema v4 before v5 validation;
- map old Module to Location;
- keep old Line only when Module existed;
- map both old path values to `"path"`;
- reject Line without Location and Context without fields;
- clone `contextFields` on every read/default return.

- [ ] **Step 5: Mirror strict v5 validation in the browser settings API**

Update `src/client/settings-api.ts` to accept only schema v5 from the endpoint
and enforce the same allowlist, uniqueness, Line dependency, and nonempty
Context invariant.

- [ ] **Step 6: Run focused tests and type checking**

Run:

```bash
npm test -- tests/unit/settings-store.test.ts tests/unit/settings-handler.test.ts
npm run check
```

Expected: PASS.

---

### Task 2: Validated Workspace File Registration Response

**Files:**
- Modify: `package.json`
- Modify: `src/integration/vite-plugin.ts`
- Modify: `src/integration/request-handler.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `tests/unit/request-handler.test.ts`

**Interfaces:**
- Consumes: Vite `searchForWorkspaceRoot(current: string): string`.
- Produces:
  `RegisterElementResponse.workspaceFile: string`.
- Removes from the browser registration contract:
  `RegisterElementResponse.absoluteFile`.

- [ ] **Step 1: Add failing workspace response tests**

Update the successful registration fixture to use:

```ts
const workspaceRoot = await mkdtemp(
  path.join(os.tmpdir(), "astro-locator-workspace-")
);
const root = path.join(workspaceRoot, "apps", "astro");
```

Pass `workspaceRoot` to `createRegistrationHandler` and assert:

```ts
expect(responseBody.workspaceFile).toBe("/apps/astro/src/Card.astro");
expect(responseBody).not.toHaveProperty("absoluteFile");
expect(JSON.stringify(manifest)).not.toContain("workspaceFile");
```

Add a standalone case where `workspaceRoot === root` and expect
`/src/Card.astro`. Retain traversal, symlink, source-tag, and position cases.

- [ ] **Step 2: Run registration tests and verify RED**

Run:

```bash
npm test -- tests/unit/request-handler.test.ts
```

Expected: FAIL because the handler lacks `workspaceRoot` and still returns
`absoluteFile`.

- [ ] **Step 3: Use Vite workspace detection once per plugin**

In `src/integration/vite-plugin.ts`, import the runtime API:

```ts
import { searchForWorkspaceRoot, type Plugin } from "vite";
```

Resolve the configured root, call `searchForWorkspaceRoot(configuredRoot)`,
and pass the result as `workspaceRoot` to `createRegistrationHandler`.

Add Vite as an explicit peer compatible with this Astro-7 package:

```json
"peerDependencies": {
  "astro": ">=7.1.3 <8.0.0",
  "vite": ">=8.0.0 <9.0.0"
}
```

- [ ] **Step 4: Return the canonical workspace-relative path**

Extend `RegistrationHandlerOptions` with `workspaceRoot`. In the handler:

```ts
const canonicalWorkspaceRoot = await realpath(options.workspaceRoot);
if (!isInside(canonicalWorkspaceRoot, canonicalFile)) {
  throw new Error("Source is outside the detected workspace root");
}
const workspaceFile =
  `/${toProjectRelativeFile(canonicalWorkspaceRoot, canonicalFile)}`;
```

Return `{ hash, entry, workspaceFile }`. Keep `canonicalFile` internal after
validation and do not write `workspaceFile` to the manifest.

- [ ] **Step 5: Run focused registration and build checks**

Run:

```bash
npm test -- tests/unit/request-handler.test.ts
npm run check
npm run build
```

Expected: PASS.

---

### Task 3: Path and Module Name Clipboard Formatting

**Files:**
- Modify: `src/client/clipboard-payload.ts`
- Modify: `src/client/index.ts`
- Modify: `tests/unit/clipboard-payload.test.ts`
- Modify: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Consumes: schema-v5 `LocatorSettings` and
  `RegisterElementResponse.workspaceFile`.
- Produces:
  `formatClipboardPayload(registration, settings): string`.

- [ ] **Step 1: Replace formatter unit cases and verify RED**

Use a registration fixture with:

```ts
workspaceFile:
  "/apps/astro/src/components/HospitalListCard.tsx"
```

Add exact cases:

```text
Path
/apps/astro/src/components/HospitalListCard.tsx

Path + Line
/apps/astro/src/components/HospitalListCard.tsx:298:13

Module name
HospitalListCard.tsx

Module name + Line
HospitalListCard.tsx:298:13

Tag + Module name + Line
<Link→a> | HospitalListCard.tsx:298:13
```

Keep Hash, equal/differing tags, stable output order, and impossible empty
Context tests.

Run:

```bash
npm test -- tests/unit/clipboard-payload.test.ts
```

Expected: FAIL because the formatter still reads Module and absolute/project
paths.

- [ ] **Step 2: Implement Location presentation**

In `src/client/clipboard-payload.ts`, select:

```ts
const location =
  settings.locationFormat === "moduleName"
    ? registration.workspaceFile.split("/").at(-1)
    : registration.workspaceFile;
```

Reject an empty filename defensively. Append `:line:column` when Line is
selected, and join Tag and Location with ` | ` in fixed order.

- [ ] **Step 3: Update client registration validation**

In `src/client/index.ts`, require a nonempty leading-slash `workspaceFile`
instead of `absoluteFile`. Keep registration before formatting, preserve
`data-comp-hash`, and leave Hash and Context toast/prompt behavior unchanged.

- [ ] **Step 4: Add failing then passing browser clipboard cases**

Update E2E registration-backed outputs to assert:

```text
/src/components/Card.astro
Card.astro
/src/components/Card.astro:8:7
Card.astro:8:7
```

The fixture is standalone, so `/src/...` is the expected workspace path.
Retain prompt fallback and registration-failure copy blocking.

Run before and after implementation:

```bash
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts \
  --grep "Copy As copies|prompt fallback|does not copy|Alt click registers"
```

Expected before implementation: FAIL for new Location outputs.
Expected after implementation: PASS.

---

### Task 4: Full-Width Context Disclosure and Location UI

**Files:**
- Modify: `src/client/settings-panel.ts`
- Modify: `tests/e2e/locator.spec.ts`

**Interfaces:**
- Consumes: schema-v5 `contextFields` and `locationFormat`.
- Produces: full-width Hash/Context mode rows, Context disclosure state, and
  nested Location Format controls.

- [ ] **Step 1: Add failing interaction and style tests**

Assert:

- Context and Hash button widths match a Trigger button;
- Context contains `[data-context-cue]`;
- no separate `[data-context-disclosure]` button exists;
- cue has `pointer-events: none` and no background;
- character keycaps and level buttons have font weight 400;
- clicking inactive Context selects it and opens options;
- clicking active open Context collapses it;
- clicking active closed Context opens it;
- clicking Hash changes mode without changing `aria-expanded`;
- Context owns `aria-expanded` and `aria-controls`;
- Location reveals Path/Module name radios;
- Location removal clears/disables Line;
- Module name persists across Location off/on while Line stays off;
- panel and cue transitions are approximately 180ms;
- reduced motion removes both transitions.

Run:

```bash
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts \
  --grep "Copy As|settings popover removes motion"
```

Expected: FAIL against the old separate disclosure and Module path UI.

- [ ] **Step 2: Rebuild Copy As mode markup**

Make each mode a single `.choice.copy-mode-choice` button. Context uses:

```html
<button
  class="choice copy-mode-choice context-mode-choice"
  role="radio"
  data-copy-mode="context"
  aria-expanded="false"
  aria-controls="astro-ai-locator-context-options"
>
  <span class="keycap" aria-hidden="true">@</span>
  <span>Context</span>
  <span class="context-cue" data-context-cue aria-hidden="true">›</span>
</button>
```

Use a three-column Context grid and `pointer-events: none` on the cue. Remove
the separate disclosure button and its hover/focus CSS.

- [ ] **Step 3: Replace Module path children with Location Format**

Render first-level `Tag`, `Location`, and `Line` checkbox rows. Under Location,
render one nested radiogroup with `Path` and `Module name`. Keep fixed check
columns and existing indentation.

- [ ] **Step 4: Implement disclosure state transitions**

For the Context row:

```ts
if (currentSettings.copyMode !== "context") {
  contextExpanded = true;
  if (currentSettings.contextFields.length > 0) {
    requestSettingsChange({ ...currentSettings, copyMode: "context" });
  } else {
    updateDisclosure();
  }
  return;
}
contextExpanded = !contextExpanded;
updateDisclosure();
```

Hash mode changes only `copyMode`. `updateDisclosure()` writes
`aria-expanded`, toggles the panel, rotates the cue, updates inert/tabindex,
and does not write settings.

- [ ] **Step 5: Implement Location and Line transitions**

- Location off removes Location and Line.
- Location on adds only Location, keeps `locationFormat`, and selects Context.
- Path/Module name clicks retain Location and select Context.
- Line is disabled without Location.
- Canonical field order is Tag → Location → Line.
- Empty fields switch to Hash while leaving disclosure open.

- [ ] **Step 6: Refine motion and font weights**

Use 180ms for Context/Location grid and opacity transitions and the cue
rotation. Set `.keycap` and `.level-button` to font weight 400. Under reduced
motion, set all these transitions to `none`.

- [ ] **Step 7: Run focused UI tests**

Build because the fixture imports `dist`, then run:

```bash
npm run build
./node_modules/.bin/playwright test tests/e2e/locator.spec.ts \
  --grep "Copy As|settings popover removes motion"
```

Expected: PASS.

---

### Task 5: Documentation and Complete Regression

**Files:**
- Modify: `README.md`
- Modify: `docs/FUTURE_WORK.md`
- Review: `docs/superpowers/specs/2026-07-30-copy-as-location-design.md`

**Interfaces:**
- Documents the final user-visible settings and clipboard contract.

- [ ] **Step 1: Update README and Future Work**

Replace relative/absolute terminology with:

- workspace Path;
- Module name;
- Line appended to the chosen Location;
- schema-v5 migration;
- Context whole-row disclosure behavior.

Do not alter unrelated future items.

- [ ] **Step 2: Run static and unit verification**

```bash
npm run check
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run full project verification**

```bash
npm run verify
```

Expected: PASS for unit, MCP integration, 29+ locator E2E cases, production
output, and build.

- [ ] **Step 4: Review the final diff**

```bash
git diff --check
git status --short
git diff -- src tests package.json README.md docs/FUTURE_WORK.md
```

Confirm no `workspaceFile` is persisted, no manifest/MCP/hit-resolver changes
were introduced, no generated test artifacts are tracked, and existing user
changes remain intact.
