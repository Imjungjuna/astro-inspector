# Parent Levels Design

> 2026-07-29 · approved direction: global 0–3 parent-level setting with a
> reusable Shadow DOM box pool

## Goal

Allow users to choose how many useful metadata-bearing ancestors appear around
the current locator target without changing hit resolution or mutating the
application DOM.

## User Interface

Add one row below `Overlay Color` in the existing `Preferences` section:

```text
Parent Levels                         0  1  2  3
```

- Keep the existing popover width, theme, section structure, padding, and
  28px row height.
- Render `0`, `1`, `2`, and `3` as compact square native buttons in one
  accessible group named `Parent levels`.
- Use `aria-pressed` to expose the selected count.
- Fill the selected button with the active color preset.
- Keep unselected and hover states neutral grey.
- Disable trigger, color, and parent-level controls together while one settings
  write is pending.

## Visual Hierarchy

The active color preset supplies the hue. Opacity communicates hierarchy:

| Layer | Stroke | Opacity | Fill | Label |
|---|---|---:|---:|---|
| Current target | `2px solid` | `90%` | `10%` | Yes |
| Parent 1, nearest | `2px solid` | `70%` | None | No |
| Parent 2 | `2px solid` | `60%` | None | No |
| Parent 3, farthest | `2px solid` | `45%` | None | No |

All parent outlines keep `outline-offset: 2px`. The gray dashed page map remains
unchanged.

`Parent Levels = 0` hides every parent box but leaves the current target, label,
and page map unchanged.

## Ancestor Semantics

A parent level is not a raw `parentElement`. It is the next ancestor carrying
both source-file and source-location metadata.

Starting at `target.parentElement`, walk upward through the real DOM:

1. Ignore elements missing either metadata attribute.
2. Ignore elements whose rendered rect has zero width or zero height.
3. Ignore a rect whose left, top, width, and height are each within `0.5px` of
   a previously accepted parent rect.
4. Continue upward until the requested number of visually distinct parent
   rects is collected or the document root is reached.

Skipped elements do not consume a level. This means choosing `2` displays two
useful boundaries whenever two distinct valid ancestors exist.

The current target rect is not part of parent deduplication. A parent matching
the target rect is still shown using the existing 2px outward offset, because
it represents a distinct metadata ancestor and remains visible outside the
current border.

## Overlay Architecture

Create exactly three `.parent-box` elements once when `createOverlay()` mounts.
Never create or remove parent boxes during hover.

`show(target)`:

- resolves at most the configured number of useful ancestors;
- writes accepted rects into the first N pooled boxes;
- applies level-specific opacity by stable `data-parent-level` values;
- hides every unused pooled box.

`hide()` hides the overlay host as today. `destroy()` removes the host and all
three pooled boxes with it.

`LocatorOverlay` gains:

```ts
setParentLevels(parentLevels: ParentLevels): void;
```

Changing the value updates mounted state immediately. If a target is currently
active, the runtime calls `show(activeTarget)` again so parent boxes are
recomputed without reinstalling listeners.

## Settings Schema

Advance global settings to schema version 3:

```ts
type ParentLevels = 0 | 1 | 2 | 3;

interface LocatorSettings {
  schemaVersion: 3;
  triggerKey: "control" | "alt" | "meta";
  colorPreset: "neutral" | "violet" | "orange" | "sky";
  parentLevels: ParentLevels;
}
```

Default settings:

```ts
{
  schemaVersion: 3,
  triggerKey: "alt",
  colorPreset: "violet",
  parentLevels: 1
}
```

Migration:

- schema v1 preserves `triggerKey`, adds `violet`, and adds `1`;
- schema v2 preserves `triggerKey` and `colorPreset`, and adds `1`;
- schema v3 validates all fields;
- malformed files fall back to the schema-v3 defaults;
- every new write serializes schema v3.

The existing global path and authenticated endpoint remain unchanged.

## Runtime Data Flow

The existing full-settings update path remains the single source of truth:

1. The parent-level button requests a complete next settings object.
2. The server validates and atomically persists schema v3.
3. The runtime accepts the response and updates the settings panel.
4. The runtime calls `overlay.setParentLevels()`.
5. If the locator is active, it redraws the current target and parent pool.

Failed writes leave the previous count and displayed boxes unchanged and use
the existing toast error path.

## Non-Goals

- Do not change hit resolution, hover-target selection, or pointer scheduling.
- Do not add labels or fills to parent boxes.
- Do not make opacity user-configurable.
- Do not create more than three parent boxes.
- Do not change hash, manifest, MCP, click, clipboard, FAB, or color preset
  behavior.

## Testing

Unit tests cover:

- schema v1 and v2 migration to parent level 1;
- valid schema-v3 read/write for 0 and 3;
- rejection of values outside integer `0–3`;
- settings endpoint schema-v3 GET/PUT behavior.

E2E tests cover:

- one accessible `Parent levels` group with four buttons;
- level 1 selected by default;
- choosing 3 persists schema v3;
- current, parent 1, parent 2, and parent 3 use `90/60/40/20%`;
- parent boxes have no fill or label;
- choosing 0 hides all parent boxes immediately;
- zero-size and duplicate rect ancestors are skipped while traversal continues;
- trigger and color controls retain their behavior;
- locator, React island, pseudo-element, real-overlay,
  `pointer-events:none`, repeated-list, MCP, drag, reduced-motion, and
  production-output regressions remain green.
