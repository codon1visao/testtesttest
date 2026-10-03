import { defineConfig, devices } from "@playwright/test";
import { E2E_EVENT_API_ENV, E2E_PORTS } from "./e2e-env.js";

const webUrl = `http://localhost:${String(E2E_PORTS.web)}`;

/** Chromium only (T3 §12). One worker: the walkthrough owns the single E101 event. */
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: process.env.CI !== undefined,
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: webUrl, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm run fake-gateway",
      port: E2E_PORTS.gateway,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command:
        "pnpm --filter @event-desk/event-api exec tsx --conditions=@event-desk/source src/main.ts",
      url: `http://127.0.0.1:${String(E2E_PORTS.eventApi)}/api/health`,
      env: E2E_EVENT_API_ENV,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @event-desk/web exec vite --port ${String(E2E_PORTS.web)} --strictPort`,
      url: webUrl,
      env: { EVENT_API_URL: `http://127.0.0.1:${String(E2E_PORTS.eventApi)}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
