import { randomInt } from "node:crypto";
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
 * The manifest only grows while a dev server lives; `reset()` runs once at
 * startup. Cap it so a long clicking session cannot grow the file — and the
 * full re-serialization on every click — without bound.
 */
const MAX_ENTRIES = 100;
const EVICT_COUNT = 50;
export const TOKEN_CAPACITY = 36 ** 3;

interface ManifestStoreOptions {
  /** Test override. Production uses a random session start (cross-project salt). */
  startIndex?: number;
  /** Test override for exhaustion behaviour. */
  capacity?: number;
}

function identityOf(entry: LocatorManifestEntry): string {
  return [
    entry.file,
    String(entry.line),
    String(entry.column),
    entry.domTag
  ].join("\0");
}

export class ManifestStore {
  readonly manifestPath: string;
  private entries = new Map<string, LocatorManifestEntry>();
  private tokensByIdentity = new Map<string, string>();
  private nextIndex: number;
  private issuedCount = 0;
  private readonly capacity: number;
  private writeQueue: Promise<void> = Promise.resolve();
  private writeSequence = 0;

  constructor(root: string, options: ManifestStoreOptions = {}) {
    this.manifestPath = path.join(root, MANIFEST_DIRECTORY, MANIFEST_FILENAME);
    this.capacity = options.capacity ?? TOKEN_CAPACITY;
    // The random start doubles as a session salt: another project's token is
    // unlikely to be a live number here, so cross-project pastes fail loudly.
    this.nextIndex = options.startIndex ?? randomInt(this.capacity);
  }

  async reset(): Promise<void> {
    this.entries.clear();
    this.tokensByIdentity.clear();
    await this.persist();
  }

  /**
   * Returns the existing token when the same element is clicked again, so a
   * re-click never burns a fresh number. Numbers are never reused: an evicted
   * element gets a new token, and exhaustion throws instead of wrapping onto
   * numbers that may still be on someone's clipboard.
   */
  async issue(entry: LocatorManifestEntry): Promise<string> {
    const identity = identityOf(entry);
    const existing = this.tokensByIdentity.get(identity);
    if (existing !== undefined) {
      // `Map.set` keeps an existing key in place, so delete first to move a
      // re-clicked token to the back, away from eviction.
      this.entries.delete(existing);
      this.entries.set(existing, entry);
      await this.persist();
      return existing;
    }
    if (this.issuedCount >= this.capacity) {
      throw new Error(
        "Locator token space is exhausted for this session; restart astro dev"
      );
    }
    const token = `${TOKEN_PREFIX}${this.nextIndex
      .toString(36)
      .padStart(3, "0")}`;
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
    this.issuedCount += 1;
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
