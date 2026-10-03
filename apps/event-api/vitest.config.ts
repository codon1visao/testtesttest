import { defineProject } from "vitest/config";
import { workspaceSourceResolution } from "./vitest.shared.config.ts";

export default defineProject({
  ...workspaceSourceResolution,
  test: {
    name: "event-api",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.int.test.ts"],
    environment: "node",
  },
});
