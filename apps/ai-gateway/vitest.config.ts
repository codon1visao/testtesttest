import { defineProject } from "vitest/config";

const conditions = ["@event-desk/source", "module", "node", "development|production"];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: "ai-gateway",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
