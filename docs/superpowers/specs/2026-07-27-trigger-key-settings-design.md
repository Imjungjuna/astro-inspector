# Trigger Key Settings Design

> The settings-panel presentation and close/restart behavior in this document
> are superseded by `2026-07-27-floating-locator-popover-design.md`.

## Goal

Let each developer choose `Control`, `Option/Alt`, or `Command/Meta` as the
locator trigger while sharing that choice across every Astro repository and
worktree on the same machine.

## Settings ownership

The source of truth is:

```text
~/.astro-ai-locator/settings.json
```

```json
{
  "schemaVersion": 1,
  "triggerKey": "alt"
}
```

The browser cannot read this file directly. On each page load, the injected
client performs one authenticated same-origin request to a Vite middleware
endpoint. The middleware reads and validates the small JSON file. A missing or
invalid file falls back to `alt`; a file is created only after the user saves a
choice.

Writes use a temporary file in the same directory followed by `rename`, so a
partial process interruption cannot leave half-written JSON. Concurrent dev
servers use last-successful-write-wins semantics.

## Runtime behavior

The client waits for the settings request before attaching locator listeners.
If loading fails, it logs a warning and installs the locator with `alt`.

Only the selected modifier may be pressed:

- `alt`: `altKey` only
- `control`: `ctrlKey` only
- `meta`: `metaKey` only

Additional modifiers do not activate the locator. The selected modifier plus
click prevents the page's native click behavior and application handler.
Control-click is also handled through `contextmenu`, which is necessary for
macOS secondary-click behavior.

## Settings panel

When the locator becomes active, a small panel appears in the bottom-right
corner. It contains:

- the current trigger key;
- three buttons for `Control`, `Option/Alt`, and `Command/Meta`;
- a drag handle;
- a close button.

The panel is a separate Shadow DOM host from the non-interactive element
overlay. Locator hit resolution and click capture ignore events whose composed
path contains the panel host.

Dragging is constrained to the viewport. The final position is stored in
origin-scoped `localStorage`, because panel placement is browser UI preference,
not a cross-project tool setting.

## Close and restart semantics

Each Astro dev-server start generates a non-secret `serverInstanceId`. Closing
the panel stores that ID in origin-scoped `localStorage`.

- Page refresh with the same server ID: panel stays closed.
- HMR with the same server ID: panel stays closed.
- Astro/Vite dev-server restart: a new ID is injected, so the panel appears
  again the next time the locator is activated.

Closing the panel does not disable element selection. It only hides the
settings UI until the server restarts.

## Failure handling

- Settings GET failure: use `alt`, keep the locator usable, log a warning.
- Settings PUT failure: keep the previous key and show an overlay toast.
- Invalid key or schema: reject the write with HTTP 400.
- Invalid persisted panel position: discard it and use bottom-right default.
- Unavailable `localStorage`: panel remains usable without persistence.

## Scope

There is no browser extension, cross-server live broadcast, home-directory file
watcher, or MCP configuration coupling. Other already-open pages adopt a new
key on their next reload; the page that saves it updates immediately.
