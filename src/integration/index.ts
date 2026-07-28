import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import {
  LOCATOR_ENDPOINT,
  LOCATOR_SETTINGS_ENDPOINT
} from "../shared/contracts.js";
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
          settingsEndpoint: LOCATOR_SETTINGS_ENDPOINT,
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
