import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MANIFEST_DIRECTORY,
  MANIFEST_FILENAME,
  TOKEN_PREFIX,
  type LocatorManifest,
  type LocatorManifestEntry
} from "../shared/contracts.js";
import { LocatorManifestSchema } from "./schema.js";

/**
 * Manifest grows only while the dev server lives; eviction runs once at startup
 * per entry. Cap it so a long clicking session cannot grow the file without bound.
 */
const MAX_ENTRIES = 100;
const EVICT_COUNT = 50;

interface ManifestStoreOptions {
  /** Test override for token generation (hash base for testing). */
  hashSalt?: string;
}

function identityOf(entry: LocatorManifestEntry): string {
  return [
    entry.file,
    String(entry.line),
    String(entry.column),
    entry.sourceTag
  ].join("\0");
}

async function hashToToken(identity: string): Promise<string> {
  const buffer = new TextEncoder().encode(identity);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const view = new DataView(digest);
  const uint32 = view.getUint32(0);
  const base36 = uint32.toString(36).padStart(3, "0").slice(-3);
  return `${TOKEN_PREFIX}${base36}`;
}

export class ManifestStore {
  readonly manifestPath: string;
  private entries = new Map<string, LocatorManifestEntry>();
  private tokensByIdentity = new Map<string, string>();
  private writeQueue: Promise<void> = Promise.resolve();
  private writeSequence = 0;

  constructor(root: string, options: ManifestStoreOptions = {}) {
    this.manifestPath = path.join(root, MANIFEST_DIRECTORY, MANIFEST_FILENAME);
  }

  async reset(): Promise<void> {
    this.entries.clear();
    this.tokensByIdentity.clear();
    await this.persist();
  }

  /**
   * Returns the same token for the same element (file+line+column+sourceTag).
   * Deterministic hash means no collisions within a session, and no exhaustion.
   * The token is stable across page reloads as long as the source doesn't move.
   */
  async issue(entry: LocatorManifestEntry): Promise<string> {
    const identity = identityOf(entry);
    const existing = this.tokensByIdentity.get(identity);
    if (existing !== undefined) {
      // Move to the end to keep frequently-clicked elements away from eviction.
      this.entries.delete(existing);
      this.entries.set(existing, entry);
      await this.persist();
      return existing;
    }
    const token = await hashToToken(identity);
    this.entries.set(token, entry);
    this.tokensByIdentity.set(identity, token);
    if (this.entries.size > MAX_ENTRIES) {
      for (const oldest of [...this.entries.keys()].slice(0, EVICT_COUNT)) {
        this.entries.delete(oldest);
      }
      this.pruneIdentities();
    }
    await this.persist();
    return token;
  }

  async removeByFile(file: string): Promise<void> {
    let changed = false;
    for (const [token, entry] of this.entries) {
      if (entry.file === file) {
        this.entries.delete(token);
        changed = true;
      }
    }
    if (changed) {
      this.pruneIdentities();
      await this.persist();
    }
  }

  async readSnapshot(): Promise<LocatorManifest> {
    const raw = await readFile(this.manifestPath, "utf8");
    return LocatorManifestSchema.parse(JSON.parse(raw));
  }

  /** Drops reverse-index rows whose token no longer lives in the manifest. */
  private pruneIdentities(): void {
    for (const [identity, token] of this.tokensByIdentity) {
      if (!this.entries.has(token)) {
        this.tokensByIdentity.delete(identity);
      }
    }
  }

  private persist(): Promise<void> {
    const snapshot: LocatorManifest = {
      schemaVersion: 2,
      entries: Object.fromEntries(
        [...this.entries.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        )
      )
    };

    this.writeQueue = this.writeQueue.then(async () => {
      const directory = path.dirname(this.manifestPath);
      await mkdir(directory, { recursive: true });
      const temporaryPath =
        `${this.manifestPath}.${process.pid}.${this.writeSequence++}.tmp`;
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
