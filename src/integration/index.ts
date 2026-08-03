import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import {
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
          "page",
          [
            'import { installLocator } from "astro-inspector/client";',
            `installLocator(${JSON.stringify(clientOptions)});`
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
