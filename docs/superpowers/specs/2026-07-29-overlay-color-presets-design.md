# Overlay Color Presets Design

> 2026-07-29 · approved direction: global preset setting with violet default

## Goal

Turn the four existing `Overlay Color` preview chips into accessible controls
that persist one global color preset and apply it consistently to the locator
overlay and selected trigger keycap.

## Scope

The selected preset changes:

- current target border and 10% fill;
- nearest annotated parent outline;
- current target label background;
- selected trigger keycap background and border;
- selected color chip ring.

The selected preset does not change:

- gray page-map boundaries;
- trigger-row hover background, which remains neutral gray;
- popover background, text, dividers, or other monochrome surfaces;
- FAB background or white fox mark;
- hit resolution, hashes, manifest, MCP, clicks, or clipboard behavior.

## Presets

The public setting values are:

- `neutral`
- `violet` — default
- `orange`
- `sky`

Each preset owns a small semantic palette rather than applying one hex value
to every surface. This preserves white-text contrast while keeping each
surface visibly in the selected color family.

| Preset | Swatch | Overlay accent | Solid keycap/ring | Label |
|---|---:|---:|---:|---:|
| Neutral | `#111111` | `#52525b` | `#3f3f46` | `#27272a` |
| Violet | `#7c3aed` | `#8b5cf6` | `#7c3aed` | `#6d28d9` |
| Orange | `#f97316` | `#fb923c` | `#ea580c` | `#c2410c` |
| Sky | `#0ea5e9` | `#38bdf8` | `#0284c7` | `#0369a1` |

The overlay accent uses the existing alpha hierarchy:

- current target border: `85%`;
- nearest annotated parent outline: `40%`;
- current target fill: `10%`.

All label and selected-keycap text remains white.

## Settings Schema

Global settings move from schema version 1 to version 2:

```ts
interface LocatorSettings {
  schemaVersion: 2;
  triggerKey: "control" | "alt" | "meta";
  colorPreset: "neutral" | "violet" | "orange" | "sky";
}
```

The file remains:

```text
~/.astro-ai-locator/settings.json
```

Migration behavior:

- valid schema v2 is returned unchanged;
- valid schema v1 preserves `triggerKey` and receives `colorPreset: "violet"`;
- missing or malformed files use the v2 defaults;
- all new writes use schema v2.

Running dev servers are not synchronized. A change updates the current page
immediately and is loaded by subsequently started or refreshed locator
clients through the existing settings endpoint.

## Client Architecture

`src/client/color-presets.ts` owns the visual token table and applies a preset
as CSS custom properties to a Shadow DOM host.

`src/client/overlay.ts` consumes the CSS variables for the current box, parent
box, fill, and label. `LocatorOverlay` gains `setColorPreset()` so a successful
setting update recolors an already mounted overlay without reinstalling event
listeners.

`src/client/settings-panel.ts` receives the full settings object. The color
chips become native buttons inside an accessible group:

- each button has a readable color name;
- `aria-pressed` identifies the selected preset;
- the selected chip receives the theme-colored outer ring;
- all settings controls are disabled while one settings write is pending;
- a failed write keeps the previous selection and colors.

The trigger rows retain their existing neutral gray hover state.

`src/client/index.ts` owns the last accepted settings object. Trigger and color
changes each create a full next settings value, persist it, then update the
panel and overlay only after the server accepts it.

## Server and Storage

The existing authenticated settings endpoint remains unchanged:

```text
GET|PUT /_astro-ai-locator/settings
```

Only its validated payload advances to schema v2. The request-size cap,
session-token requirement, atomic write, permissions, and no-store response
headers remain unchanged.

## Error Handling

- Invalid preset values return HTTP 400 and are never persisted.
- A failed client update shows the existing toast error path.
- The panel restores enabled controls after success or failure.
- The last accepted trigger and preset remain active on failure.
- Failure to load settings falls back to `alt` and `violet`.

## Testing

Unit tests cover:

- schema v1 to v2 migration;
- v2 default and valid read/write;
- rejection of unknown presets;
- settings endpoint v2 GET/PUT behavior;
- client preset parsing and fallback.

E2E tests cover:

- four accessible color buttons;
- violet selected by default;
- choosing orange persists a full schema v2 payload;
- selected chip ring and trigger keycap use orange tokens;
- current target, parent, fill, and label use orange tokens;
- trigger-row hover remains neutral gray;
- a reload uses the persisted orange setting;
- locator, React island, overlay, `pointer-events:none`, MCP, drag, and reduced
  motion regressions remain green.

Production output must still contain no locator metadata or client UI.
