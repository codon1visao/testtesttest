import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "tcp-rpc",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
