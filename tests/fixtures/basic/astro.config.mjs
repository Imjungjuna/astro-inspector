import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { astroAiLocator } from "../../../dist/index.js";

export default defineConfig({
  integrations: [react(), astroAiLocator()]
});
