# Copy As Location Design

> 2026-07-30 · approved revision of Copy As: one workspace-relative Location
> with Path or Module name presentation

## Goal

Simplify Context copying so users do not choose between project-relative and
machine-specific absolute paths. A Location can instead be represented as:

- a stable path from the detected monorepo workspace root; or
- the source filename, labeled `Module name` in the UI.

At the same time, make the two Copy As mode rows match the full-width Trigger
rows, make Context disclosure operate from the whole Context row, and reduce
the visual weight of character-based icons.

## Settings Schema v5

Replace the schema-v4 Module/path model with:

```ts
type CopyMode = "hash" | "context";
type ContextField = "tag" | "location" | "line";
type LocationFormat = "path" | "moduleName";

interface LocatorSettings {
  schemaVersion: 5;
  triggerKey: "control" | "alt" | "meta";
  colorPreset: "neutral" | "violet" | "orange" | "sky";
  parentLevels: 0 | 1 | 2 | 3;
  copyMode: CopyMode;
  contextFields: ContextField[];
  locationFormat: LocationFormat;
}
```

Defaults:

```ts
{
  schemaVersion: 5,
  triggerKey: "alt",
  colorPreset: "violet",
  parentLevels: 1,
  copyMode: "hash",
  contextFields: ["location", "line"],
  locationFormat: "path"
}
```

Validation rules:

- Context fields are allowlisted and unique.
- Line requires Location.
- Context mode requires at least one Context field.
- Empty fields remain valid only in Hash mode.
- `locationFormat` is retained while Location is off so the last presentation
  returns when Location is re-enabled.

### Migration

- Schemas v1-v3 preserve their understood Trigger, color, and parent values and
  receive the schema-v5 Copy As defaults.
- Schema v4 maps `tag` to `tag`, `module` to `location`, and retains `line`
  only when the old Module field was present.
- Both old `relative` and `absolute` module paths migrate to `locationFormat:
  "path"`. The new Path is workspace-relative and intentionally replaces both
  old meanings.
- A v4 Hash configuration with no Context fields stays empty in v5.
- Every subsequent write serializes schema v5.

## Workspace Location

Use Vite's official workspace-root detection from the Astro project root. It
recognizes a `workspaces` field in `package.json`, `pnpm-workspace.yaml`, and
`lerna.json`, and falls back to the project/package root when no workspace
marker exists.

After the existing source validation succeeds:

1. canonicalize the detected workspace root;
2. verify the canonical source remains inside that root;
3. calculate a POSIX-separated path relative to the workspace root;
4. prefix it with `/`.

Example:

```text
/apps/astro/src/pages/[lang]/hospital/list/_components/FilterSidebar.astro
```

For a standalone Astro project, the fallback produces a path such as:

```text
/src/components/Card.astro
```

The click-time registration response becomes:

```ts
interface RegisterElementResponse {
  hash: string;
  entry: LocatorManifestEntry;
  workspaceFile: string;
}
```

The previous `absoluteFile` registration field is removed. `workspaceFile`
exists only in the authenticated development response. It is not stored in DOM
metadata, the manifest, MCP responses, settings, or client boot options.

The manifest and MCP contracts do not change.

## Clipboard Formatting

Hash mode stays byte-for-byte compatible.

Context output order remains:

```text
Tag → Location
```

Location presentation:

```text
Path        /apps/astro/src/.../FilterSidebar.astro
Module name FilterSidebar.astro
```

`Module name` is the final filename segment and keeps its extension.

When Line is selected, append it to the chosen Location presentation:

```text
/apps/astro/src/.../FilterSidebar.astro:298:13
FilterSidebar.astro:298:13
```

Tag and Location remain separated by ` | `:

```text
<FilterSidebar→aside> | /apps/astro/src/.../FilterSidebar.astro:298:13
```

Tag-only, Location-only, Location-with-Line, Tag-with-Location, and
Tag-with-Location-and-Line are the valid outputs. Line without Location is
rejected by settings validation and cannot be selected in the UI.

## Popover Structure

The Copy As section becomes:

