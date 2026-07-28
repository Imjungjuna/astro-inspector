# Astro AI Locator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Implementation status (2026-07-26): Complete.** Gate A showed that Astro
> 7.1.3 does not emit stable source attributes in server HTML by default. The
> implemented package therefore parses raw `.astro` files with
> `@astrojs/compiler-rs` from a Vite `load` hook and injects package-owned
> `data-astro-ai-locator-file` / `data-astro-ai-locator-loc` attributes before
> Astro compilation. This status note and the repository source supersede the
> original Astro-metadata assumption retained in some step-by-step snippets
> below.

**Goal:** Build one npm package that lets a developer hold `Alt/Option`, visually inspect Astro-rendered element boundaries, click one element to copy a deterministic hash, and let a local MCP tool resolve that hash to the exact `.astro` source location and source code.

**Architecture:** The package contains an Astro Integration, a development-only Vite plugin, a browser client, and a standalone stdio MCP server. The Vite plugin annotates native HTML opening tags in raw `.astro` source before Astro compiles them; no browser extension is required. The browser registers only clicked elements through a same-origin Vite middleware endpoint, which atomically updates a local manifest consumed by the MCP server.

**Tech Stack:** TypeScript 6, Node.js 22.12+, Astro 7, Vite 8 plugin API, browser DOM/Clipboard APIs, Vitest 4, Playwright 1.61, `@modelcontextprotocol/sdk` 1.x, Zod 4.

## Global Constraints

- Package form: one ESM npm package named `astro-ai-locator`.
- Runtime floor: Node.js `>=22.12.0`, matching Astro 7's current minimum; use
  an even-numbered supported release.
- Astro peer range for the MVP: `>=7.1.3 <8.0.0`. Lower the minimum only after the same fixture passes against the target version.
- Development only: no overlay client, middleware, or manifest mutation during `astro build` or `astro preview`.
- Activation gesture: `Alt/Option` while hovering; `Alt/Option + Click` selects an element.
- Visual behavior: all annotated elements receive a subtle non-layout-shifting outline while active; the current target receives a stronger fixed overlay and source label.
- Source scope: native HTML emitted from `.astro` templates. DOM created inside hydrated React/Vue/Svelte/Solid islands is explicitly out of MVP scope.
- Source metadata: inject package-owned source file/location attributes by
  parsing raw `.astro` source during Vite loading; preserve original locations
  and source maps.
- Editor independence: no Cursor, VS Code, JetBrains, or URI deep-link behavior.
- Browser extension: none. The Astro Integration injects the browser client.
- Manifest default: `<project-root>/.astro-ai-locator/manifest.json`.
- Hash format: `astro_hash_` plus the first 24 hexadecimal characters of SHA-256 over `v1\0<relative-file>\0<line>\0<column>\0<tag>`.
- Hash meaning: one source template element, not one rendered DOM instance. Repeated loop output from one source tag intentionally shares a hash.
- MCP transport: local stdio only.
- MCP tool name: `get_astro_element_by_hash`.
- MCP project root: required through `--project-root`; do not trust the host process working directory.
- Security: reject paths outside the project root, symlink escapes, non-`.astro` files, malformed locations, oversized request bodies, oversized manifests, and oversized source files.
- Logging: stdout is reserved for MCP JSON-RPC; MCP diagnostics go to stderr.
- Git safety: the current Git top level is `/Users/jungjun`, not `/Users/jungjun/astro-ai-locator`. Do not execute any commit step until `git rev-parse --show-toplevel` equals `/Users/jungjun/astro-ai-locator`.
- Risk gates: use the companion [anticipated bottleneck analysis](./2026-07-26-astro-ai-locator-bottleneck-analysis.md) as the Go/No-Go checklist between vertical slices.

---

## Product Contract

The user-facing flow is fixed:

1. Install `astro-ai-locator` in an Astro project and register `astroAiLocator()` in `astro.config.mjs`.
2. Start `astro dev`.
3. Hold `Alt/Option` to reveal annotated element boundaries.
4. Hover an element to see one strong overlay and a `file:line:column` label.
5. `Alt/Option + Click` the element.
6. Prevent the page’s normal click behavior.
7. POST the source metadata to `/_astro-ai-locator/register`.
8. Validate the source, generate the hash, atomically update the manifest, and return the hash.
9. Copy the returned hash to the clipboard and show a short confirmation toast.
10. Paste the hash into an MCP-enabled CLI or ACP conversation.
11. The model calls `get_astro_element_by_hash`.
12. Return the relative and absolute file paths, line, column, tag, focused excerpt, and full source.

## File Map

All implementation paths below are relative to `/Users/jungjun/astro-ai-locator`.

```text
package.json
.gitignore
tsconfig.json
tsconfig.build.json
vitest.config.ts
playwright.config.ts
src/
├── index.ts                         # Public Astro Integration export
├── shared/
│   └── contracts.ts                 # Browser-safe TypeScript contracts
├── manifest/
│   ├── schema.ts                    # Node-only Zod validation
│   ├── hash.ts                      # Stable identity and SHA-256 hash
│   └── store.ts                     # In-memory entries and atomic persistence
├── integration/
│   ├── request-handler.ts           # Registration endpoint and path validation
│   ├── vite-plugin.ts               # Dev middleware and HMR invalidation
│   └── index.ts                     # Astro hook and client injection
├── client/
│   ├── overlay.ts                   # Global boundaries, target overlay, toast
│   └── index.ts                     # Keyboard, pointer, click, fetch, clipboard
└── mcp/
    ├── resolve-element.ts            # Safe manifest and source lookup
    ├── server.ts                     # Tool registration
    └── cli.ts                        # Argument parsing and stdio startup
scripts/
└── verify-astro-metadata.mjs         # Gate A source-attribute assertion
tests/
├── unit/
│   ├── hash.test.ts
│   ├── manifest-store.test.ts
│   ├── request-handler.test.ts
│   ├── resolve-element.test.ts
│   └── vite-plugin.test.ts
├── integration/
│   ├── mcp-stdio.test.ts
│   └── production-output.test.ts
├── e2e/
│   └── locator.spec.ts
└── fixtures/
    ├── basic/
    │   ├── astro.config.mjs
    │   └── src/
    │       ├── components/Card.astro
    │       └── pages/index.astro
    └── packed/
        ├── astro.config.mjs
        ├── package.json
        ├── smoke-exports.mjs
        └── src/pages/index.astro
README.md
```

---

### Task 1: Establish the ESM package and test harness

**Files:**

- Modify: `package.json`
- Create: `.gitignore`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `vitest.config.ts`
- Create: `src/shared/contracts.ts`
- Create: `src/integration/index.ts`
- Create: `src/index.ts`

**Interfaces:**

- Produces: `LocatorManifestEntry`, `LocatorManifest`, `RegisterElementRequest`, `RegisterElementResponse`, `LocatorClientOptions`.
- Produces: a compilable no-op `astroAiLocator` public export that Task 4 replaces with the development integration.

- [ ] **Step 1: Replace the CommonJS package metadata**

Set `package.json` to:

```json
{
  "name": "astro-ai-locator",
  "version": "0.1.0",
  "description": "Select Astro UI elements in the browser and resolve them through MCP.",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./client": {
      "types": "./dist/client/index.d.ts",
      "import": "./dist/client/index.js"
    },
    "./mcp": {
      "types": "./dist/mcp/server.d.ts",
      "import": "./dist/mcp/server.js"
    }
  },
  "bin": {
    "astro-ai-locator-mcp": "./dist/mcp/cli.js"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "check": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run tests/unit",
    "test:coverage": "vitest run tests/unit --coverage",
    "test:integration": "npm run build && vitest run tests/integration/mcp-stdio.test.ts",
    "fixture:dev": "astro --root tests/fixtures/basic dev --host 127.0.0.1 --port 4321",
    "fixture:build": "astro --root tests/fixtures/basic build",
    "test:e2e": "npm run build && playwright test",
    "test:production": "npm run build && npm run fixture:build && vitest run tests/integration/production-output.test.ts",
    "verify": "npm run check && npm run test && npm run test:integration && npm run test:e2e && npm run test:production && npm run build",
    "prepublishOnly": "npm run verify"
  },
  "engines": {
    "node": ">=22.12.0"
  },
  "peerDependencies": {
    "astro": ">=7.1.3 <8.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.2.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.0",
    "@types/node": "^22.15.0",
    "@vitest/coverage-v8": "^4.1.6",
    "astro": "^7.1.3",
    "typescript": "^6.0.2",
    "vite": "^8.0.10",
    "vitest": "^4.1.6"
  },
  "keywords": [
    "astro",
    "mcp",
    "developer-tools",
    "component-locator"
  ],
  "license": "ISC",
  "sideEffects": false
}
```

- [ ] **Step 2: Ignore generated development and test artifacts**

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
.astro/
.astro-ai-locator/
tests/fixtures/**/dist/
*.tgz
```

- [ ] **Step 3: Install and lock dependencies**

Run:

```bash
npm install
npx playwright install chromium
```

Expected:

- `package-lock.json` is created or updated.
- Chromium is available to Playwright.
- npm reports no unresolved peer dependency.

- [ ] **Step 4: Add strict TypeScript configurations**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": [
    "src/**/*.ts",
    "tests/**/*.ts",
    "vitest.config.ts",
    "playwright.config.ts"
  ]
}
```

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 5: Configure unit tests**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/{unit,integration}/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/manifest/**/*.ts",
        "src/integration/request-handler.ts",
        "src/mcp/resolve-element.ts"
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 65,
        statements: 80
      }
    }
  }
});
```

- [ ] **Step 6: Define browser-safe contracts**

Create `src/shared/contracts.ts`:

```ts
export const LOCATOR_ENDPOINT = "/_astro-ai-locator/register";
export const MANIFEST_DIRECTORY = ".astro-ai-locator";
export const MANIFEST_FILENAME = "manifest.json";
export const HASH_PREFIX = "astro_hash_";

