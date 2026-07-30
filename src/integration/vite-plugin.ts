import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  TraceMap,
  originalPositionFor,
  type SourceMapInput
} from "@jridgewell/trace-mapping";
import { searchForWorkspaceRoot, type Plugin } from "vite";
import {
  normalizeRelativeFile,
  toProjectRelativeFile
} from "../manifest/hash.js";
import { ManifestStore } from "../manifest/store.js";
import { LocatorSettingsStore } from "../settings/store.js";
import {
  LOCATOR_ENDPOINT,
  LOCATOR_SETTINGS_ENDPOINT,
  MANIFEST_DIRECTORY
} from "../shared/contracts.js";
import { injectAstroSourceMetadata } from "./inject-source-metadata.js";
import {
  injectJsxSourceMetadata,
  type SourcePositionMapper
} from "./inject-jsx-source-metadata.js";
import { createRegistrationHandler } from "./request-handler.js";
import { createSettingsHandler } from "./settings-handler.js";

interface LocatorVitePluginOptions {
  root: string;
  sessionToken: string;
  store?: ManifestStore;
  settingsStore?: LocatorSettingsStore;
}

const SOURCE_EXTENSIONS = new Set([".astro", ".jsx", ".tsx"]);

function isSourceFile(file: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function createSourcePositionMapper(
  combinedMap: unknown
): SourcePositionMapper | undefined {
  if (
    !combinedMap ||
    typeof combinedMap !== "object" ||
    !("mappings" in combinedMap) ||
    typeof combinedMap.mappings !== "string" ||
    combinedMap.mappings.length === 0
  ) {
    return undefined;
  }
  let traceMap: TraceMap;
  try {
    traceMap = new TraceMap(combinedMap as SourceMapInput);
  } catch {
    return undefined;
  }

  return ({ line, column }) => {
    const original = originalPositionFor(traceMap, {
      line,
      column: column - 1
    });
    if (
      original.source === null ||
      original.line === null ||
      original.column === null
    ) {
      return null;
    }
    return {
      line: original.line,
      column: original.column + 1
    };
  };
}

export function createLocatorVitePlugin(
  options: LocatorVitePluginOptions
): Plugin {
  const configuredRoot = path.resolve(options.root);
  const root = realpathSync(configuredRoot);
  const workspaceRoot = searchForWorkspaceRoot(configuredRoot);
  const store = options.store ?? new ManifestStore(root);
  const configuredSettingsPath =
    process.env.ASTRO_AI_LOCATOR_SETTINGS_PATH;
  const settingsStore =
    options.settingsStore ??
    (configuredSettingsPath
      ? new LocatorSettingsStore(configuredSettingsPath)
      : new LocatorSettingsStore());
  const manifestDirectories = [
    path.join(configuredRoot, MANIFEST_DIRECTORY),
    path.join(root, MANIFEST_DIRECTORY)
  ];
  const ignoreManifestArtifacts = (file: string) => {
    const absoluteFile = path.isAbsolute(file)
      ? path.resolve(file)
      : path.resolve(configuredRoot, file);
    return manifestDirectories.some((directory) => {
      const relative = path.relative(directory, absoluteFile);
      return (
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))
      );
    });
  };
  const ready = store.reset();
  const registrationHandler = createRegistrationHandler({
    root,
    workspaceRoot,
    sessionToken: options.sessionToken,
    store
  });
  const settingsHandler = createSettingsHandler({
    sessionToken: options.sessionToken,
    store: settingsStore
  });
  const toRelativeProjectFile = (file: string) => {
    const absoluteFile = path.resolve(file);
    for (const base of [configuredRoot, root]) {
      const relative = path.relative(base, absoluteFile);
      if (
        relative === "" ||
        (relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative))
      ) {
        return normalizeRelativeFile(relative);
      }
    }
    return toProjectRelativeFile(root, absoluteFile);
  };

  return {
    name: "astro-inspector:dev",
    enforce: "pre",
    apply: "serve",
    config() {
      return {
        server: {
          watch: {
            ignored: ignoreManifestArtifacts
          }
        }
      };
    },
    async load(id) {
      const file = id.split("?", 1)[0];
      if (!file || path.extname(file).toLowerCase() !== ".astro") {
        return null;
      }
      this.addWatchFile(file);
      const code = await readFile(file, "utf8");
      return injectAstroSourceMetadata(code, file, configuredRoot);
    },
    async transform(code, id) {
      const file = id.split("?", 1)[0];
      if (!file || !isSourceFile(file)) {
        return null;
      }
      const getCombinedSourcemap = this.getCombinedSourcemap;
      const mapPosition =
        typeof getCombinedSourcemap === "function"
          ? createSourcePositionMapper(getCombinedSourcemap.call(this))
          : undefined;
      const originalSource = await readFile(file, "utf8").catch(() => undefined);
      const sourceIsOriginal = originalSource === code;

      return injectJsxSourceMetadata(
        code,
        file,
        configuredRoot,
        sourceIsOriginal ? undefined : mapPosition,
        sourceIsOriginal ? undefined : originalSource
      );
    },
    configureServer(server) {
      server.middlewares.use(LOCATOR_ENDPOINT, (request, response, next) => {
        void ready
          .then(() => registrationHandler(request, response, next))
          .catch(next);
      });
      server.middlewares.use(
        LOCATOR_SETTINGS_ENDPOINT,
        (request, response, next) => {
          void settingsHandler(request, response, next).catch(next);
        }
      );

      const removeUnlinkedFile = (file: string) => {
        if (!isSourceFile(file)) {
          return;
        }
        void ready
          .then(() => store.removeByFile(toRelativeProjectFile(file)))
          .catch((error: unknown) => {
            server.config.logger.error(
              `astro-inspector unlink cleanup failed: ${
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
      if (isSourceFile(context.file)) {
        await ready;
        await store.removeByFile(toRelativeProjectFile(context.file));
      }
    }
  };
}
