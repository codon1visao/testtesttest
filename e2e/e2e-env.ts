/**
 * One isolated stack for the walkthrough: its own ports, the test database and Redis DB 2, so it
 * never touches `pnpm dev` (4000/4100/5173) or the integration tests (Redis DB 1).
 * The secret is a local-only test value shared by the fake Gateway and the event API.
 */
export const E2E_PORTS = { gateway: 4199, eventApi: 4010, web: 5183 } as const;
export const E2E_GATEWAY_SECRET = "e2e-only-gateway-secret-0123456789abcdef";

export const E2E_EVENT_API_ENV: Record<string, string> = {
  HOST: "127.0.0.1",
  PORT: String(E2E_PORTS.eventApi),
  MYSQL_URL:
    process.env.TEST_MYSQL_URL ??
    "mysql://event_desk:event_desk_local@127.0.0.1:3306/event_desk_test",
  REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6379/2",
  ALLOWED_ORIGINS: `http://localhost:${String(E2E_PORTS.web)}`,
  ALLOWED_HOSTS: "localhost,127.0.0.1,[::1]",
  GATEWAY_HOST: "127.0.0.1",
  GATEWAY_PORT: String(E2E_PORTS.gateway),
  GATEWAY_SERVICE_SECRET: E2E_GATEWAY_SECRET,
  // A short fixed window keeps the F7 spec quick while still collecting a burst into one batch.
  BRIEFING_BATCH_WINDOW_MS: "2000",
  LOG_LEVEL: "warn",
};