export interface LocatorManifestEntry {
  file: string;
  line: number;
  column: number;
  tag: string;
}

export interface LocatorManifest {
  schemaVersion: 1;
  entries: Record<string, LocatorManifestEntry>;
}

export interface RegisterElementRequest {
  sourceFile: string;
  line: number;
  column: number;
  tag: string;
}

export interface RegisterElementResponse {
  hash: string;
  entry: LocatorManifestEntry;
}

export interface LocatorClientOptions {
  endpoint: string;
  sessionToken: string;
  showAllBoundaries: boolean;
}
```

Replace `src/integration/index.ts` with:

```ts
import type { AstroIntegration } from "astro";

export interface AstroAiLocatorOptions {
  showAllBoundaries?: boolean;
}

export function astroAiLocator(
  _options: AstroAiLocatorOptions = {}
): AstroIntegration {
  return {
    name: "astro-ai-locator",
    hooks: {}
  };
}
```

Create `src/index.ts`:

```ts
export { astroAiLocator } from "./integration/index.js";
export type { AstroAiLocatorOptions } from "./integration/index.js";
```

Verify the scaffold:

```bash
npm pkg get name type engines.node
npm run check
```

Expected:

```json
{
  "name": "astro-ai-locator",
  "type": "module",
  "engines.node": ">=22.12.0"
}
```

TypeScript exits with code 0.

- [ ] **Step 7: Commit after the repository boundary is safe**

Run:

```bash
if [ "$(git rev-parse --show-toplevel)" != "/Users/jungjun/astro-ai-locator" ]; then
  echo "Unsafe Git root; stop before staging." >&2
  exit 1
fi
git add .gitignore package.json package-lock.json tsconfig.json tsconfig.build.json vitest.config.ts src/shared/contracts.ts src/integration/index.ts src/index.ts
git commit -m "chore: scaffold astro ai locator package"
```

Expected: the boundary check passes before any staging occurs.

---

### Task 2: Implement deterministic element identity and manifest persistence

**Files:**

- Create: `src/manifest/hash.ts`
- Create: `src/manifest/schema.ts`
- Create: `src/manifest/store.ts`
- Create: `tests/unit/hash.test.ts`
- Create: `tests/unit/manifest-store.test.ts`

**Interfaces:**

- Consumes: `LocatorManifestEntry`, `LocatorManifest`, `HASH_PREFIX`.
- Produces: `normalizeRelativeFile(file: string): string`.
- Produces: `createElementHash(entry: LocatorManifestEntry): string`.
- Produces: `ManifestStore` with `reset()`, `upsert()`, `removeByFile()`, and `readSnapshot()`.

- [ ] **Step 1: Write failing hash tests**

Create `tests/unit/hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createElementHash,
  normalizeRelativeFile
} from "../../src/manifest/hash.js";

describe("normalizeRelativeFile", () => {
  it("normalizes Windows separators without changing case", () => {
    expect(normalizeRelativeFile("src\\components\\Card.astro")).toBe(
      "src/components/Card.astro"
    );
  });

  it("removes a leading dot segment", () => {
    expect(normalizeRelativeFile("./src/pages/index.astro")).toBe(
      "src/pages/index.astro"
    );
  });
});

describe("createElementHash", () => {
  it("is deterministic for one source element", () => {
    const entry = {
      file: "src/components/Card.astro",
      line: 12,
      column: 5,
      tag: "article"
    };

    expect(createElementHash(entry)).toBe(createElementHash(entry));
    expect(createElementHash(entry)).toMatch(/^astro_hash_[a-f0-9]{24}$/);
  });

  it("changes when the source position changes", () => {
    const first = createElementHash({
      file: "src/components/Card.astro",
      line: 12,
      column: 5,
      tag: "article"
    });
    const second = createElementHash({
      file: "src/components/Card.astro",
      line: 13,
      column: 5,
      tag: "article"
    });

    expect(first).not.toBe(second);
  });
});
```

- [ ] **Step 2: Run the hash tests and confirm failure**

Run:

```bash
npx vitest run tests/unit/hash.test.ts
```

Expected: FAIL because `src/manifest/hash.ts` does not exist.

- [ ] **Step 3: Implement stable hashing**

Create `src/manifest/hash.ts`:

```ts
import { createHash } from "node:crypto";
import path from "node:path";
import { HASH_PREFIX, type LocatorManifestEntry } from "../shared/contracts.js";

export function normalizeRelativeFile(file: string): string {
  const normalized = file.replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

export function createElementHash(entry: LocatorManifestEntry): string {
  const identity = [
    "v1",
    normalizeRelativeFile(entry.file),
    String(entry.line),
    String(entry.column),
    entry.tag.toLowerCase()
  ].join("\0");

  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return `${HASH_PREFIX}${digest.slice(0, 24)}`;
}

export function toProjectRelativeFile(root: string, absoluteFile: string): string {
  return normalizeRelativeFile(path.relative(root, absoluteFile));
}
```

Run:

```bash
npx vitest run tests/unit/hash.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Add strict manifest validation**

Create `src/manifest/schema.ts`:

```ts
import * as z from "zod/v4";

export const LocatorManifestEntrySchema = z
  .object({
    file: z.string().min(1).max(4096),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    tag: z.string().regex(/^[a-z][a-z0-9-]*$/)
  })
  .strict();

export const LocatorManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.record(
      z.string().regex(/^astro_hash_[a-f0-9]{24}$/),
      LocatorManifestEntrySchema
    )
  })
  .strict();

export const RegisterElementRequestSchema = z
  .object({
    sourceFile: z.string().min(1).max(4096),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    tag: z.string().regex(/^[a-z][a-z0-9-]*$/)
  })
  .strict();
```

- [ ] **Step 5: Write failing atomic-store tests**

Create `tests/unit/manifest-store.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";

describe("ManifestStore", () => {
  it("persists a sorted versioned manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();

    await store.upsert("astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb", {
      file: "src/B.astro",
      line: 2,
      column: 1,
      tag: "div"
    });
    await store.upsert("astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa", {
      file: "src/A.astro",
      line: 1,
      column: 1,
      tag: "main"
    });

    const raw = await readFile(store.manifestPath, "utf8");
    const manifest = JSON.parse(raw) as {
      schemaVersion: number;
      entries: Record<string, unknown>;
    };

    expect(manifest.schemaVersion).toBe(1);
    expect(Object.keys(manifest.entries)).toEqual([
      "astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa",
      "astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb"
    ]);
  });

  it("removes every entry belonging to one source file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();
    await store.upsert("astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa", {
      file: "src/Card.astro",
      line: 1,
      column: 1,
      tag: "article"
    });
    await store.upsert("astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb", {
      file: "src/Card.astro",
      line: 2,
      column: 1,
      tag: "button"
    });

    await store.removeByFile("src/Card.astro");

    expect((await store.readSnapshot()).entries).toEqual({});
  });

  it("rejects one hash mapping to two different elements", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();
    const hash = "astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa";
    await store.upsert(hash, {
      file: "src/Card.astro",
      line: 1,
      column: 1,
      tag: "article"
    });

    await expect(
      store.upsert(hash, {
        file: "src/Header.astro",
        line: 1,
        column: 1,
        tag: "header"
      })
    ).rejects.toThrow("Locator hash collision");
  });
});
```

- [ ] **Step 6: Run store tests and confirm failure**

Run:

```bash
npx vitest run tests/unit/manifest-store.test.ts
```

Expected: FAIL because `ManifestStore` is not implemented.

- [ ] **Step 7: Implement serialized atomic writes**

Create `src/manifest/store.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MANIFEST_DIRECTORY,
  MANIFEST_FILENAME,
  type LocatorManifest,
  type LocatorManifestEntry
} from "../shared/contracts.js";
import { LocatorManifestSchema } from "./schema.js";

export class ManifestStore {
  readonly manifestPath: string;
  private entries = new Map<string, LocatorManifestEntry>();
  private writeQueue: Promise<void> = Promise.resolve();
  private writeSequence = 0;

  constructor(private readonly root: string) {
    this.manifestPath = path.join(
      root,
      MANIFEST_DIRECTORY,
      MANIFEST_FILENAME
    );
  }

  async reset(): Promise<void> {
    this.entries.clear();
    await this.persist();
  }

  async upsert(hash: string, entry: LocatorManifestEntry): Promise<void> {
    const existing = this.entries.get(hash);
    if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) {
      throw new Error(`Locator hash collision: ${hash}`);
    }
    this.entries.set(hash, entry);
    await this.persist();
  }

  async removeByFile(file: string): Promise<void> {
    let changed = false;
    for (const [hash, entry] of this.entries) {
      if (entry.file === file) {
        this.entries.delete(hash);
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
    }
  }

  async readSnapshot(): Promise<LocatorManifest> {
    const raw = await readFile(this.manifestPath, "utf8");
    return LocatorManifestSchema.parse(JSON.parse(raw));
  }

  private persist(): Promise<void> {
    const snapshot: LocatorManifest = {
      schemaVersion: 1,
      entries: Object.fromEntries(
        [...this.entries.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        )
      )
    };

    this.writeQueue = this.writeQueue.then(async () => {
      const directory = path.dirname(this.manifestPath);
      await mkdir(directory, { recursive: true });
      const temporaryPath = `${this.manifestPath}.${process.pid}.${this.writeSequence++}.tmp`;
      await writeFile(
        temporaryPath,
        `${JSON.stringify(snapshot, null, 2)}\n`,
        "utf8"
      );
      await rename(temporaryPath, this.manifestPath);
    });

    return this.writeQueue;
  }
}
```

Run:

```bash
npx vitest run tests/unit/hash.test.ts tests/unit/manifest-store.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 8: Commit after the repository boundary is safe**

Run:

```bash
if [ "$(git rev-parse --show-toplevel)" != "/Users/jungjun/astro-ai-locator" ]; then
  echo "Unsafe Git root; stop before staging." >&2
  exit 1
fi
git add src/manifest tests/unit/hash.test.ts tests/unit/manifest-store.test.ts
git commit -m "feat: add deterministic locator manifest"
```

---

### Task 3: Add the secure development registration endpoint

**Files:**

- Create: `src/integration/request-handler.ts`
- Create: `src/integration/vite-plugin.ts`
- Create: `tests/unit/request-handler.test.ts`

**Interfaces:**

- Consumes: `ManifestStore`, `RegisterElementRequestSchema`, `createElementHash`.
- Produces: `createRegistrationHandler(options): (request, response, next) => Promise<void>`.
- Produces: `createLocatorVitePlugin(options): Plugin`.

- [ ] **Step 1: Write failing request-handler tests**

Create `tests/unit/request-handler.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";
import { createRegistrationHandler } from "../../src/integration/request-handler.js";

function requestFor(body: unknown, token = "session-token") {
  const request = Readable.from([JSON.stringify(body)]) as Readable & {
    method?: string;
    headers: Record<string, string>;
  };
  request.method = "POST";
  request.headers = {
    "content-type": "application/json",
    "x-astro-ai-locator-token": token
  };
  return request as unknown as IncomingMessage;
}

function responseRecorder() {
  const chunks: string[] = [];
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk = "") {
      chunks.push(String(chunk));
    }
  } as unknown as ServerResponse;
  return {
    response,
    body: () => chunks.join("")
  };
}

