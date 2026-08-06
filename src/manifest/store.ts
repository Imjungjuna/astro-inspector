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
    entry.sourceTag,
    // 인스턴스가 없는 요소는 예전과 같은 신원을 유지해야 하므로 0 으로 채운다.
    String(entry.instance ?? 0)
  ].join("\0");
}

export async function hashToToken(identity: string): Promise<string> {
  const buffer = new TextEncoder().encode(identity);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const view = new DataView(digest);
  const uint32 = view.getUint32(0);
  const base36 = uint32.toString(36).padStart(3, "0").slice(-3);
  return `${TOKEN_PREFIX}${base36}`;
}

/**
 * 토큰은 base36 3자, 즉 46,656개뿐이다. 캡(100개)까지 채우면 생일 문제로 서로 다른
 * 요소가 같은 토큰으로 떨어질 확률이 10%에 이른다. 그때 그냥 덮어쓰면 앞 토큰이
 * 조용히 **다른 요소의 위치**를 답하게 되고, MCP 의 태그 재검증도 이걸 못 잡는다.
 * 나중 엔트리는 자기 위치에서 정합하기 때문이다.
 *
 * 그래서 이미 쓰이는 토큰이면 신원에 시도 횟수를 섞어 다시 해시한다. 같은 요소를
 * 다시 클릭하면 `tokensByIdentity` 가 먼저 답하므로 탐사 결과는 그대로 유지된다.
 */
const MAX_TOKEN_ATTEMPTS = 64;

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
   * Returns the same token for the same element
   * (file+line+column+sourceTag+instance).
   * The token is stable across page reloads as long as the source doesn't move.
   * Different elements always get different tokens — see `MAX_TOKEN_ATTEMPTS`.
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
    const token = await this.issueUnusedToken(identity);
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

  /**
   * 비어 있는 토큰을 찾을 때까지 신원에 시도 횟수를 섞어 다시 해시한다.
   * 캡이 100개고 공간이 46,656개라 두 번째 시도에서 거의 항상 끝난다.
   * 그래도 못 찾으면 조용히 덮어쓰는 대신 던진다 — 등록 핸들러가 400 으로 바꿔
   * 클라이언트가 토스트를 띄우므로, 틀린 위치를 답하는 것보다 눈에 띄게 실패한다.
   */
  private async issueUnusedToken(identity: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt += 1) {
      const candidate = await hashToToken(
        attempt === 0 ? identity : `${identity}\0${attempt}`
      );
      if (!this.entries.has(candidate)) {
        return candidate;
      }
    }
    throw new Error(
      "Locator token space is exhausted; restart the dev server to reset the manifest"
    );
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
      schemaVersion: 3,
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
