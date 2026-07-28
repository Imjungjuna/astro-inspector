# Monochrome List Popover Refinement

## Goal

Refine the floating locator controls into a quieter shadcn-style utility:
reduce the launcher size and contrast, then replace the segmented trigger
buttons with a compact vertical selection list.

This document supersedes only the **Launcher** and **Popover hierarchy**
sections of `2026-07-27-floating-locator-popover-design.md`. Dragging,
placement, persistence, dismissal, motion, trigger storage, locator selection,
and MCP behavior remain unchanged.

## Visual direction

The interface is restrained, translucent, and utility-first. A blurred gray
surface establishes hierarchy through spacing and typography while allowing
the development page to remain faintly visible underneath. The supplied white
fox remains the only branded shape outside the popover.

The selected purple keycap and `Overlay Color` preview chips are the intentional
color exceptions. The chips remain non-interactive.

## Launcher

- Diameter: `46px`.
- Fox mark: `25px`, white, centered.
- Default background: `rgba(7, 7, 16, 0.62)`, which composites over white to
  the same visible color as the popover surface.
- Hover background: `rgba(75, 85, 99, 0.78)`.
- Backdrop blur: `14px`.
- Border: subtle white transparency, without changing dimensions on hover.
- Focus-visible: neutral high-contrast ring using zinc-400 and a white gap.
- Existing bottom-left default, drag behavior, position persistence, and
  viewport clamping remain unchanged.

The reduced launcher size must be used by placement and clamping calculations,
not only by CSS.

## Popover shell

- Width: `min(260px, calc(100vw - 24px))`.
- Background: translucent gray, `rgba(63, 63, 70, 0.8)`.
- Backdrop blur: `18px`.
- Foreground: zinc-100, `#f4f4f5`.
- Muted foreground: zinc-400, `#a1a1aa`.
- Section headings: zinc-100, `12px`, semibold (`600`).
- Border: `rgba(255, 255, 255, 0.18)`.
- Radius: `10px`.
- Shadow: restrained shadcn-like neutral elevation.
- No speech-bubble pointer is rendered. The shell sits `6px` from the FAB.
- Above/below placement, 160ms motion, and reduced-motion behavior remain
  unchanged.

## Trigger list

The segmented three-column control and `Trigger: <current>` sentence are
removed. The section contains:

1. A `Trigger` section heading.
2. A vertical list of three native buttons:
   - `Control`;
   - `Option / Alt`;
   - `Command / Meta`.

The `Drag to move. Release the trigger key to interact normally.` helper is
removed. Each row is `28px` high, uses no inter-row gap, and has two aligned
columns:

- `24px` modifier keycap column;
- flexible text label.

The keycap uses a compact monochrome modifier symbol:

- Control: `⌃`;
- Option / Alt: `⌥`;
- Command / Meta: `⌘`.

The `22px` keycap remains a rounded square so it reads as a physical keyboard
key inside the compact row. Its modifier symbol is `16px`.
The selected keycap uses a purple `#7c3aed` background with a white modifier
symbol. Unselected keycaps use a translucent white background and border with
a zinc-300 symbol. Persistent row backgrounds do not differ by selection
state. Hover uses `rgba(255, 255, 255, 0.14)`; focus-visible uses a neutral
inset outline.

The trigger and preferences sections use `8px` horizontal padding, and trigger
rows use `4px` horizontal padding. Removing the check gutter and reducing
padding moves the icon-and-label pair closer to the popover edge inside the
260px shell. Trigger labels and the `Overlay Color` label use near-white
`#ececef` at regular (`400`) weight; section headings and modifier symbols
retain semibold (`600`) weight.

Rows remain semantic `<button type="button">` elements with `aria-pressed`.
The keycap symbols are decorative and hidden from assistive technology; the
visible label supplies the accessible name.

## Preferences list

A full-width neutral divider separates the sections.

The Preferences section uses the same heading style and contains one compact
`28px` list row:

- left: `Overlay Color`;
- right: the existing four non-interactive preview chips.

The row itself is not clickable and does not receive button semantics. Chip
colors remain black, purple, orange, and blue as preview content; the shell,
typography, borders, hover states, and non-selected keycaps use translucent
neutral colors.

## Interaction and state

No behavior changes are introduced:

- FAB click toggles the popover.
- Outside pointer-down and `Escape` close it.
- Dragging the FAB does not toggle the popover.
- Trigger selection persists through the existing authenticated settings
  endpoint and leaves the popover open.
- Trigger-key activation remains independent from popover visibility.

## Verification

Browser tests must prove:

- launcher dimensions are `46×46px`;
- launcher background is `rgba(7, 7, 16, 0.62)` with a `14px` blur;
- fox mark dimensions are `25×25px`;
- three trigger choices render as stacked rows rather than columns;
- no check indicator or check gutter is rendered;
- no drag helper text is rendered;
- no speech-bubble pointer is rendered and the FAB gap is `6px`;
- the popover is `260px` wide and uses translucent gray background, `18px`
  backdrop blur, and zinc-100 text;
- trigger and preference rows are exactly `28px` high;
- trigger rows have no inter-row gap;
- the active row exposes `aria-pressed="true"` and a purple keycap;
- selected and unselected rows share the same persistent background;
- a hovered row uses translucent light gray;
- changing the trigger updates both persistence and selected-row state;
- preferences still show four non-interactive color preview chips;
- existing toggle, Escape, outside-click, drag, placement, and reduced-motion
  regressions continue to pass.
