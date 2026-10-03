import { astryxStylex } from "@astryxdesign/build/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [...astryxStylex(), react()],
  resolve: {
    conditions: ["@event-desk/source", "module", "browser", "development|production"],
  },
});
