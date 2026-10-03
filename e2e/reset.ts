import { spawnSync } from "node:child_process";
import { E2E_EVENT_API_ENV } from "./e2e-env.js";

// F1's explicit reset, aimed at the E2E stores. It refuses while anything answers on the E2E API port.
const result = spawnSync("pnpm", ["--filter", "@event-desk/event-api", "db:reset"], {
  stdio: "inherit",
  env: { ...process.env, ...E2E_EVENT_API_ENV },
});
process.exit(result.status ?? 1);
