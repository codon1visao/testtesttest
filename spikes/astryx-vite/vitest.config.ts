import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// @stylexjs/unplugin starts a 150 ms setInterval in its dev-only `configureServer` hook and clears
// it only when an HTTP server closes. Vitest has no HTTP server, so it would delay shutdown by 10 s.
// Tests need the StyleX transforms, not that hook, so the test config drops it from every plugin.
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
      environment: "jsdom",
      include: ["src/**/*.test.tsx"],
      setupFiles: ["./src/test-setup.ts"],
    },
  }),
);
