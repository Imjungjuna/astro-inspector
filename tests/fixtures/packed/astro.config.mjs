import { defineConfig } from "astro/config";
import { astroInspector } from "astro-inspector";

export default defineConfig({
  integrations: [astroInspector()]
});
