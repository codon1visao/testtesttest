import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// @stylexjs/unplugin's dev-only `configureServer` hook starts an interval that only an HTTP server
// close clears; Vitest has none, so shutdown would stall 10 s. Tests keep the transforms, drop the hook.
const plugins = (viteConfig.plugins ?? [])
  .flat(Infinity)
  .map((plugin) =>
    typeof plugin === "object" && plugin !== null && "name" in plugin
      ? { ...plugin, configureServer: undefined }
      : plugin,
  );

export default mergeConfig(
  { ...viteConfig, plugins },
  defineConfig({
    test: {
      name: "web",
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["./src/testing/setup.ts"],
    },
  }),
);