describe("createRegistrationHandler", () => {
  it("registers a validated Astro source element", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "<article>Card</article>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 1,
        column: 1,
        tag: "article"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(200);
    expect(JSON.parse(recorder.body()).hash).toMatch(
      /^astro_hash_[a-f0-9]{24}$/
    );
    expect(JSON.parse(await readFile(store.manifestPath, "utf8"))).toMatchObject({
      schemaVersion: 1
    });
  });

  it("rejects a source outside the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
    const source = path.join(outside, "Escape.astro");
    await writeFile(source, "<div>Escape</div>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 1,
        column: 1,
        tag: "div"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(400);
  });

  it("rejects a request with the wrong development-session token", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "<article>Card</article>\n", "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor(
        {
          sourceFile: source,
          line: 1,
          column: 1,
          tag: "article"
        },
        "wrong-token"
      ),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(403);
  });

  it("rejects an oversized Astro source before reading it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const source = path.join(root, "src", "Large.astro");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "x".repeat(512 * 1024 + 1), "utf8");
    const store = new ManifestStore(root);
    await store.reset();
    const handler = createRegistrationHandler({
      root,
      sessionToken: "session-token",
      store
    });
    const recorder = responseRecorder();

    await handler(
      requestFor({
        sourceFile: source,
        line: 1,
        column: 1,
        tag: "div"
      }),
      recorder.response,
      vi.fn()
    );

    expect(recorder.response.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
npx vitest run tests/unit/request-handler.test.ts
```

Expected: FAIL because the handler does not exist.

- [ ] **Step 3: Implement body, token, path, file, and location validation**

Create `src/integration/request-handler.ts`:

```ts
import { realpath, readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ManifestStore } from "../manifest/store.js";
import { createElementHash, toProjectRelativeFile } from "../manifest/hash.js";
import { RegisterElementRequestSchema } from "../manifest/schema.js";

const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024;

type Next = (error?: unknown) => void;

interface RegistrationHandlerOptions {
  root: string;
  sessionToken: string;
  store: ManifestStore;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("Request body exceeds 8 KiB");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function validateSource(
  root: string,
  sourceFile: string,
  line: number,
  column: number
): Promise<string> {
  const candidate = path.isAbsolute(sourceFile)
    ? sourceFile
    : path.resolve(root, sourceFile);
  const canonicalRoot = await realpath(root);
  const canonicalFile = await realpath(candidate);
  if (!isInside(canonicalRoot, canonicalFile)) {
    throw new Error("Source is outside the project root");
  }
  if (path.extname(canonicalFile).toLowerCase() !== ".astro") {
    throw new Error("Source is not an Astro file");
  }
  const info = await stat(canonicalFile);
  if (!info.isFile() || info.size > MAX_SOURCE_BYTES) {
    throw new Error("Source is not a regular file or exceeds 512 KiB");
  }
  const source = await readFile(canonicalFile, "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    throw new Error("Source exceeds 512 KiB");
  }
  const lines = source.split(/\r?\n/u);
  const selectedLine = lines[line - 1];
  if (selectedLine === undefined || column > selectedLine.length + 1) {
    throw new Error("Source location is outside the file");
  }
  return canonicalFile;
}

export function createRegistrationHandler(
  options: RegistrationHandlerOptions
) {
  return async function registrationHandler(
    request: IncomingMessage,
    response: ServerResponse,
    next: Next
  ): Promise<void> {
    if (request.method !== "POST") {
      next();
      return;
    }

    response.setHeader("content-type", "application/json; charset=utf-8");

    try {
      if (
        request.headers["x-astro-ai-locator-token"] !== options.sessionToken
      ) {
        response.statusCode = 403;
        response.end(JSON.stringify({ error: "Invalid session token" }));
        return;
      }

      const input = RegisterElementRequestSchema.parse(
        await readJsonBody(request)
      );
      const canonicalFile = await validateSource(
        options.root,
        input.sourceFile,
        input.line,
        input.column
      );
      const entry = {
        file: toProjectRelativeFile(options.root, canonicalFile),
        line: input.line,
        column: input.column,
        tag: input.tag.toLowerCase()
      };
      const hash = createElementHash(entry);
      await options.store.upsert(hash, entry);
      response.statusCode = 200;
      response.end(JSON.stringify({ hash, entry }));
    } catch (error) {
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Invalid request"
        })
      );
    }
  };
}
```

- [ ] **Step 4: Run the request tests**

Run:

```bash
npx vitest run tests/unit/request-handler.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Implement the development-only Vite plugin**

Create `src/integration/vite-plugin.ts`:

```ts
import { realpathSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { toProjectRelativeFile } from "../manifest/hash.js";
import { ManifestStore } from "../manifest/store.js";
import { LOCATOR_ENDPOINT } from "../shared/contracts.js";
import { createRegistrationHandler } from "./request-handler.js";

interface LocatorVitePluginOptions {
  root: string;
  sessionToken: string;
  store?: ManifestStore;
}

export function createLocatorVitePlugin(
  options: LocatorVitePluginOptions
): Plugin {
  const root = realpathSync(options.root);
  const store = options.store ?? new ManifestStore(root);
  const ready = store.reset();
  const registrationHandler = createRegistrationHandler({
    root,
    sessionToken: options.sessionToken,
    store
  });

  return {
    name: "astro-ai-locator:dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(LOCATOR_ENDPOINT, (request, response, next) => {
        void ready
          .then(() => registrationHandler(request, response, next))
          .catch(next);
      });

      const removeUnlinkedFile = (file: string) => {
        if (path.extname(file).toLowerCase() !== ".astro") {
          return;
        }
        void ready
          .then(() =>
            store.removeByFile(toProjectRelativeFile(root, file))
          )
          .catch((error: unknown) => {
            server.config.logger.error(
              `astro-ai-locator unlink cleanup failed: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          });
      };

      server.watcher.on("unlink", removeUnlinkedFile);
      server.httpServer?.once("close", () => {
        server.watcher.off("unlink", removeUnlinkedFile);
      });
    },
    async handleHotUpdate(context) {
      if (path.extname(context.file).toLowerCase() === ".astro") {
        await ready;
        await store.removeByFile(
          toProjectRelativeFile(root, context.file)
        );
      }
    }
  };
}
```

- [ ] **Step 6: Run all current unit tests**

Run:

```bash
npm test
```

Expected: 11 tests pass.

- [ ] **Step 7: Commit after the repository boundary is safe**

Run:

```bash
if [ "$(git rev-parse --show-toplevel)" != "/Users/jungjun/astro-ai-locator" ]; then
  echo "Unsafe Git root; stop before staging." >&2
  exit 1
fi
git add src/integration/request-handler.ts src/integration/vite-plugin.ts tests/unit/request-handler.test.ts
git commit -m "feat: register clicked astro elements in dev"
```

---

### Task 4: Wire the Astro Integration and injected client configuration

**Files:**

- Modify: `src/integration/index.ts`
- Modify: `src/index.ts`
- Create: `src/client/index.ts`
- Create: `tests/fixtures/basic/astro.config.mjs`
- Create: `tests/fixtures/basic/src/components/Card.astro`
- Create: `tests/fixtures/basic/src/pages/index.astro`
- Create: `scripts/verify-astro-metadata.mjs`

**Interfaces:**

- Consumes: `createLocatorVitePlugin`.
- Produces: `astroAiLocator(options?: AstroAiLocatorOptions): AstroIntegration`.
- Produces: browser call `installLocator(LocatorClientOptions)` through the `astro-ai-locator/client` export.

- [ ] **Step 1: Implement the integration factory**

Create `src/integration/index.ts`:

```ts
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { LOCATOR_ENDPOINT } from "../shared/contracts.js";
import { createLocatorVitePlugin } from "./vite-plugin.js";

