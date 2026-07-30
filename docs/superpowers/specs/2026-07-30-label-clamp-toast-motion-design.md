# Viewport-safe Label and Pop Toast Design

**Date:** 2026-07-30

## Goal

Keep the hover label fully visible when the selected element touches any
viewport edge, and make click feedback larger and easier to notice with a
short pop animation.

## Scope

Change only the overlay label placement and toast presentation. Preserve hit
resolution, hover target selection, parent boxes, hashes, clipboard payloads,
registration, manifest, MCP, settings, FAB, and settings popover behavior.

## Hover Label

### Structure

Move the existing structured label out of the current target box and make it a
fixed sibling inside the overlay shadow root. Keep the existing Tag, File,
separator, and Line/Column spans, typography hierarchy, maximum width, and
ellipsis behavior.

This avoids mixing viewport coordinates with offsets relative to the selected
element box.

### Placement

Use an 8px viewport safety gap.

1. Measure the label after updating its text.
2. Prefer placing it flush above the selected element.
3. If the label does not fit above, place it flush below the element.
4. If neither side fully fits, choose the side with more available space and
   clamp the final top coordinate into the viewport safety area.
5. Clamp the horizontal coordinate between the left and right viewport safety
   gaps.
6. Recalculate through the existing overlay update flow when the target,
   scroll position, resize state, or active settings change causes `show()` to
   run.

Expose the resolved side as `data-placement="above"` or `"below"` for
debugging and behavior-focused tests.

### Edge Cases

- Top edge: flip below.
- Bottom edge: remain or flip above.
- Left and right edges: clamp without changing label contents.
- Oversized element: choose the side with more room and keep the label inside
  the viewport.
- Long label: preserve the existing maximum width and single-line ellipsis.

## Toast

### Placement and Size

Keep the toast separate from the overlay host so hiding the active locator
does not hide click feedback.

- Fixed at the horizontal center of the viewport.
- Bottom gap: 20px plus `env(safe-area-inset-bottom)`.
- Font: 14px, medium weight.
- Padding: 12px 16px.
- Minimum height: 44px.
- Radius: 10px.
- Maximum width: `min(420px, calc(100vw - 32px))`.
- Single-line ellipsis for long messages.

### Motion

Each `toast(message)` call cancels the previous timeout and restarts the visual
lifecycle, even when the same message repeats.

- Entry duration: about 220ms.
- Pop sequence: opacity 0 and scale 0.92, brief scale 1.04 overshoot, settle at
  scale 1.
- Visible lifetime: about 1.8 seconds total.
- Exit: short opacity fade.
- After exit, remove the visible state so the toast is not exposed visually or
  to hit testing.

For `prefers-reduced-motion: reduce`, remove scale, translation, and overshoot.
Use opacity-only feedback with the same readable lifetime.

## Testing

Add browser regressions before implementation and verify RED:

- top-edge targets place the label below;
- bottom-edge targets place it above;
- left and right edges remain at least 8px inside the viewport;
- long labels stay within the viewport and retain ellipsis constraints;
- the toast is horizontally centered, at least 44px high, and uses 14px text;
- the toast runs the pop animation and restarts on a repeated call;
- reduced motion uses an opacity-only animation;
- existing locator, React island, overlays, `pointer-events:none`, Copy As,
  MCP, and production-output regressions remain green.

## Non-goals

- Changing toast message copy.
- Adding icons or multiple toast variants.
- Making toast placement configurable.
- Altering label content, colors, or source metadata.
