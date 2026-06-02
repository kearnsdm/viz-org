import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
// On a production build the app is served from a subpath on GitHub Pages
// (https://<user>.github.io/viz-org/), so assets must resolve under /viz-org/.
// Local dev/preview stays at the root path.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/viz-org/" : "/",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
}));
