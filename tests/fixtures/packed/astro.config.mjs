import { defineConfig } from "astro/config";
import { astroAiLocator } from "astro-ai-locator";

export default defineConfig({
  integrations: [astroAiLocator()]
});
