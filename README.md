<div align="center">

# astro-inspector

**Click a UI element in your Astro dev server. Your AI agent gets the exact source file, line, and column.**

No browser extension. No editor-specific deep links. Copy an MCP-resolvable hash
or a compact source reference straight from the page.

[![Astro](https://img.shields.io/badge/Astro-7.x-BC52EE?logo=astro&logoColor=white)](https://astro.build)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522.12-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio-000000)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](#license)

</div>

---

## Demo

<!--
TODO: drop media into docs/media/ and uncomment the blocks below.

Recommended captures:
  1. demo.gif        — hold trigger key, hover, click, hash lands on clipboard
  2. overlay.png     — the three-tier overlay (all boundaries / parent / current target)
  3. popover.png     — the fox button and the trigger-key settings popover
  4. agent.png       — pasting the hash into an MCP-connected chat and getting the source back

![Select an element and copy its hash](docs/media/demo.gif)

| Overlay hierarchy | Settings popover |
| --- | --- |
| ![Overlay](docs/media/overlay.png) | ![Popover](docs/media/popover.png) |

![Resolving a hash in an MCP-connected agent](docs/media/agent.png)
-->

---

## Why

Telling an AI agent *"fix the padding on the card in the pricing section"* makes it guess. It greps, it opens the wrong file, it edits a component that renders somewhere else entirely.

`astro-inspector` removes the guessing. You point at the pixel. The agent gets the line.

```
You: [pastes astro_hash_0123456789abcdef01234567] make this card's padding tighter

Agent: → get_astro_element_by_hash
       src/components/PricingCard.astro:24:5  <div> → <div>
       ...edits the right file on the first try
```

---

## Install

Requires **Node.js ≥ 22.12** and **Astro 7**.

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
| 4 | By default, a hash like `astro_hash_0123456789abcdef01234567` is copied to your clipboard. |
| 5 | Paste the hash into any MCP-connected CLI or ACP chat and ask for the change. Or choose `Context` under `Copy As` when a readable source reference is more useful. |

### The hover label

The current target shows a label in the form:

```
<SourceTag→DomTag> │ FileName.astro │ line:column
```

The filename keeps its extension, and the arrow is omitted when the source tag and the rendered DOM tag are identical. The full project-relative path is preserved in the DOM metadata, the manifest, and the MCP response. Labels prefer to sit above the target. They use the space below when the label does not fit above but does fit below; if neither side fits, they choose the side with more available space. The result is then clamped to an 8px viewport inset on every edge. The 640px maximum width and ellipsis keep long source names readable without overflowing the screen.

### Copy feedback

After a successful click, a bottom-center status toast confirms whether a hash or Context payload was copied. It uses a short pop animation, stays visible long enough to read, and restarts cleanly for rapid consecutive clicks. The toast respects `prefers-reduced-motion` by fading without the scale or overshoot motion.

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

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `showAllBoundaries` | `boolean` | `true` | Outline every trackable element while the locator is active. Set to `false` to show only the current target overlay. |

```js
integrations: [astroInspector({ showAllBoundaries: false })]
```

---

## MCP setup

Register a project-local stdio command with your MCP host. `--project-root` must be an **absolute** path to the Astro project.

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

If your host launches commands from outside the Astro project, point `command` directly at the binary instead:

```
/absolute/path/to/your/astro-project/node_modules/.bin/astro-inspector-mcp
```

### The tool

When a prompt contains an `astro_hash_` value, the model calls `get_astro_element_by_hash` and receives:

- the project-relative file path, plus a validated absolute path
- line, column, source tag, and rendered DOM tag
- the code surrounding the selection

Full file contents are **never** included in the MCP response. The connected CLI or ACP reads only the range it needs, from the validated path.

---

## How it works

In dev mode the Astro integration installs a Vite plugin and a small browser client.

1. **Inject.** Before Astro/React compilation, the plugin adds source-location attributes to `.astro`, `.tsx`, and `.jsx` tags inside the project root. These `data-*` attributes survive into the real DOM, including after React islands hydrate.
2. **Select.** The browser posts the chosen location to an authenticated local dev endpoint.
3. **Hash.** The server derives a deterministic hash and records it in a manifest.
4. **Resolve.** A standalone stdio MCP server reads that manifest and maps the hash back to source.

### Picking the right element

The client calls `document.elementsFromPoint()` to get the DOM stack under the pointer, then de-duplicates metadata candidates. It ranks them by the area of the actual rendered box containing the pointer, then DOM depth, then browser stack order — so the most specific element wins.

While the locator is active, `::before` and `::after` are prevented from intercepting hit testing. Elements with `pointer-events: none` — which the browser excludes from the hit stack entirely — are collected once on activation and folded into the same candidate evaluation.

The result: elements behind real DOM overlays or stretched links, and nested JSX children inside islands, all resolve to the correct source location.

### Overlay hierarchy

| Layer | Appearance |
| --- | --- |
| All trackable elements | Faint grey dotted outline |
| Nearest ancestor with metadata | 2px purple solid outline at 40% opacity, no fill, no label, drawn 2px outside the ancestor box so the current boundary never covers it |
| Current target | 2px purple solid outline with a 10% fill, plus the hover label |

### Hash stability

Repeated renders of the same `.astro` tag share one hash across all DOM instances. When the file changes through HMR — or is deleted — its existing hashes are invalidated.

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
| ✅ Astro/React component call sites | Metadata is injected at the call site; selectable when the component forwards its received `data-*` props to a real DOM root |
| ⚠️ Monorepo UI packages outside the project root | Source is not transformed. Only components that forward `data-*` props to the DOM are selectable, and they resolve to the in-app call site |
| ❌ Vue, Svelte, and other framework islands | Fine-grained source tracking inside them is not supported yet |

Additional constraints:

- **Dev mode only.** Production builds receive no client, no endpoint, and no source metadata.
- If clipboard permission is denied, the client falls back to a browser prompt
  containing the exact Hash or Context payload for manual copy.
- Key combinations the browser never delivers to the page — OS-reserved `Command/Meta` shortcuts, for example — cannot be intercepted.
- Assumes one Astro dev server per project directory.

---

## Security

**Dev endpoints** require a token that is regenerated for every process. The element-registration endpoint caps the request body and the source file size, and accepts only real `.astro` / `.tsx` / `.jsx` files inside the project root at valid line and column positions. The workspace-relative path used by Context copy is derived from Vite's detected workspace root only after that validation; it is returned to the authenticated browser for the current click and is not stored in the DOM, manifest, MCP result, or settings. The settings endpoint validates allowlisted trigger keys, color presets, parent levels, copy modes, context fields, Location/Line dependencies, and Location formats before an atomic write.

**The MCP server** normalizes both manifest and source paths with `realpath`, blocking path traversal and symlink escapes. On stdio, `stdout` carries the MCP protocol only — all diagnostics go to `stderr`.

---

## Current limitations

- A hash is derived from file path, line, column, and DOM tag. Moving the tag or changing what it renders produces a new hash.
- Astro major versions that change the compiler AST need separate compatibility verification.
- This release provides source *lookup* only. File-write permission and the actual code edits belong to the connected AI host.

---

## License

ISC
