import { defineConfig } from "vitest/config";
import { workspaceSourceResolution } from "./vitest.shared.config.ts";

export default defineConfig({
  ...workspaceSourceResolution,
  test: {
    name: "event-api-integration",
    include: ["src/**/*.int.test.ts"],
    environment: "node",
    globalSetup: ["src/testing/integration-global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
