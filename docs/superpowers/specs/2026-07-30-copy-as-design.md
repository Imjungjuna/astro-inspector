# Copy As Design

> 2026-07-30 · approved direction: mutually exclusive Hash and Context copy
> modes with an independently expandable, macOS-style context options panel

## Goal

Allow users to keep the current hash-only MCP workflow or copy a compact,
direct source reference assembled from selected tag, module, and line metadata.
The setting is shared globally across repositories and worktrees.

## Global Settings

Advance locator settings to schema version 4:

```ts
type CopyMode = "hash" | "context";
type ContextField = "tag" | "module" | "line";
type ModulePath = "relative" | "absolute";

interface LocatorSettings {
  schemaVersion: 4;
  triggerKey: "control" | "alt" | "meta";
  colorPreset: "neutral" | "violet" | "orange" | "sky";
  parentLevels: 0 | 1 | 2 | 3;
  copyMode: CopyMode;
  contextFields: ContextField[];
  modulePath: ModulePath;
}
```

Default values:

```ts
{
  schemaVersion: 4,
  triggerKey: "alt",
  colorPreset: "violet",
  parentLevels: 1,
  copyMode: "hash",
  contextFields: ["module", "line"],
  modulePath: "relative"
}
```

Schema v1, v2, and v3 files preserve every field they already understand and
add the Copy As defaults. Every new write serializes schema v4.

Validation rules:

- `contextFields` contains only allowlisted, unique values.
- `line` is valid only when `module` is also present.
- Context mode requires at least one context field.
- An empty context field list is valid only in Hash mode.
- `modulePath` is always retained, including while Module is unchecked, so the
  user's last path preference returns when Module is selected again.
- Malformed files fall back to all schema-v4 defaults.

The existing settings file path, authentication, and atomic write behavior do
not change.

## Popover Placement and Structure

Place the new section between Trigger and Preferences:

```text
Trigger
────────────
Copy As
────────────
Preferences
```

Keep the existing 260px popover width, dark translucent surface, horizontal
dividers, section heading style, row typography, and theme variables.

### Mode rows

Render two mutually exclusive mode rows:

```text
[#] Hash
[@] Context                                      ›
```

- `#` and `@` use the same 22px square character-icon shape as the current
  trigger keycaps.
- The selected mode's icon uses the active theme fill and white character.
- The inactive mode uses the existing neutral keycap surface.
- The rows expose radio semantics to assistive technology even though their
  visual treatment is a filled character icon.
- Clicking Hash selects Hash mode without changing Context disclosure state.
- Clicking Context selects Context mode only when at least one context field is
  configured.
- If no context fields remain, clicking Context opens the panel if necessary
  but leaves Hash selected until the user chooses a field.

### Independent Context disclosure

The chevron is a separate disclosure control:

- collapsed: `›`;
- expanded: `⌄`;
- default on every page load: collapsed;
- changing Hash/Context mode never implicitly opens or closes it;
- `aria-expanded` and `aria-controls` expose its state.

Disclosure state is local UI state and is not written to global settings.

## Context Option Panel

The expanded Context panel appears directly below the Context row as a
full-width, slightly lighter dark surface. It follows the supplied macOS menu
reference rather than an indented bordered tree.

All first-level context rows are indented to the right relative to the mode
rows and share a fixed empty check column:

```text
    ✓  Tag
    ✓  Module
           ✓  Relative path
              Absolute path
       Line
```

- A selected row displays a plain checkmark in the left column.
- An unselected row leaves the same column empty, keeping labels aligned.
- Tag, Module, and Line have no letter or square icons.
- The entire enabled row is clickable.
- Clicking any context field while Hash is active automatically selects Context
  mode.

### Module dependencies

Module controls both its path options and Line availability:

- Selecting Module slides the two nested path rows down.
- Exactly one of Relative path or Absolute path is checked.
- The path rows are indented one level further than Tag, Module, and Line.
- Selecting a path option retains Module and selects Context mode.
- Selecting Module enables Line but does not automatically check it.
- Unchecking Module removes Module and Line from `contextFields` atomically.
- Unchecking Module disables Line and slides both path rows up.
- Re-selecting Module restores the last path preference but leaves Line
  unchecked until the user selects it again.

If removing a context field leaves no fields selected, the UI switches to Hash
mode. The Context panel remains open and all first-level check columns are
empty.

## Motion

Use the same timing family as the current popover:

- Context panel: approximately 160ms height and opacity transition.
- Nested path rows: approximately 160ms height and opacity transition.
- Closing reverses the transition so content slides upward before becoming
  non-interactive.
- Collapsed content remains unfocusable and hidden from assistive technology.
- Under `prefers-reduced-motion: reduce`, both transitions complete
  immediately with no translate, scale, or opacity animation.

The implementation may use a zero-to-one CSS grid row transition with an inner
`min-height: 0` container to avoid measuring dynamic content in JavaScript.

## Registration Response

