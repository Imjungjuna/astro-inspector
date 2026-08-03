import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { astroAiLocator } from "../../../dist/index.js";
import { ssrShiftPlugin } from "./ssr-shift-plugin.mjs";

export default defineConfig({
  integrations: [react(), astroAiLocator()],
  vite: {
    plugins: [ssrShiftPlugin()]
  }
});
