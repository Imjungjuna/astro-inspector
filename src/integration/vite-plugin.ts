import { realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { searchForWorkspaceRoot, type Plugin, type ViteDevServer } from "vite";
import {
  normalizeRelativeFile,
  toProjectRelativeFile
} from "../manifest/paths.js";
import { ManifestStore } from "../manifest/store.js";
import { LocatorSettingsStore } from "../settings/store.js";
import {
  LOCATOR_ASSET_ENDPOINT,
  LOCATOR_ENDPOINT,
  LOCATOR_SESSION_ENDPOINT,
  LOCATOR_SETTINGS_ENDPOINT,
  MANIFEST_DIRECTORY
} from "../shared/contracts.js";
import { createClientAssetHandler } from "./client-asset-handler.js";
import { injectAstroSourceMetadata } from "./inject-source-metadata.js";
import { injectJsxSourceMetadata } from "./inject-jsx-source-metadata.js";
import { createRegistrationHandler } from "./request-handler.js";
import { createSessionHandler } from "./session-handler.js";
import { createSessionState, type LocatorSessionStateStore } from "./session-state.js";
import { createSettingsHandler } from "./settings-handler.js";

const MCP_BIN_NAME = "astro-inspector-mcp";

/**
 * npm workspaces hoist bins to the workspace root while pnpm keeps them in the
 * package, so both are checked before falling back to `npx`.
 */
export function resolveMcpCommand(
  projectRoot: string,
  workspaceRoot: string
): { mcpCommand: string; mcpArgs: string[] } {
  for (const base of new Set([projectRoot, workspaceRoot])) {
    const candidate = path.join(base, "node_modules", ".bin", MCP_BIN_NAME);
    try {
      if (statSync(candidate).isFile()) {
        return {
          mcpCommand: candidate,
          mcpArgs: ["--project-root", projectRoot]
        };
      }
    } catch {
      // Missing bin directories are expected; try the next base.
    }
  }
  return {
    mcpCommand: "npx",
    mcpArgs: ["--no-install", MCP_BIN_NAME, "--project-root", projectRoot]
  };
}

interface LocatorVitePluginOptions {
  root: string;
  sessionToken: string;
  store?: ManifestStore;
  settingsStore?: LocatorSettingsStore;
  session?: LocatorSessionStateStore;
}

const SOURCE_EXTENSIONS = new Set([".astro", ".jsx", ".tsx"]);

function isSourceFile(file: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/**
 * Quit 시점에 이미 변환돼 캐시된 모듈을 그래프에서 떨어뜨린다. HMR 업데이트는
 * 보내지 않는다 — 버튼 하나 눌렀다고 열려 있는 탭이 full reload 되면 폼 입력과
 * 스크롤이 날아간다. 현재 탭은 그대로 두고 다음 요청부터 깨끗해진다.
 * Vite 8 은 모듈 그래프가 환경별로 갈라져 있어 둘 다 훑는다.
 */
function invalidateInjectedModules(
  server: ViteDevServer,
  isInjectedFile: (file: string) => boolean
): void {
  // 환경별 그래프와 구형 단일 그래프는 모듈 타입이 서로 달라, 하나의 배열로
  // 합치면 TS 가 두 타입의 교집합을 요구한다(exactOptionalPropertyTypes). 제네릭
  // 헬퍼로 그래프마다 따로 호출해 타입을 섞지 않는다.
  function invalidateGraph<Module extends { file?: string | null }>(
    graph: {
      idToModuleMap: Map<string, Module>;
      invalidateModule: (module: Module) => void;
    }
  ): void {
    for (const module of graph.idToModuleMap.values()) {
      if (module.file && isInjectedFile(module.file)) {
        graph.invalidateModule(module);
      }
    }
  }

  if (server.environments) {
    for (const environment of Object.values(server.environments)) {
      if (environment.moduleGraph) {
        invalidateGraph(environment.moduleGraph);
      }
    }
  } else if (server.moduleGraph) {
    invalidateGraph(server.moduleGraph);
  }
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
  const session = options.session ?? createSessionState();
  const sessionHandler = createSessionHandler({
    ...resolveMcpCommand(configuredRoot, workspaceRoot),
    sessionToken: options.sessionToken,
    state: session
  });
  // dist/integration/vite-plugin.js 기준 한 단계 위가 dist 루트다.
  const distDirectory = fileURLToPath(new URL("..", import.meta.url));
  const clientAssetHandler = createClientAssetHandler({ distDirectory });
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
    // Injection happens in `load`, not `transform`: `load` only ever sees the
    // file on disk, so the SSR and client pipelines start from the same string
    // and later transforms cannot shift the coordinates already baked in.
    async load(id) {
      // Quit 이후에는 원본을 그대로 서빙한다.
      if (session.isDisabled()) {
        return null;
      }
      // `?raw`, `?url` and friends still end in a source extension but must be
      // served verbatim.
      if (id.includes("?")) {
        return null;
      }
      const file = id.split("?", 1)[0];
      if (!file || !isSourceFile(file)) {
        return null;
      }
      this.addWatchFile(file);
      const code = await readFile(file, "utf8").catch(() => undefined);
      if (code === undefined) {
        return null;
      }
      return path.extname(file).toLowerCase() === ".astro"
        ? injectAstroSourceMetadata(code, file, configuredRoot)
        : injectJsxSourceMetadata(code, file, configuredRoot);
    },
    configureServer(server) {
      server.middlewares.use(LOCATOR_ENDPOINT, (request, response, next) => {
        if (session.isDisabled()) {
          response.statusCode = 410;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.end(
            JSON.stringify({ error: "Locator is closed for this dev server" })
          );
          return;
        }
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
      server.middlewares.use(
        LOCATOR_SESSION_ENDPOINT,
        (request, response, next) => {
          void sessionHandler(request, response, next).catch(next);
        }
      );
      server.middlewares.use(
        LOCATOR_ASSET_ENDPOINT,
        (request, response, next) => {
          void clientAssetHandler(request, response, next).catch(next);
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

      const isInjectedFile = (file: string) => {
        if (!isSourceFile(file)) {
          return false;
        }
        const absoluteFile = path.resolve(file);
        return [configuredRoot, root].some((base) => {
          const relative = path.relative(base, absoluteFile);
          return (
            relative !== "" &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
          );
        });
      };

      session.onDisable(() => {
        server.watcher.off("unlink", removeUnlinkedFile);
        invalidateInjectedModules(server, isInjectedFile);
      });

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
