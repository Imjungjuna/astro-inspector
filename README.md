<div align="center">

# astro-inspector

**Click a UI element in your Astro dev server. Your AI agent gets the exact source file, line, and column.**

No browser extension. No editor-specific deep links. Copy an MCP-resolvable token
or a compact source reference straight from the page.

[![Astro](https://img.shields.io/badge/Astro-6.2%2B_%7C_7.x-BC52EE?logo=astro&logoColor=white)](https://astro.build)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.12-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/astro-inspector)](https://www.npmjs.com/package/astro-inspector)
[![MCP](https://img.shields.io/badge/MCP-stdio-000000)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](#license)

</div>

---

## Demo

<!--
TODO: drop media into docs/media/ and uncomment the blocks below.

Recommended captures:
  1. demo.gif        — hold trigger key, hover, click, token lands on clipboard
  2. overlay.png     — the three-tier overlay (all boundaries / parent / current target)
  3. popover.png     — the fox button and the trigger-key settings popover
  4. agent.png       — pasting the token into an MCP-connected chat and getting the source back

![Select an element and copy its token](docs/media/demo.gif)

| Overlay hierarchy | Settings popover |
| --- | --- |
| ![Overlay](docs/media/overlay.png) | ![Popover](docs/media/popover.png) |

![Resolving a token in an MCP-connected agent](docs/media/agent.png)
-->

---

## Why

Telling an AI agent *"fix the padding on the card in the pricing section"* makes it guess. It greps, it opens the wrong file, it edits a component that renders somewhere else entirely.

`astro-inspector` removes the guessing. You point at the pixel. The agent gets the line.

```
You: [pastes #a7k9] make this card's padding tighter

Agent: → get_astro_element_by_token
       src/components/PricingCard.astro:24:5  <div> → <div>
       ...edits the right file on the first try
```

---

## Install

Requires **Node.js ≥ 22.12** and **Astro ≥ 6.2.2, < 8**.

```bash
npm install --save-dev astro-inspector
```

Add the integration:

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import { astroInspector } from "astro-inspector";

export default defineConfig({
  integrations: [astroInspector()]
});
```

Ignore the runtime manifest in your project:

```gitignore
# .gitignore
.astro-ai-locator/
```

---

## Usage

Run `astro dev`, then:

| Step | Action |
| --- | --- |
| 1 | Hold the trigger key — `Alt` (`Option` on macOS) by default — and move the pointer over the page. |
| 2 | Read the overlay: faint grey outlines every trackable element, progressively softer themed outlines mark the selected metadata-bearing ancestors, and the strongest themed overlay marks the current target. |
| 3 | Click the element. |
| 4 | By default, a 5-character token like `#a7k9` is copied to your clipboard. Tokens start with `#`, which shells treat as a comment marker — paste them into chat or editors, not into a terminal command line. |
| 5 | Paste the token into any MCP-connected CLI or ACP chat and ask for the change. Or choose `Context` under `Copy As` when a readable source reference is more useful. |

### The hover label

The current target shows a label in the form:

```
◆ <SourceTag→DomTag> │ FileName.astro │ line:column
```

A brand icon at the far left marks where the element came from: the Astro mark for `.astro` templates, the React mark for `.tsx` and `.jsx`. Both sit on a small light disc so they keep their brand color against every overlay color preset. Any other extension drops the icon slot entirely rather than leaving a gap.

The filename keeps its extension, and the arrow is omitted when the source tag and the rendered DOM tag are identical. The full project-relative path is preserved in the DOM metadata, the manifest, and the MCP response. Labels prefer to sit above the target. They use the space below when the label does not fit above but does fit below; if neither side fits, they choose the side with more available space. The result is then clamped to an 8px viewport inset on every edge. The 640px maximum width and ellipsis keep long source names readable without overflowing the screen.

### Copy feedback

After a successful click, a bottom-center status toast confirms whether a token or Context payload was copied. It uses a short pop animation, stays visible long enough to read, and restarts cleanly for rapid consecutive clicks. The toast respects `prefers-reduced-motion` by fading without the scale or overshoot motion.

### Changing locator preferences

A translucent grey fox button sits in the bottom-left corner of every dev page. Click it to open a blurred, high-density settings popover.

- Pick `Control`, `Option / Alt`, or `Command / Meta` from a 28px-row list.
- The active key is marked with a themed keycap; the hovered row stays neutral
  grey.
- Pick `Neutral`, `Violet`, `Orange`, or `Sky` under `Overlay Color`. Violet is
  the default.
- The selected color updates the current and parent outlines, current fill,
  hover label, active keycap, and selected color ring.
- Choose `0`, `1`, `2`, or `3` under `Parent Levels`. The default is `1`.
  `0` hides parent outlines; higher values walk outward through visually
  distinct ancestors carrying both source-file and source-location metadata.
- `Copy As` defaults to `Hash`, which is the precise MCP lookup workflow.
  `Context` can combine Tag and Location, with optional Line when Location is
  selected. Output order is always Tag → Location regardless of click order:

  ```text
  <Link→a> | /apps/astro/src/components/HospitalListCard.tsx:298:13
  ```

- Location can be shown as a Vite workspace-root-relative `Path` (with a
  leading `/`) or an extension-preserving `Module name`. Turning Location off
  also turns Line off; the last Path/Module name preference is remembered when
  Location is enabled again.
- The whole Context row opens and closes its options. Selecting Context from
  Hash opens it automatically; switching back to Hash does not force it
  closed. The disclosure starts closed on every page load.
- Pressing or releasing the trigger key never opens or closes the popover.
- Combinations that include another modifier are not intercepted by the locator.
- Drag the fox button to reposition it — the popover follows and the position persists in the browser.
- Close the popover with an outside click or `Escape`. It always starts closed on reload.

Trigger, Copy As, color, and parent-level choices are stored globally and
apply immediately on the current page. Other open locator pages pick them up
on refresh.

### The popover footer

Two buttons sit below the preference rows.

| Button | What it does |
| --- | --- |
| `Quit Extension` | Closes the locator for this dev server |
| `Copy MCP Prompt` | Copies a setup message for your AI agent — see [MCP setup](#mcp-setup) |

`Copy MCP Prompt` takes the active overlay color as its background, so it
follows whatever preset is selected.

### Closing the locator

`Quit Extension` removes every listener, the overlay, and the fox button, then
confirms with a short toast.

The dev server records the choice in memory for the rest of the process, so
**reloading the page does not bring the locator back**. Restarting `astro dev`
does, and nothing is written to disk — the choice never outlives the process
that received it. Other tabs already open keep working until they reload.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `showAllBoundaries` | `boolean` | `true` | Outline every trackable element while the locator is active. Set to `false` to show only the current target overlay. |

```js
integrations: [astroInspector({ showAllBoundaries: false })]
```

---

## MCP setup

### The short way

Run `astro dev`, open the fox popover, and press `Copy MCP Prompt`. That copies
a message written for an AI agent, with the absolute paths for this project
already filled in. Paste it into any MCP-connected agent and it does the setup.

The agent works out which host it is running in, so there is nothing to pick.

### By hand

`.mcp.json` (Claude Code) and `.cursor/mcp.json` (Cursor) take the same shape.
Merge this into an existing `mcpServers` object rather than replacing the file.
`--project-root` must be an **absolute** path to the Astro project — the
directory `astro dev` runs in, which is where the manifest is written.

```json
{
  "mcpServers": {
    "astro-inspector": {
      "command": "/absolute/path/to/your/astro-project/node_modules/.bin/astro-inspector-mcp",
      "args": ["--project-root", "/absolute/path/to/your/astro-project"]
    }
  }
}
```

Claude Code can register the same thing from the CLI:

```bash
claude mcp add astro-inspector --scope project -- \
  "$PWD/node_modules/.bin/astro-inspector-mcp" --project-root "$PWD"
```

Point `command` at the binary rather than at `npx` whenever the host may launch
it from another working directory. In a pnpm workspace the binary lives in the
package's own `node_modules/.bin`, not at the workspace root.

```json
{
  "command": "npx",
  "args": [
    "--no-install",
    "astro-inspector-mcp",
    "--project-root",
    "/absolute/path/to/your/astro-project"
  ]
}
```

### The tool

When a prompt contains a `#a` locator token, the model calls `get_astro_element_by_token` and receives:

- the project-relative file path, plus a validated absolute path
- line, column, source tag, and rendered DOM tag
- the code surrounding the selection

Full file contents are **never** included in the MCP response. The connected CLI or ACP reads only the range it needs, from the validated path.

---

## How it works

In dev mode the Astro integration installs a Vite plugin and a small browser client.

0. **Serve.** The integration serves its own browser client from `/@astro-inspector/client/` and injects a single `head-inline` script tag pointing at it. It never shares a module with other integrations' page scripts, so a failing import elsewhere on the page cannot stop the locator from installing.
1. **Inject.** Before Astro/React compilation, the plugin adds source-location attributes to `.astro`, `.tsx`, and `.jsx` tags inside the project root. These `data-*` attributes survive into the real DOM, including after React islands hydrate.
2. **Select.** The browser posts the chosen location to an authenticated local dev endpoint.
3. **Token.** The server issues a sequential 5-character token (random session start) and records it in a manifest.
4. **Resolve.** A standalone stdio MCP server reads that manifest, maps the token back to source, and re-verifies that the recorded tag still occupies that location.

### Picking the right element

The client calls `document.elementsFromPoint()` to get the DOM stack under the pointer. The first metadata-bearing element whose own rendered box contains the point defines the visible layer, so a real DOM overlay blocks elements painted behind it. Within that layer, DOM depth and rendered area keep the most specific eligible element selected.

While the locator is active, `::before` and `::after` are prevented from intercepting hit testing. A stretched pseudo-element whose host box does not contain the pointer is skipped. Elements with `pointer-events: none` — which the browser excludes from the hit stack entirely — are collected once on activation, but only descendants of the visible native layer may refine the selected target.

The result: visible overlays remain selectable, stretched pseudo-elements do not hide the real element beneath them, and nested JSX children inside islands still resolve to the correct source location.

### Overlay hierarchy

| Layer | Appearance |
| --- | --- |
| All trackable elements | Faint grey dotted outline |
| Nearest ancestor with metadata | 2px purple solid outline at 40% opacity, no fill, no label, drawn 2px outside the ancestor box so the current boundary never covers it |
| Current target | 2px purple solid outline with a 10% fill, plus the hover label |

### Wrappers

A shared wrapper — `<Link>`, `<Button>`, a card shell — renders someone else's markup. The element you point at is defined in the wrapper, but the line you want to edit is almost always the call site. The locator always answers with the **outermost call site** that reaches the element.

That takes two opposite injection rules, because the two Astro render paths overwrite in opposite directions:

| Tag | Rendered as | Duplicate winner | Metadata goes |
| --- | --- | --- | --- |
| `<button>`, `<div>` — intrinsic | HTML string | first attribute in the tag | after the author's attributes, so a forwarded `{...props}` stays ahead of it |
| `<Wrapper>` — component | props object | last key in the object | right after the tag name, so a forwarded `{...props}` overwrites it |

Consequences worth knowing:

- A wrapper that does **not** forward its props resolves to its own definition. The call site cannot reach the DOM at all.
- Each forwarding hop leaves one ignored duplicate set of `data-astro-ai-locator-*` attributes in the dev HTML. Spreads are resolved at runtime, so they cannot be de-duplicated at compile time. Dev only — production builds carry none of it.

### Token stability

Repeated renders of the same `.astro` tag share one token across all DOM instances. When the file changes through HMR — or is deleted — its existing tokens are invalidated.

The manifest holds at most 100 entries. Once a selection pushes it past that, the 50 least recently registered entries are dropped, and their tokens stop resolving. Re-selecting an element moves it back to the newest end, so a token you are actively working with is not evicted out from under you. Numbers are never reused within a session, so a dropped token dies loudly instead of pointing at a different element.

---

## Runtime files

**Per-project selection manifest** (gitignore this):

```text
.astro-ai-locator/manifest.json
```

**User-global locator settings**, shared across every repository and worktree:

```text
~/.astro-ai-locator/settings.json
```

The browser never touches this file directly. On page load the client makes one authenticated call to a local Vite endpoint, and the Vite process reads or atomically writes the file. Changes apply immediately on the current page; other open pages pick them up on refresh. Schema-v1 through schema-v4 settings are migrated in memory to schema v5; old Module settings become workspace Path settings. A missing or corrupted file falls back to `Option/Alt`, `Violet`, one parent level, and Hash copy with Path + Line ready under Context. The file is not created until you actually change a setting.

---

## Scope

| Supported | Notes |
| --- | --- |
| ✅ `.astro` templates | Full source tracking |
| ✅ React `.tsx` / `.jsx` in the project root | Including nested JSX inside `client:load`, `client:only="react"`, and other hydrated islands |
| ✅ Astro/React component call sites | Metadata is injected at the call site; selectable when the component forwards its received `data-*` props to a real DOM root. Nested wrappers resolve to the outermost call site — see [Wrappers](#wrappers) |
| ⚠️ Monorepo UI packages outside the project root | Source is not transformed. Only components that forward `data-*` props to the DOM are selectable, and they resolve to the in-app call site |
| ❌ Vue, Svelte, and other framework islands | Fine-grained source tracking inside them is not supported yet |

Additional constraints:

- **Dev mode only.** Production builds receive no client, no endpoint, and no source metadata.
- `Quit Extension` lasts for the life of the dev server process. There is no in-page way back — restart `astro dev`.
- If clipboard permission is denied, the client falls back to a browser prompt
  containing the exact Hash or Context payload for manual copy.
- Key combinations the browser never delivers to the page — OS-reserved `Command/Meta` shortcuts, for example — cannot be intercepted.
- Assumes one Astro dev server per project directory.

---

## Security

**Dev endpoints** require a token that is regenerated for every process. The session endpoint reports whether the locator was closed and returns the MCP command for this project; it is the one place an absolute path reaches the browser, and it is never stored in the DOM, manifest, MCP result, or settings. Dev endpoints live under `/@astro-inspector/`. The `/@` prefix is what Vite reserves for its own internal requests, so proxies that already forward Vite traffic by path reach them without extra configuration. The element-registration endpoint caps the request body and the source file size, and accepts only real `.astro` / `.tsx` / `.jsx` files inside the project root at valid line and column positions. The workspace-relative path used by Context copy is derived from Vite's detected workspace root only after that validation; it is returned to the authenticated browser for the current click and is not stored in the DOM, manifest, MCP result, or settings. The settings endpoint validates allowlisted trigger keys, color presets, parent levels, copy modes, context fields, Location/Line dependencies, and Location formats before an atomic write.

**The MCP server** normalizes both manifest and source paths with `realpath`, blocking path traversal and symlink escapes. On stdio, `stdout` carries the MCP protocol only — all diagnostics go to `stderr`.

**The asset endpoint** (`/@astro-inspector/client/…`) carries no token — a `<script src>` cannot send headers — so it serves only the browser-facing `dist/client/**` and `dist/shared/**` trees and nothing else in the package.

---

## Current limitations

- A token stands for a file path, line, column, and DOM tag. Moving the tag or changing what it renders produces a new token.
- Astro major versions that change the compiler AST need separate compatibility verification.
- This release provides source *lookup* only. File-write permission and the actual code edits belong to the connected AI host.

---

## License

ISC
