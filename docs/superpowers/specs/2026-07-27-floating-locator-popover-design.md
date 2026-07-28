# Floating Locator Popover Redesign

## Goal

Replace the trigger-only settings card with an always-visible floating launcher
and a compact popover. The redesign prioritizes typography, layout hierarchy,
contrast, and discoverability without changing locator selection or global
trigger persistence.

This specification supersedes the **Settings panel** and **Close and restart
semantics** sections of
`2026-07-27-trigger-key-settings-design.md`. All other trigger-setting behavior
remains unchanged.

## Interaction model

The launcher is always visible in Astro development mode. Its default position
is fixed to the bottom-left of the viewport with a 16px safe-area gap.

- A click toggles the settings popover.
- The popover starts closed after a page load.
- `Escape` and an outside click close the popover.
- Trigger-key activation does not automatically open or close the popover.
- The launcher and popover are excluded from locator hit resolution and
  selection capture.

The launcher itself is the drag handle. Pointer movement beyond a 5px threshold
starts dragging; pointer release after a drag must not also toggle the popover.
The launcher and its popover move as one anchored widget. The final launcher
position remains origin-scoped in `localStorage` and is clamped to the viewport.

The popover prefers placement above the launcher. If insufficient vertical
space exists after dragging, it is placed below. Horizontal placement is
clamped so the card remains inside the viewport.

## Launcher

The launcher is a 52px circular black button with a white fox mark:

- background: near-black `#111111`;
- icon: 28–30px, white, centered;
- shadow: subtle neutral elevation;
- hover: slightly lighter black and a small upward translation;
- focus-visible: a high-contrast purple focus ring;
- accessible name: `Open Astro AI Locator settings` or
  `Close Astro AI Locator settings`, matching state.

The provided SVG is embedded inline inside the Shadow DOM. Only the fox
silhouette path is used, filled white against the black button; the source
SVG's full white background path is omitted. The logo is decorative inside the
named button and therefore uses `aria-hidden="true"`.

## Popover hierarchy

The popover is a clean white card approximately 320px wide, with a 12px corner
radius, neutral border, restrained shadow, and a small pointer directed toward
the launcher. It uses the system UI font stack and a strict 4px spacing grid.

### Trigger section

The first section uses 16px padding:

- Header: `Trigger: Option / Alt`
  - `Trigger:` uses 14px medium-weight neutral text.
  - The current key uses 14px semibold purple text.
- Controls: three equal-width rounded buttons in one row, separated by 8px.
  - Labels remain platform-neutral: `Control`, `Option`, `Command`.
  - Active: purple background, white semibold text, no competing border.
  - Inactive: white background, dark text, light neutral border.
  - Hover and focus states must remain distinguishable without shifting layout.
- Helper: `Drag to move. Release the trigger key to interact normally.`
  - 11px regular neutral text with comfortable line height.

The displayed current-key labels are also platform-neutral:
`Control`, `Option / Alt`, and `Command / Meta`. No OS detection is added.

### Divider

A 1px light-neutral horizontal divider separates trigger controls from
preferences. The divider spans the card width while section content retains its
own padding.

### Preferences section

The second section uses 16px padding and structured rows:

- Section label: `Preferences`, 11px semibold muted text.
- Row label: `Overlay Color`, 13px medium dark text.
- Preview: four 18px circular color chips aligned to the right with 6px gaps.

Color chips are visual placeholders in this iteration. They are not buttons,
do not change settings, and must not suggest keyboard interaction. Preset theme
selection and SVG recoloring are explicitly deferred.

## Motion

Opening and closing uses opacity, translation, and scale only:

- duration: 160ms;
- open origin: launcher-facing bottom-left or top-left corner;
- closed state: 0 opacity, 6px vertical offset, 0.98 scale;
- open state: full opacity, zero offset, unit scale;
- pointer events are disabled while closed.

When `prefers-reduced-motion: reduce` is active, transforms and transition
duration are removed. Closing waits for no animation-specific application
state; accessibility state changes immediately.

## Accessibility

- The launcher is a native button with `aria-expanded` and `aria-controls`.
- The card uses `role="dialog"` and an accessible settings label.
- Trigger choices use native buttons and `aria-pressed`.
- `Escape` closes the card and returns focus to the launcher.
- Text and controls meet WCAG AA contrast at their specified sizes.
- Motion reduction is honored.

## State changes

The old server-instance dismissal state and close button are removed. The
client no longer needs `serverInstanceId` solely for settings-panel visibility.

State ownership after the redesign:

- global trigger key: `~/.astro-ai-locator/settings.json`;
- launcher position: origin-scoped `localStorage`;
- popover open/closed: current page memory, initially closed;
- future UI color preset: not implemented.

## Failure handling

- Invalid saved launcher coordinates fall back to bottom-left.
- Unavailable browser storage disables position persistence but not dragging.
- Trigger save failure leaves the old selection active and shows the existing
  locator toast.
- Missing or invalid global settings continue to fall back to `Option / Alt`.

## Verification

Browser tests must cover:

- launcher visibility and default bottom-left placement;
- click toggle, outside-click close, and `Escape` close;
- drag threshold, drag without accidental toggle, viewport clamping, and
  reload position restoration;
- inline fox SVG presence and accessible launcher state;
- platform-neutral key labels and successful trigger changes;
- preferences layout with four non-interactive chips;
- UI exclusion from locator element selection;
- reduced-motion styling;
- all existing overlay, hash registration, React island, pseudo-element,
  pointer-transparent, and MCP resolution regressions.
