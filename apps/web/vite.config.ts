import { astryxStylex } from "@astryxdesign/build/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // rootDir defaults to process.cwd(); pinning it keeps Astryx's source alias and StyleX module
  // resolution correct when Vitest runs from the repository root (`pnpm test`).
  plugins: [...astryxStylex({ rootDir: import.meta.dirname }), react()],
  resolve: {
    conditions: ["@event-desk/source", "module", "browser", "development|production"],
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    // Same origin for the browser: the API's Origin/Host guards see http://localhost:5173 / localhost.
    proxy: { "/api": { target: "http://127.0.0.1:4000", changeOrigin: false } },
  },
});