export interface AstroAiLocatorOptions {
  showAllBoundaries?: boolean;
}

export function astroAiLocator(
  options: AstroAiLocatorOptions = {}
): AstroIntegration {
  return {
    name: "astro-ai-locator",
    hooks: {
      "astro:config:setup"({
        command,
        config,
        injectScript,
        updateConfig
      }) {
        if (command !== "dev") {
          return;
        }

        const root = fileURLToPath(config.root);
        const sessionToken = randomBytes(24).toString("hex");
        const clientOptions = {
          endpoint: LOCATOR_ENDPOINT,
          sessionToken,
          showAllBoundaries: options.showAllBoundaries ?? true
        };

        updateConfig({
          vite: {
            plugins: [
              createLocatorVitePlugin({
                root,
                sessionToken
              })
            ]
          }
        });

        injectScript(
          "page",
          [
            'import { installLocator } from "astro-ai-locator/client";',
            `installLocator(${JSON.stringify(clientOptions)});`
          ].join("\n")
        );
      }
    }
  };
}
```

Keep `src/index.ts` as:

```ts
export { astroAiLocator } from "./integration/index.js";
export type { AstroAiLocatorOptions } from "./integration/index.js";
```

- [ ] **Step 2: Add the fixture Astro config**

Create `tests/fixtures/basic/astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import { astroAiLocator } from "../../../dist/index.js";

export default defineConfig({
  integrations: [astroAiLocator()]
});
```

- [ ] **Step 3: Add fixture components with unambiguous targets**

Create `tests/fixtures/basic/src/components/Card.astro`:

```astro
---
const cards = ["Alpha", "Beta"];
---

<section id="card-list">
  {
    cards.map((label) => (
      <article class="card" data-testid={`card-${label.toLowerCase()}`}>
        <h2>{label}</h2>
        <button type="button">Choose {label}</button>
      </article>
    ))
  }
</section>

<style>
  .card {
    padding: 16px;
  }
</style>
```

Create `tests/fixtures/basic/src/pages/index.astro`:

```astro
---
import Card from "../components/Card.astro";
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Astro AI Locator Fixture</title>
  </head>
  <body>
    <main>
      <h1>Locator fixture</h1>
      <Card />
    </main>
  </body>
</html>
```

- [ ] **Step 4: Add the minimal no-op client entry required for package compilation**

Create `src/client/index.ts`:

```ts
import type { LocatorClientOptions } from "../shared/contracts.js";

export function installLocator(_options: LocatorClientOptions): () => void {
  return () => undefined;
}
```

- [ ] **Step 5: Verify TypeScript and package output**

Run:

```bash
npm run check
npm run build
node -e "import('./dist/index.js').then((module) => console.log(typeof module.astroAiLocator))"
```

Expected:

```text
function
```

- [ ] **Step 6: Create an executable Gate A metadata verifier**

Create `scripts/verify-astro-metadata.mjs`:

```js
const targetUrl = process.argv[2] ?? "http://127.0.0.1:4321";
const response = await fetch(targetUrl);
if (!response.ok) {
  throw new Error(`Fixture request failed with HTTP ${response.status}`);
}

const html = await response.text();
const articleTags = html.match(/<article\b[^>]*>/gu) ?? [];
if (articleTags.length !== 2) {
  throw new Error(`Expected two rendered articles, found ${articleTags.length}`);
}

function readAttribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}="([^"]+)"`, "u"))?.[1];
}

const sources = articleTags.map((tag) => ({
  file: readAttribute(tag, "data-astro-source-file"),
  location: readAttribute(tag, "data-astro-source-loc")
}));

for (const source of sources) {
  if (!source.file?.endsWith("Card.astro")) {
    throw new Error(`Article source file is missing or unexpected: ${source.file}`);
  }
  if (!source.location || !/^\d+:\d+$/u.test(source.location)) {
    throw new Error(`Article source location is invalid: ${source.location}`);
  }
}

if (
  sources[0]?.file !== sources[1]?.file ||
  sources[0]?.location !== sources[1]?.location
) {
  throw new Error(
    `Repeated articles do not share one source identity: ${JSON.stringify(sources)}`
  );
}

console.log(
  `Astro metadata gate passed: ${sources[0]?.file}:${sources[0]?.location}`
);
```

- [ ] **Step 7: Pass the Astro source-metadata gate before building UI behavior**

In terminal A, run:

```bash
ASTRO_DEV_BACKGROUND=0 npm run fixture:dev
```

In terminal B, run:

```bash
node scripts/verify-astro-metadata.mjs http://127.0.0.1:4321
```

Expected:

- The script reports `Astro metadata gate passed`.
- Both rendered `<article>` instances trace to the same `Card.astro`
  `line:column` identity.
- If any assertion fails, stop at Gate A in the bottleneck document.
  Do not implement the overlay until the fallback metadata strategy has been
  prototyped and approved.

Stop terminal A with `Ctrl+C`.

- [ ] **Step 8: Commit after the repository boundary is safe**

Run:

```bash
if [ "$(git rev-parse --show-toplevel)" != "/Users/jungjun/astro-ai-locator" ]; then
  echo "Unsafe Git root; stop before staging." >&2
  exit 1
fi
git add src/index.ts src/integration/index.ts src/client/index.ts scripts/verify-astro-metadata.mjs tests/fixtures/basic
git commit -m "feat: add development-only astro integration"
```

---

### Task 5: Build modifier-key boundaries, target overlay, and hash copy

**Files:**

- Create: `src/client/overlay.ts`
- Modify: `src/client/index.ts`
- Create: `playwright.config.ts`
- Create: `tests/e2e/locator.spec.ts`

**Interfaces:**

- Consumes: `LocatorClientOptions`, `RegisterElementRequest`, `RegisterElementResponse`.
- Produces: `createOverlay(showAllBoundaries: boolean): LocatorOverlay`.
- Produces: `installLocator(options): () => void`.

- [ ] **Step 1: Configure the real-browser fixture**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  webServer: {
    command: "npm run fixture:dev",
    url: "http://127.0.0.1:4321",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ASTRO_DEV_BACKGROUND: "0"
    }
  },
  use: {
    baseURL: "http://127.0.0.1:4321",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
```

- [ ] **Step 2: Write failing hover-and-copy tests**

Create `tests/e2e/locator.spec.ts`:

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("Alt hover reveals boundaries and a strong target overlay", async ({
  page
}) => {
  await page.goto("/");
  const card = page.getByTestId("card-alpha");
  await card.hover();
  await page.keyboard.down("Alt");

  await expect(page.locator("html")).toHaveAttribute(
    "data-astro-ai-locator-active",
    ""
  );
  await expect(page.locator("[data-astro-ai-locator-overlay]")).toBeVisible();
  const outlineStyle = await card.evaluate(
    (element) => getComputedStyle(element).outlineStyle
  );
  expect(outlineStyle).toBe("dashed");

  await page.keyboard.up("Alt");
  await expect(page.locator("[data-astro-ai-locator-overlay]")).toBeHidden();
});

test("Alt click registers the source and copies its hash", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  const card = page.getByTestId("card-alpha");
  await card.click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });

  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  await expect(page.locator("[data-astro-ai-locator-toast]")).toContainText(
    "Copied"
  );

  const manifestPath = path.resolve(
    "tests/fixtures/basic/.astro-ai-locator/manifest.json"
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    entries: Record<string, { file: string; tag: string }>;
  };
  expect(manifest.entries[copied]).toMatchObject({
    file: "src/components/Card.astro",
    tag: "article"
  });
});
```

- [ ] **Step 3: Run the browser tests and confirm failure**

Run:

```bash
npm run build
npx playwright test tests/e2e/locator.spec.ts
```

Expected: FAIL because the no-op client does not install visual or click behavior.

- [ ] **Step 4: Implement an isolated overlay**

Create `src/client/overlay.ts`:

```ts
const GLOBAL_STYLE = `
html[data-astro-ai-locator-active] [data-astro-source-file][data-astro-source-loc] {
  outline: 1px dashed rgba(139, 92, 246, 0.55) !important;
  outline-offset: -1px !important;
  cursor: crosshair !important;
}
`;

export interface LocatorOverlay {
  show(target: Element): void;
  hide(): void;
  toast(message: string): void;
  destroy(): void;
}

