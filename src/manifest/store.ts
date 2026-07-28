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

  constructor(root: string) {
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