Keep one click pipeline for both copy modes. The client always registers the
selected source element before copying so validation and manifest freshness do
not diverge by mode.

Extend only the development registration response:

```ts
interface RegisterElementResponse {
  hash: string;
  entry: LocatorManifestEntry;
  absoluteFile: string;
}
```

`absoluteFile` is the normalized absolute path for the already validated source
file inside the configured project root.

Do not add the absolute path to:

- DOM metadata;
- the manifest;
- the MCP result;
- settings;
- initial client boot options.

This keeps the absolute path scoped to the authenticated, click-time development
response.

## Clipboard Formatting

Create a focused, pure clipboard formatter rather than adding formatting
branches to the click handler.

Hash mode always returns the hash and ignores every context field:

```text
astro_hash_8f92a...
```

Context mode uses a stable `Tag → Module` order regardless of checkbox click
order.

Tag format:

```text
<Link→a>
<span>
```

- Show `sourceTag→domTag` when they differ.
- Show only one tag when they are equal.

Module format:

```text
src/components/HospitalListCard.tsx
/Users/example/project/src/components/HospitalListCard.tsx
```

- Relative uses `entry.file`.
- Absolute uses `absoluteFile`.
- Preserve the filename extension.

When Line is selected, append line and column directly to Module:

```text
src/components/HospitalListCard.tsx:298:13
```

When Tag and Module are both selected, join the two formatted parts with
` | `:

```text
<Link→a> | src/components/HospitalListCard.tsx:298:13
```

Valid context results are therefore:

- Tag only;
- Module only;
- Module with Line;
- Tag with Module;
- Tag with Module and Line.

Line without Module is rejected by settings validation and cannot be produced
by the UI.

## Click Data Flow

1. Hit resolution and target parsing run exactly as today.
2. The client sends the existing registration request.
3. The server validates the source file and position, updates the manifest, and
   returns hash, manifest entry, and absolute file path.
4. The client retains `data-comp-hash` on the selected DOM element.
5. The formatter returns either the hash or selected Context string.
6. The client writes that exact string to the clipboard.
7. Hash mode keeps the current copied-hash toast. Context mode shows the compact
   `Copied context` toast rather than echoing a long absolute path.
8. If Clipboard API and legacy copy both fail, the manual prompt contains the
   same final formatted string.

A registration failure prevents both Hash and Context copying. A failed
settings write leaves the last accepted mode, fields, path preference, and
visual selection unchanged.

## Accessibility

- Hash and Context form one named radio group.
- The disclosure has a dedicated button with `aria-expanded`.
- Context fields use checkbox semantics and announce checked state.
- Relative and Absolute form one named radio group.
- Line exposes a disabled state while Module is unchecked.
- Checkmarks and theme fill are not the only machine-readable state.
- All rows remain keyboard reachable in visual order.
- Collapsed panels cannot receive keyboard focus.

## Testing

### Unit tests

Settings store and endpoint:

- migrate schemas v1, v2, and v3 to v4 defaults;
- read and persist valid Hash and Context configurations;
- allow an empty context list only in Hash mode;
- reject duplicate or unknown fields;
- reject Context mode with no fields;
- reject Line without Module;
- reject invalid module path values;
- preserve the existing atomic write and failure behavior.

Clipboard formatter:

- Hash mode returns only the hash even when context fields are configured;
- equal and differing source/DOM tags use the agreed tag syntax;
- relative and absolute Module use the correct response field;
- Line appends `:line:column`;
- Tag precedes Module independent of stored checkbox order;
- every valid context combination produces the exact agreed string.

Registration handler:

- returns the normalized absolute source path after existing validation;
- still rejects path traversal, symlink escape, invalid positions, and invalid
  source tags;
- keeps the manifest entry schema unchanged.

### Browser tests

- section order is Trigger, Copy As, Preferences;
- default is filled `#`, unfilled `@`, and collapsed Context;
- disclosure state is independent from selected copy mode;
- child rows use a fixed check column with no option icons;
- selecting a child from Hash activates Context;
- Module slides path rows down and enables Line;
- Module removal slides path rows up and clears/disables Line;
- Relative and Absolute are mutually exclusive and persist globally;
- clearing the last field activates Hash without collapsing Context;
- disclosure state resets closed after reload;
- reduced motion removes both animations;
- Hash clipboard output remains byte-for-byte compatible;
- all valid relative and absolute Context outputs match the formatter contract;
- clipboard fallback receives the same formatted payload;
- failed settings writes preserve the accepted UI and copy behavior.

Run the complete locator, React island, pseudo-element, real overlay,
`pointer-events:none`, repeated-list, MCP, drag, production-output, and build
regressions after the focused tests.

## Non-Goals

- No arbitrary templates, custom separators, or field reordering.
- No clipboard preview row in the popover.
- No folder-only or filename-only path option.
- No absolute path in manifest or MCP responses.
- No changes to hash generation or MCP lookup.
- No persistence of disclosure animation state.
- No toast redesign beyond the compact Context success message.