export function createOverlay(showAllBoundaries: boolean): LocatorOverlay {
  const globalStyle = document.createElement("style");
  globalStyle.dataset.astroAiLocatorStyle = "";
  globalStyle.textContent = showAllBoundaries ? GLOBAL_STYLE : "";
  document.head.append(globalStyle);

  const host = document.createElement("div");
  host.dataset.astroAiLocatorOverlay = "";
  host.style.cssText =
    "position:fixed;inset:0;display:none;pointer-events:none;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .box {
        position: fixed;
        box-sizing: border-box;
        border: 2px solid #8b5cf6;
        background: rgba(139, 92, 246, 0.08);
        pointer-events: none;
      }
      .label {
        position: absolute;
        left: -2px;
        bottom: 100%;
        max-width: min(640px, 90vw);
        padding: 3px 6px;
        overflow: hidden;
        color: white;
        background: #6d28d9;
        border-radius: 4px 4px 0 0;
        font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
    <div class="box"><span class="label"></span></div>
  `;
  document.documentElement.append(host);

  const toast = document.createElement("div");
  toast.dataset.astroAiLocatorToast = "";
  toast.style.cssText =
    "position:fixed;right:16px;bottom:16px;display:none;z-index:2147483647;padding:8px 12px;border-radius:6px;background:#111827;color:white;font:12px/1.4 ui-sans-serif,sans-serif;pointer-events:none;";
  document.documentElement.append(toast);
  const box = shadow.querySelector<HTMLElement>(".box");
  const label = shadow.querySelector<HTMLElement>(".label");
  if (!box || !label) {
    throw new Error("Locator overlay could not initialize");
  }
  let toastTimer = 0;

  return {
    show(target) {
      const rect = target.getBoundingClientRect();
      const file = target.getAttribute("data-astro-source-file") ?? "unknown";
      const location =
        target.getAttribute("data-astro-source-loc") ?? "unknown";
      host.style.display = "block";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      label.textContent = `${file}:${location}`;
    },
    hide() {
      host.style.display = "none";
    },
    toast(message) {
      window.clearTimeout(toastTimer);
      toast.textContent = message;
      toast.style.display = "block";
      toastTimer = window.setTimeout(() => {
        toast.style.display = "none";
      }, 1800);
    },
    destroy() {
      window.clearTimeout(toastTimer);
      globalStyle.remove();
      host.remove();
      toast.remove();
    }
  };
}
```

- [ ] **Step 5: Implement activation, targeting, registration, and clipboard fallback**

Replace `src/client/index.ts` with:

```ts
import type {
  LocatorClientOptions,
  RegisterElementRequest,
  RegisterElementResponse
} from "../shared/contracts.js";
import { createOverlay } from "./overlay.js";

declare global {
  interface Window {
    __astroAiLocatorCleanup?: () => void;
    __astroAiLocatorWarnedMissingMetadata?: boolean;
  }
}

const SOURCE_SELECTOR =
  "[data-astro-source-file][data-astro-source-loc]";

function parseTarget(target: Element): RegisterElementRequest | null {
  const sourceFile = target.getAttribute("data-astro-source-file");
  const location = target.getAttribute("data-astro-source-loc");
  const match = location?.match(/^(\d+):(\d+)$/u);
  if (!sourceFile || !match) {
    return null;
  }
  return {
    sourceFile,
    line: Number(match[1]),
    column: Number(match[2]),
    tag: target.localName.toLowerCase()
  };
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText =
      "position:fixed;left:-9999px;top:-9999px;opacity:0;";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("Clipboard permission was denied");
    }
  }
}

export function installLocator(options: LocatorClientOptions): () => void {
  window.__astroAiLocatorCleanup?.();
  const overlay = createOverlay(options.showAllBoundaries);
  if (
    !document.querySelector(SOURCE_SELECTOR) &&
    !window.__astroAiLocatorWarnedMissingMetadata
  ) {
    window.__astroAiLocatorWarnedMissingMetadata = true;
    console.warn(
      "astro-ai-locator: no Astro source metadata was found on this page"
    );
  }
  let activeTarget: Element | null = null;
  let pointerX = 0;
  let pointerY = 0;

  const setActive = (active: boolean) => {
    if (active) {
      document.documentElement.setAttribute(
        "data-astro-ai-locator-active",
        ""
      );
      const candidate = document.elementFromPoint(pointerX, pointerY);
      activeTarget = candidate?.closest(SOURCE_SELECTOR) ?? null;
      if (activeTarget) {
        overlay.show(activeTarget);
      }
      return;
    }
    document.documentElement.removeAttribute(
      "data-astro-ai-locator-active"
    );
    activeTarget = null;
    overlay.hide();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Alt") {
      setActive(true);
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Alt") {
      setActive(false);
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!event.altKey) {
      if (
        document.documentElement.hasAttribute(
          "data-astro-ai-locator-active"
        )
      ) {
        setActive(false);
      }
      return;
    }
    if (
      !document.documentElement.hasAttribute(
        "data-astro-ai-locator-active"
      )
    ) {
      setActive(true);
    }
    const candidate = document
      .elementFromPoint(pointerX, pointerY)
      ?.closest(SOURCE_SELECTOR);
    if (candidate !== activeTarget) {
      activeTarget = candidate ?? null;
      if (activeTarget) {
        overlay.show(activeTarget);
      } else {
        overlay.hide();
      }
    }
  };
  const onClick = async (event: MouseEvent) => {
    if (!event.altKey) {
      return;
    }
    const origin = event.target;
    if (!(origin instanceof Element)) {
      return;
    }
    const target = origin.closest(SOURCE_SELECTOR);
    if (!target) {
      return;
    }
    const input = parseTarget(target);
    if (!input) {
      overlay.toast("Unable to read Astro source metadata");
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      const response = await fetch(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-astro-ai-locator-token": options.sessionToken
        },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        throw new Error(`Registration failed with HTTP ${response.status}`);
      }
      const result = (await response.json()) as RegisterElementResponse;
      if (!/^astro_hash_[a-f0-9]{24}$/u.test(result.hash)) {
        throw new Error("Registration returned an invalid locator hash");
      }
      target.setAttribute("data-comp-hash", result.hash);
      try {
        await copyText(result.hash);
        overlay.toast(`Copied ${result.hash}`);
      } catch {
        window.prompt("Copy Astro locator hash:", result.hash);
        overlay.toast("Clipboard was blocked; hash opened for manual copy");
      }
    } catch (error) {
      overlay.toast(
        error instanceof Error ? error.message : "Unable to copy locator hash"
      );
    } finally {
      setActive(false);
    }
  };
  const onBlur = () => setActive(false);
  const onVisibilityChange = () => {
    if (document.hidden) {
      setActive(false);
    }
  };
  const repositionActiveTarget = () => {
    if (activeTarget) {
      overlay.show(activeTarget);
    }
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", repositionActiveTarget);
  window.addEventListener("scroll", repositionActiveTarget, true);
  document.addEventListener("visibilitychange", onVisibilityChange);

  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", repositionActiveTarget);
    window.removeEventListener("scroll", repositionActiveTarget, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    setActive(false);
    overlay.destroy();
    if (window.__astroAiLocatorCleanup === cleanup) {
      delete window.__astroAiLocatorCleanup;
    }
  };

  window.__astroAiLocatorCleanup = cleanup;
  return cleanup;
}
```

- [ ] **Step 6: Run the browser tests**

Run:

```bash
npm run build
npx playwright test tests/e2e/locator.spec.ts
```

Expected: 2 Chromium tests pass, the clipboard contains an `astro_hash_` value, and the manifest points to `src/components/Card.astro`.

- [ ] **Step 7: Commit after the repository boundary is safe**

Run:

```bash
if [ "$(git rev-parse --show-toplevel)" != "/Users/jungjun/astro-ai-locator" ]; then
  echo "Unsafe Git root; stop before staging." >&2
  exit 1
fi
git add src/client playwright.config.ts tests/e2e/locator.spec.ts
git commit -m "feat: visualize and copy astro element hashes"
```

---

### Task 6: Implement safe hash resolution and the stdio MCP server

**Files:**

- Create: `src/mcp/resolve-element.ts`
- Create: `src/mcp/server.ts`
- Create: `src/mcp/cli.ts`
- Create: `tests/unit/resolve-element.test.ts`
- Create: `tests/integration/mcp-stdio.test.ts`

**Interfaces:**

- Consumes: `LocatorManifestSchema`, manifest constants.
- Produces: `resolveElementByHash(options): Promise<ResolvedAstroElement>`.
- Produces: `createMcpServer(options): McpServer`.
- Produces: executable `astro-ai-locator-mcp --project-root <absolute-path>`.

- [ ] **Step 1: Write failing resolver tests**

Create `tests/unit/resolve-element.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveElementByHash } from "../../src/mcp/resolve-element.js";
import { ManifestStore } from "../../src/manifest/store.js";

describe("resolveElementByHash", () => {
  it("returns the validated source and focused excerpt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const file = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      "---\nconst title = 'Card';\n---\n<article>{title}</article>\n",
      "utf8"
    );
    const hash = "astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa";
    const store = new ManifestStore(root);
    await store.reset();
    await store.upsert(hash, {
      file: "src/Card.astro",
      line: 4,
      column: 1,
      tag: "article"
    });

    const result = await resolveElementByHash({ projectRoot: root, hash });

    expect(result.relativeFile).toBe("src/Card.astro");
    expect(result.absoluteFile).toBe(file);
    expect(result.line).toBe(4);
    expect(result.source).toContain("<article>");
    expect(result.excerpt).toContain("4 | <article>");
  });

  it("rejects an unknown hash", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    await store.reset();

    await expect(
      resolveElementByHash({
        projectRoot: root,
        hash: "astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb"
      })
    ).rejects.toThrow("Unknown Astro element hash");
  });

  it("rejects a manifest path that escapes the project root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
    const outsideFile = path.join(outside, "Escape.astro");
    await writeFile(outsideFile, "<div>Escape</div>\n", "utf8");
    const hash = "astro_hash_cccccccccccccccccccccccc";
    const store = new ManifestStore(root);
    await store.reset();
    await store.upsert(hash, {
      file: path.relative(root, outsideFile),
      line: 1,
      column: 1,
      tag: "div"
    });

    await expect(
      resolveElementByHash({ projectRoot: root, hash })
    ).rejects.toThrow("Manifest entry escapes the Astro project");
  });
});
```

- [ ] **Step 2: Run the resolver tests and confirm failure**

Run:

```bash
npx vitest run tests/unit/resolve-element.test.ts
```

Expected: FAIL because `resolveElementByHash` does not exist.

- [ ] **Step 3: Implement canonical manifest and source reads**

Create `src/mcp/resolve-element.ts`:

```ts
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  MANIFEST_DIRECTORY,
  MANIFEST_FILENAME
} from "../shared/contracts.js";
import { LocatorManifestSchema } from "../manifest/schema.js";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024;

export interface ResolvedAstroElement {
  hash: string;
  relativeFile: string;
  absoluteFile: string;
  line: number;
  column: number;
  tag: string;
  excerpt: string;
  source: string;
}

interface ResolveElementOptions {
  projectRoot: string;
  hash: string;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function readLimitedFile(
  file: string,
  maximumBytes: number
): Promise<string> {
  const info = await stat(file);
  if (!info.isFile() || info.size > maximumBytes) {
    throw new Error("Locator file is missing or exceeds its size limit");
  }
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new Error("Locator file is missing or exceeds its size limit");
  }
  return text;
}

function createExcerpt(source: string, selectedLine: number): string {
  const lines = source.split(/\r?\n/u);
  const start = Math.max(0, selectedLine - 4);
  const end = Math.min(lines.length, selectedLine + 3);
  return lines
    .slice(start, end)
    .map((line, index) => `${start + index + 1} | ${line}`)
    .join("\n");
}

export async function resolveElementByHash(
  options: ResolveElementOptions
): Promise<ResolvedAstroElement> {
  if (!/^astro_hash_[a-f0-9]{24}$/u.test(options.hash)) {
    throw new Error("Invalid Astro element hash");
  }

  const projectRoot = await realpath(path.resolve(options.projectRoot));
  const manifestPath = path.join(
    projectRoot,
    MANIFEST_DIRECTORY,
    MANIFEST_FILENAME
  );
  const canonicalManifest = await realpath(manifestPath);
  if (!isInside(projectRoot, canonicalManifest)) {
    throw new Error("Locator manifest escapes the Astro project");
  }
  const manifest = LocatorManifestSchema.parse(
    JSON.parse(await readLimitedFile(canonicalManifest, MAX_MANIFEST_BYTES))
  );
  const entry = manifest.entries[options.hash];
  if (!entry) {
    throw new Error(`Unknown Astro element hash: ${options.hash}`);
  }

  const sourcePath = path.resolve(projectRoot, entry.file);
  const canonicalSource = await realpath(sourcePath);
  if (
    !isInside(projectRoot, canonicalSource) ||
    path.extname(canonicalSource).toLowerCase() !== ".astro"
  ) {
    throw new Error("Manifest entry escapes the Astro project");
  }
  const source = await readLimitedFile(canonicalSource, MAX_SOURCE_BYTES);
  const selectedLine = source.split(/\r?\n/u)[entry.line - 1];
  if (selectedLine === undefined || entry.column > selectedLine.length + 1) {
    throw new Error("Manifest location is outside the Astro source");
  }

  return {
    hash: options.hash,
    relativeFile: entry.file,
    absoluteFile: canonicalSource,
    line: entry.line,
    column: entry.column,
    tag: entry.tag,
    excerpt: createExcerpt(source, entry.line),
    source
  };
}
```

Run:

```bash
npx vitest run tests/unit/resolve-element.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 4: Register the MCP tool**

Create `src/mcp/server.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import { resolveElementByHash } from "./resolve-element.js";

interface McpServerOptions {
  projectRoot: string;
}

function toolError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const server = new McpServer({
    name: "astro-ai-locator",
    version: "0.1.0"
  });

  server.registerTool(
    "get_astro_element_by_hash",
    {
      title: "Resolve an Astro UI element",
      description:
        "Call this whenever the user provides an astro_hash_ value. Returns the exact Astro source file, line, column, tag, excerpt, and full source for that selected UI element.",
      inputSchema: {
        hash: z
          .string()
          .regex(/^astro_hash_[a-f0-9]{24}$/)
          .describe("The hash copied by Astro AI Locator")
      }
    },
    async ({ hash }): Promise<CallToolResult> => {
      try {
        const result = await resolveElementByHash({
          projectRoot: options.projectRoot,
          hash
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to resolve element";
        console.error("get_astro_element_by_hash failed:", message);
        return toolError(message);
      }
    }
  );

  return server;
}
```

- [ ] **Step 5: Implement the executable stdio entry**

Create `src/mcp/cli.ts`:

```ts
#!/usr/bin/env node

import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

function readProjectRoot(arguments_: string[]): string {
  const index = arguments_.indexOf("--project-root");
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(
      "Usage: astro-ai-locator-mcp --project-root <absolute-project-path>"
    );
  }
  if (!path.isAbsolute(value)) {
    throw new Error("--project-root must be an absolute path");
  }
  return value;
}

async function main(): Promise<void> {
  const configuredRoot = readProjectRoot(process.argv.slice(2));
  const projectRoot = await realpath(path.resolve(configuredRoot));
  if (!(await stat(projectRoot)).isDirectory()) {
    throw new Error("The MCP project root is not a directory");
  }
  const server = createMcpServer({ projectRoot });
  await server.connect(new StdioServerTransport());
  console.error(`astro-ai-locator MCP ready for ${projectRoot}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 6: Add a real stdio integration test**

Create `tests/integration/mcp-stdio.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { ManifestStore } from "../../src/manifest/store.js";

describe("stdio MCP server", () => {
  it("resolves a locator hash through the published CLI shape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const sourceFile = path.join(root, "src", "Card.astro");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "<article>Card</article>\n", "utf8");
    const hash = "astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa";
    const store = new ManifestStore(root);
    await store.reset();
    await store.upsert(hash, {
      file: "src/Card.astro",
      line: 1,
      column: 1,
      tag: "article"
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.resolve("dist/mcp/cli.js"),
        "--project-root",
        root
      ],
      stderr: "pipe"
    });
    const client = new Client({
      name: "astro-ai-locator-test",
      version: "0.1.0"
    });

    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "get_astro_element_by_hash",
        arguments: { hash }
      });
      const text = result.content.find(
        (item): item is { type: "text"; text: string } =>
          item.type === "text"
      );
      expect(text?.text).toContain('"relativeFile": "src/Card.astro"');
      expect(text?.text).toContain("<article>Card</article>");
    } finally {
      await client.close();
    }
  });
});
```

- [ ] **Step 7: Run MCP tests**

Run:

```bash
npm run build
npx vitest run tests/unit/resolve-element.test.ts
npm run test:integration
```

Expected: resolver tests and one stdio integration test pass. No JSON-RPC parse error appears.

- [ ] **Step 8: Commit after the repository boundary is safe**

Run:

```bash
if [ "$(git rev-parse --show-toplevel)" != "/Users/jungjun/astro-ai-locator" ]; then
  echo "Unsafe Git root; stop before staging." >&2
  exit 1
