import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import {
  LOCATOR_ASSET_ENDPOINT,
  LOCATOR_ENDPOINT,
  LOCATOR_SESSION_ENDPOINT,
  LOCATOR_SETTINGS_ENDPOINT
} from "../shared/contracts.js";
import { createLocatorVitePlugin } from "./vite-plugin.js";

export interface AstroInspectorOptions {
  showAllBoundaries?: boolean;
}

export function astroInspector(
  options: AstroInspectorOptions = {}
): AstroIntegration {
  return {
    name: "astro-inspector",
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
          settingsEndpoint: LOCATOR_SETTINGS_ENDPOINT,
          sessionEndpoint: LOCATOR_SESSION_ENDPOINT,
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
          "head-inline",
          [
            `import("${LOCATOR_ASSET_ENDPOINT}/client/index.js")`,
            `  .then(({ installLocator }) => installLocator(${JSON.stringify(clientOptions)}))`,
            `  .catch((error) => console.error("astro-inspector: client failed to load", error));`
          ].join("\n")
        );
      }
    }
  };
}

/** @deprecated Use `astroInspector` instead. */
export const astroAiLocator = astroInspector;

/** @deprecated Use `AstroInspectorOptions` instead. */
export type AstroAiLocatorOptions = AstroInspectorOptions;