```text
[#] Hash
[@] Context                                      ›

    ✓ Tag
    ✓ Location
          ✓ Path
            Module name
    ✓ Line
```

- Hash and Context each use one full-width 28px row matching Trigger rows.
- The Context cue is inside the Context row rather than a separate button.
- The cue is visual only and has `pointer-events: none`; it receives no
  separate hover surface or color change.
- The entire Context row is the click and keyboard target.
- The selected mode still uses theme fill only on the character keycap.
- Context child rows keep a fixed check column and existing indentation.
- Path and Module name are a nested radio group. Exactly one is selected while
  Location is on; Path is the default.

## Context Disclosure State

Disclosure remains local page state and starts closed on every page load.

State transitions:

- Clicking Context while Hash is active and Context fields exist selects
  Context and opens the options.
- Clicking Context with no configured fields opens the options but leaves Hash
  active until a field is selected.
- Clicking an open, active Context row collapses the options without changing
  the saved copy mode.
- Clicking a closed, active Context row expands the options.
- Clicking Hash selects Hash but does not open or close Context.
- Selecting any Context child while Hash is active switches to Context.

The cue uses one thin right-pointing glyph and rotates downward while expanded,
so it reads as `›` when closed and `⌄`/`v` when open.

## Location and Line State

- Selecting Location reveals the Path and Module name radio rows.
- Selecting either nested presentation retains Location and selects Context.
- Selecting Location enables Line but does not automatically select it.
- Unselecting Location atomically removes Location and Line and collapses the
  presentation rows.
- Re-selecting Location restores the last Path/Module name preference but does
  not restore Line.
- Removing the last Context field switches to Hash without collapsing the
  Context panel.

## Motion and Visual Weight

- Keep the existing restrained dark, translucent, monospaced-keycap visual
  language.
- Context and nested Location panels animate `grid-template-rows` and opacity
  with a smooth approximately 180ms ease-out transition.
- The cue rotation uses the same timing.
- `prefers-reduced-motion: reduce` makes all three changes immediate.
- Character keycaps (`⌃`, `⌥`, `⌘`, `#`, `@`) use font weight 400 instead of
  600.
- Parent Levels (`0`, `1`, `2`, `3`) also use font weight 400.
- Existing row text weights, neutral row hover, selected theme fills, popover
  width, dividers, FAB, overlay, and toast remain unchanged.

## Accessibility

- Hash and Context remain one named radio group.
- The Context row also owns `aria-expanded` and `aria-controls`.
- The visual cue is hidden from assistive technology.
- Context fields keep checkbox semantics.
- Path and Module name form a named radio group.
- Location owns `aria-controls` for its nested radio group.
- Line is disabled while Location is off.
- Collapsed options are `aria-hidden`, inert, and removed from tab order.

## Testing

### Unit

- v1-v4 settings migrate to schema v5.
- v4 relative and absolute both migrate to Path.
- Location/Line dependency and Location Format validation.
- workspace-root path generation uses leading `/` and POSIX separators.
- standalone fallback path.
- registration returns `workspaceFile` and never persists it in the manifest.
- formatter covers Path and Module name with and without Line.
- Hash and stable Tag → Location ordering remain unchanged.

### Browser

- Copy As main rows have the same usable width as Trigger rows.
- The cue lies inside Context and has no separate hover surface.
- Context selection opens the panel automatically.
- Re-clicking open Context collapses it.
- Hash changes mode without changing disclosure state.
- cue rotation, panel height, and opacity animate together.
- Path and Module name are mutually exclusive.
- Location removal clears/disables Line; re-enabling restores only the
  presentation.
- character keycaps and Parent Levels use the reduced font weight.
- reduced motion removes panel and cue transitions.
- exact Path and Module name clipboard outputs.
- all existing locator, React island, overlay, pointer-events, hash, MCP,
  settings failure, and production regressions remain green.

## Non-Goals

- No user-supplied workspace root override in this iteration.
- No absolute path copy.
- No project-root-relative path option.
- No simultaneous Path and Module name output.
- No filename-without-extension option.
- No reordering or custom separators.
- No manifest or MCP schema changes.