fi
git add src/mcp tests/unit/resolve-element.test.ts tests/integration/mcp-stdio.test.ts
git commit -m "feat: resolve astro locator hashes over mcp"
```

---

### Task 7: Verify HMR invalidation and the complete browser-to-MCP contract

**Files:**

- Modify: `tests/e2e/locator.spec.ts`
- Modify: `tests/unit/manifest-store.test.ts`
- Create: `tests/unit/vite-plugin.test.ts`
- Create: `tests/integration/production-output.test.ts`

**Interfaces:**

- Verifies: one source tag rendered twice produces one hash.
- Verifies: changing an `.astro` file invalidates every prior entry for that file.
- Verifies: the copied hash resolves through MCP to the same file and location.

- [ ] **Step 1: Add a repeated-render identity assertion**

Append to `tests/e2e/locator.spec.ts`:

```ts
test("repeated DOM instances from one source tag share one hash", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByTestId("card-alpha")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const first = await page.evaluate(() => navigator.clipboard.readText());
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByTestId("card-beta")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const second = await page.evaluate(() => navigator.clipboard.readText());

  expect(first).toBe(second);
});
```

- [ ] **Step 2: Add an explicit invalidation unit test**

Append to `tests/unit/manifest-store.test.ts`:

```ts
it("keeps entries for other Astro files during invalidation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
  const store = new ManifestStore(root);
  await store.reset();
  await store.upsert("astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa", {
    file: "src/Card.astro",
    line: 1,
    column: 1,
    tag: "article"
  });
  await store.upsert("astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb", {
    file: "src/Header.astro",
    line: 1,
    column: 1,
    tag: "header"
  });

  await store.removeByFile("src/Card.astro");

  expect(Object.keys((await store.readSnapshot()).entries)).toEqual([
    "astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb"
  ]);
});
```

- [ ] **Step 3: Exercise invalidation through the Vite plugin hook**

Create `tests/unit/vite-plugin.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HmrContext } from "vite";
import { describe, expect, it } from "vitest";
import { createLocatorVitePlugin } from "../../src/integration/vite-plugin.js";
import { ManifestStore } from "../../src/manifest/store.js";

describe("createLocatorVitePlugin", () => {
  it("invalidates only entries for the changed Astro file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const store = new ManifestStore(root);
    const plugin = createLocatorVitePlugin({
      root,
      sessionToken: "session-token",
      store
    });
    await store.reset();
    await store.upsert("astro_hash_aaaaaaaaaaaaaaaaaaaaaaaa", {
      file: "src/Card.astro",
      line: 1,
      column: 1,
      tag: "article"
    });
    await store.upsert("astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb", {
      file: "src/Header.astro",
      line: 1,
      column: 1,
      tag: "header"
    });

    const hook = plugin.handleHotUpdate;
    if (typeof hook !== "function") {
      throw new Error("Expected a callable handleHotUpdate hook");
    }
    await hook.call(
      {} as never,
      { file: path.join(root, "src", "Card.astro") } as HmrContext
    );

    expect(Object.keys((await store.readSnapshot()).entries)).toEqual([
      "astro_hash_bbbbbbbbbbbbbbbbbbbbbbbb"
    ]);
  });
});
```

- [ ] **Step 4: Add security-boundary regression tests**

In `tests/unit/request-handler.test.ts`, append:

```ts
it("rejects a request body larger than 8 KiB", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
  const store = new ManifestStore(root);
  await store.reset();
  const handler = createRegistrationHandler({
    root,
    sessionToken: "session-token",
    store
  });
  const recorder = responseRecorder();

  await handler(
    requestFor({
      sourceFile: "x".repeat(9 * 1024),
      line: 1,
      column: 1,
      tag: "div"
    }),
    recorder.response,
    vi.fn()
  );

  expect(recorder.response.statusCode).toBe(400);
});

it("rejects a source location outside the file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
  const source = path.join(root, "src", "Card.astro");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, "<article>Card</article>\n", "utf8");
  const store = new ManifestStore(root);
  await store.reset();
  const handler = createRegistrationHandler({
    root,
    sessionToken: "session-token",
    store
  });
  const recorder = responseRecorder();

  await handler(
    requestFor({
      sourceFile: source,
      line: 99,
      column: 1,
      tag: "article"
    }),
    recorder.response,
    vi.fn()
  );

  expect(recorder.response.statusCode).toBe(400);
});
```

In `tests/unit/resolve-element.test.ts`, add `symlink` to the filesystem
imports:

```ts
import {
  mkdir,
  mkdtemp,
  symlink,
  writeFile
} from "node:fs/promises";
```

Then append:

```ts
it.skipIf(process.platform === "win32")(
  "rejects a source symlink that escapes the project root",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
    const outsideFile = path.join(outside, "Escape.astro");
    await writeFile(outsideFile, "<div>Escape</div>\n", "utf8");
    const sourceDirectory = path.join(root, "src");
    await mkdir(sourceDirectory, { recursive: true });
    await symlink(outsideFile, path.join(sourceDirectory, "Linked.astro"));
    const hash = "astro_hash_dddddddddddddddddddddddd";
    const store = new ManifestStore(root);
    await store.reset();
    await store.upsert(hash, {
      file: "src/Linked.astro",
      line: 1,
      column: 1,
      tag: "div"
    });

    await expect(
      resolveElementByHash({ projectRoot: root, hash })
    ).rejects.toThrow("Manifest entry escapes the Astro project");
  }
);

it.skipIf(process.platform === "win32")(
  "rejects a manifest symlink that escapes the project root",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "outside-"));
    const outsideManifest = path.join(outside, "manifest.json");
    await writeFile(
      outsideManifest,
      '{"schemaVersion":1,"entries":{}}\n',
      "utf8"
    );
    const manifestDirectory = path.join(root, ".astro-ai-locator");
    await mkdir(manifestDirectory, { recursive: true });
    await symlink(
      outsideManifest,
      path.join(manifestDirectory, "manifest.json")
    );

    await expect(
      resolveElementByHash({
        projectRoot: root,
        hash: "astro_hash_ffffffffffffffffffffffff"
      })
    ).rejects.toThrow("Locator manifest escapes the Astro project");
  }
);

it("rejects an oversized Astro source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
  const source = path.join(root, "src", "Large.astro");
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, "x".repeat(512 * 1024 + 1), "utf8");
  const hash = "astro_hash_eeeeeeeeeeeeeeeeeeeeeeee";
  const store = new ManifestStore(root);
  await store.reset();
  await store.upsert(hash, {
    file: "src/Large.astro",
    line: 1,
    column: 1,
    tag: "div"
  });

  await expect(
    resolveElementByHash({ projectRoot: root, hash })
  ).rejects.toThrow("exceeds its size limit");
});

it("rejects a malformed manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "astro-locator-"));
  const store = new ManifestStore(root);
  await store.reset();
  await writeFile(store.manifestPath, "{}\n", "utf8");

  await expect(
    resolveElementByHash({
      projectRoot: root,
      hash: "astro_hash_ffffffffffffffffffffffff"
    })
  ).rejects.toThrow();
});
```

- [ ] **Step 5: Add the real browser-to-MCP round-trip test**

Add these imports to `tests/e2e/locator.spec.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
```

Then append:

```ts
test("the copied browser hash resolves to the same entry through MCP", async ({
  page
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page
    .getByTestId("card-alpha")
    .click({ modifiers: ["Alt"], position: { x: 4, y: 4 } });
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^astro_hash_[a-f0-9]{24}$/);
  const hash = await page.evaluate(() => navigator.clipboard.readText());
  const fixtureRoot = path.resolve("tests/fixtures/basic");
  const manifest = JSON.parse(
    await readFile(
      path.join(fixtureRoot, ".astro-ai-locator", "manifest.json"),
      "utf8"
    )
  ) as {
    entries: Record<
      string,
      { file: string; line: number; column: number; tag: string }
    >;
  };
  const expectedEntry = manifest.entries[hash];
  expect(expectedEntry).toBeDefined();
  if (!expectedEntry) {
    throw new Error(`Manifest entry was not written for ${hash}`);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve("dist/mcp/cli.js"),
      "--project-root",
      fixtureRoot
    ],
    stderr: "pipe"
  });
  const client = new Client({
    name: "astro-ai-locator-e2e",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "get_astro_element_by_hash",
      arguments: { hash }
    });
    const text = result.content.find(
      (item): item is { type: "text"; text: string } =>
        item.type === "text"
    );
    expect(text).toBeDefined();
    const resolved = JSON.parse(text?.text ?? "{}") as {
      hash: string;
      relativeFile: string;
      line: number;
      column: number;
      tag: string;
    };
    expect(resolved).toMatchObject({
      hash,
      relativeFile: expectedEntry.file,
      line: expectedEntry.line,
      column: expectedEntry.column,
      tag: expectedEntry.tag
    });
  } finally {
    await client.close();
  }
});
```

- [ ] **Step 6: Run focused contract tests**

Run:

```bash
npm test
npm run test:e2e
npm run test:integration
```

Expected:

- Twenty-two unit tests pass on macOS/Linux. The two symlink tests are skipped
  on Windows.
- Four locator browser tests pass.
- The stdio MCP test passes.

- [ ] **Step 7: Add an enforceable production-output test**

Create `tests/integration/production-output.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(target) : [target];
    })
  );
  return nested.flat();
}

describe("production output", () => {
  it("contains no Astro AI Locator runtime", async () => {
    const output = path.resolve("tests/fixtures/basic/dist");
    const files = await listFiles(output);
    const textFiles = files.filter((file) =>
      /\.(?:html|js|css)$/u.test(file)
    );
    const combined = (
      await Promise.all(textFiles.map((file) => readFile(file, "utf8")))
    ).join("\n");

    expect(combined).not.toMatch(
      /astro-ai-locator\/client|_astro-ai-locator\/register|data-astro-ai-locator/u
    );
  });
});
```

Run:

```bash
npm run test:production
```

Expected: the Astro production build succeeds and one production-output test passes.

- [ ] **Step 8: Run coverage and inspect security-critical gaps**

Run:

```bash
npm run test:coverage
```

Expected:

- Global thresholds pass.
- `src/manifest/store.ts`, `src/integration/request-handler.ts`, and `src/mcp/resolve-element.ts` each have exercised success and rejection paths.

- [ ] **Step 9: Commit after the repository boundary is safe**

Run:

```bash
if [ "$(git rev-parse --show-toplevel)" != "/Users/jungjun/astro-ai-locator" ]; then
  echo "Unsafe Git root; stop before staging." >&2
  exit 1
fi
git add tests
git commit -m "test: cover locator identity and invalidation"
```

---

### Task 8: Document installation, MCP configuration, limitations, and package contents

**Files:**

- Create: `README.md`
- Modify: `package.json`
- Create: `tests/fixtures/packed/package.json`
- Create: `tests/fixtures/packed/astro.config.mjs`
- Create: `tests/fixtures/packed/src/pages/index.astro`
- Create: `tests/fixtures/packed/smoke-exports.mjs`

**Interfaces:**

- Documents: npm installation, Astro Integration setup, modifier behavior, generic stdio MCP configuration, tool contract, manifest location, and MVP limitations.
- Verifies: the npm tarball contains only intended runtime files and works
  when installed into an isolated Astro consumer.

- [ ] **Step 1: Write the user README**

Create `README.md` with these exact sections and examples:

````markdown
# astro-ai-locator

Select an Astro-rendered UI element in development, copy its hash, and resolve
that hash to source code through MCP.

## Install

```bash
npm install --save-dev astro-ai-locator
```

## Astro setup

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import { astroAiLocator } from "astro-ai-locator";

export default defineConfig({
  integrations: [astroAiLocator()]
});
```

Run `astro dev`, hold `Alt` (`Option` on macOS), hover an element, and click.
The copied value has the form `astro_hash_0123456789abcdef01234567`.

## MCP setup

Register this local stdio command in your MCP host:

```json
{
  "command": "npx",
  "args": [
    "--no-install",
    "astro-ai-locator-mcp",
    "--project-root",
    "/absolute/path/to/your/astro-project"
  ]
}
```

When a prompt contains an `astro_hash_` value, the model can call
`get_astro_element_by_hash` to retrieve the `.astro` file, line, column, tag,
excerpt, and full source.

## Runtime files

The development server writes `.astro-ai-locator/manifest.json`. Add
`.astro-ai-locator/` to the consuming project’s `.gitignore`.

## Scope

- Development mode only.
- Astro’s development source metadata must remain enabled.
- No browser extension.
- No editor-specific deep links.
- Native HTML rendered from `.astro` templates.
- DOM created inside hydrated framework islands is not resolved in version 0.1.
- One Astro development server per project directory.

## Security

The development endpoint uses a per-process token and accepts only validated
`.astro` files inside the configured project root. The MCP server also
canonicalizes manifest paths before reading source.
````

- [ ] **Step 2: Create an isolated packed-package consumer fixture**

Create `tests/fixtures/packed/package.json`:

```json
{
  "name": "astro-ai-locator-packed-smoke",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "astro build",
    "smoke:exports": "node smoke-exports.mjs"
  },
  "dependencies": {
    "astro": "^7.1.3"
  }
}
```

Create `tests/fixtures/packed/astro.config.mjs`:

```js
import { defineConfig } from "astro/config";
import { astroAiLocator } from "astro-ai-locator";

export default defineConfig({
  integrations: [astroAiLocator()]
});
```

Create `tests/fixtures/packed/src/pages/index.astro`:

```astro
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Packed package smoke test</title>
  </head>
  <body>
    <main>Packed package smoke test</main>
  </body>
</html>
```

Create `tests/fixtures/packed/smoke-exports.mjs`:

```js
import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { astroAiLocator } from "astro-ai-locator";
import { installLocator } from "astro-ai-locator/client";

if (typeof astroAiLocator !== "function" || typeof installLocator !== "function") {
  throw new Error("Packed root or client export did not resolve");
}

const executableName =
  process.platform === "win32"
    ? "astro-ai-locator-mcp.cmd"
    : "astro-ai-locator-mcp";
const executable = new URL(`./node_modules/.bin/${executableName}`, import.meta.url);
await access(
  executable,
  process.platform === "win32" ? constants.F_OK : constants.X_OK
);

if (process.platform !== "win32") {
  const target = await realpath(executable);
  const firstLine = (await readFile(target, "utf8")).split(/\r?\n/u)[0];
  if (firstLine !== "#!/usr/bin/env node") {
    throw new Error(`Packed CLI shebang is invalid: ${firstLine}`);
  }
}

console.log("packed exports and CLI resolved");
```

- [ ] **Step 3: Run the complete verification suite**

Run:

```bash
npm run verify
```

Expected:

- TypeScript check passes.
- Unit, stdio integration, and Chromium E2E tests pass.
- `dist/index.js`, `dist/client/index.js`, and `dist/mcp/cli.js` exist.

- [ ] **Step 4: Verify the CLI shebang and executable package entry**

Run:

```bash
head -n 1 dist/mcp/cli.js
node dist/mcp/cli.js
```

Expected:

```text
#!/usr/bin/env node
Usage: astro-ai-locator-mcp --project-root <absolute-project-path>
```

The second command exits non-zero and prints the usage message to stderr.

- [ ] **Step 5: Inspect the npm tarball**

Run:

```bash
npm pack --dry-run
```

Expected tarball contents:

- `package.json`
- `README.md`
- `dist/index.js` and declarations/maps
- `dist/client/`
- `dist/integration/`
- `dist/manifest/`
- `dist/mcp/`
- `dist/shared/`

The tarball must not include `tests/`, `.astro-ai-locator/`, `work/`, or source fixture files.

- [ ] **Step 6: Install the actual tarball in an isolated Astro consumer**

Run:

```bash
smoke_root="$(mktemp -d)"
smoke_tarball="$smoke_root/astro-ai-locator-0.1.0.tgz"
smoke_consumer="$smoke_root/consumer"
npm pack --pack-destination "$smoke_root"
cp -R tests/fixtures/packed "$smoke_consumer"
npm --prefix "$smoke_consumer" install "$smoke_tarball"
npm --prefix "$smoke_consumer" run build
npm --prefix "$smoke_consumer" run smoke:exports
```

Expected:

- The isolated Astro production build exits with code 0.
- `packed exports and CLI resolved` is printed.
- The installed root export, client subpath, and CLI binary all resolve from
  the `.tgz`, not from this repository.

- [ ] **Step 7: Check package-name availability immediately before publication**

Run:

```bash
npm view astro-ai-locator name version
```

Expected:

- If npm returns `E404`, the name is available at that moment.
- If npm returns package metadata, choose a scoped name before publishing and update `name`, self-imports, README commands, and tests together.

- [ ] **Step 8: Commit after the repository boundary is safe**

Run:

```bash
if [ "$(git rev-parse --show-toplevel)" != "/Users/jungjun/astro-ai-locator" ]; then
  echo "Unsafe Git root; stop before staging." >&2
  exit 1
fi
git add README.md package.json package-lock.json tests/fixtures/packed
git commit -m "docs: add astro ai locator setup and constraints"
```

## Sidechat용 개념 학습 프롬프트

아래 프롬프트는 구현을 맡은 메인 작업과 분리해서, Codex sidechat에서
개념만 학습할 때 그대로 붙여 넣는다.

```text
나는 주니어 프론트엔드 엔지니어이고 Astro AI Locator라는 주말 MVP를
만들고 있다. 이 대화에서는 저장소 파일을 수정하거나 완성 코드를 대신
작성하지 말고, 내 메인 구현을 이해할 수 있도록 튜터 역할만 해줘.

프로젝트의 사용자 흐름은 다음과 같다.
1. Astro 개발 서버의 페이지에서 Alt/Option을 누르면 소스 위치가 있는
   요소들의 경계가 보인다.
2. 요소를 클릭하면 브라우저 클라이언트가 Astro/Vite 개발 서버의 로컬
   endpoint에 source file, line, column, tag를 보낸다.
3. 서버는 결정적 hash를 만들고 JSON manifest에 저장한 뒤 브라우저에
   돌려준다.
4. 브라우저는 hash를 clipboard에 복사한다.
5. 사용자가 그 hash를 MCP가 연결된 CLI/ACP에 붙여 넣으면 stdio MCP
   server의 get_astro_element_by_hash tool이 manifest를 조회해 실제
   .astro 파일과 코드를 반환한다.

다음 순서로 한 번에 한 주제씩 설명해줘.
1. 전체 데이터 흐름과 각 프로세스의 경계
2. Vite가 단순한 “JS 파서”가 아니라 개발 서버·모듈 그래프·빌드 도구인
   이유, 그리고 configureServer/handleHotUpdate/plugin hook의 역할
3. Astro Integration이 Vite plugin과 browser script를 연결하는 방식,
   그리고 Vite load hook에서 compiler AST로 원본 태그를 찾는 이유
4. 패키지가 주입한 DOM source metadata, event capture, Alt 상태,
   overlay, Clipboard API
5. 결정적 hash와 manifest가 필요한 이유 및 HMR invalidation
6. MCP의 host/client/server/transport/tool 개념과 stdio JSON-RPC 흐름
7. project root, realpath, symlink escape, stdout 오염 같은 보안 포인트
8. 이 구조의 한계: framework island 내부 DOM, clipboard 권한, Astro
   compiler AST 버전 호환성

각 주제마다:
- 먼저 쉬운 비유를 한 번만 사용하고,
- 그다음 이 프로젝트의 실제 파일/데이터 흐름에 연결하고,
- 핵심 용어 3개를 짧게 정의하고,
- 마지막에 내가 이해했는지 확인하는 질문 1개를 해줘.

내 답이 틀리면 바로 정답만 말하지 말고, 어느 프로세스에서 어떤 데이터가
이동하는지 다시 추적하게 힌트를 줘. 먼저 1번 주제부터 시작해줘.
```

## Final Acceptance Checklist

- [ ] `Alt/Option` activation adds subtle boundaries without changing layout.
- [ ] Gate A proves that two repeated fixture articles share one valid
  `Card.astro` source identity.
- [ ] The current source-backed element has a strong overlay and readable label.
- [ ] Releasing `Alt/Option`, window blur, and click completion remove the active UI.
- [ ] Normal clicks remain untouched.
- [ ] `Alt/Option + Click` blocks navigation and application click handlers only when a valid Astro source target exists.
- [ ] A successful click copies exactly one `astro_hash_[a-f0-9]{24}` value.
- [ ] The manifest is valid, sorted, versioned JSON written atomically.
- [ ] An `.astro` HMR event invalidates old entries for that file.
- [ ] The MCP tool resolves the copied hash to the same source file and position.
- [ ] Unknown hashes, malformed manifests, traversal, symlink escapes, and oversized files fail safely.
- [ ] MCP stdout contains only protocol traffic.
- [ ] Production build and preview contain no locator client or endpoint.
- [ ] `npm pack --dry-run` contains only publishable runtime assets.
- [ ] The actual `.tgz` builds in an isolated Astro consumer and resolves the
  root export, client subpath, and CLI binary.
- [ ] The Git repository boundary is corrected before any commit.

## References

- [Astro Integration API](https://docs.astro.build/en/reference/integrations-reference/)
- [Astro development with AI tools](https://docs.astro.build/en/guides/build-with-ai/)
- [Vite Plugin API](https://vite.dev/guide/api-plugin.html)
- [Vite JavaScript API](https://vite.dev/guide/api-javascript.html)
- [MCP TypeScript SDK v1 server guide](https://ts.sdk.modelcontextprotocol.io/server)
- [Vitest configuration](https://vitest.dev/config/)
- [Playwright web server configuration](https://playwright.dev/docs/test-webserver)
- [TypeScript modules reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
