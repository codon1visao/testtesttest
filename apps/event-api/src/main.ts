import { composeEventApi } from "./compose.js";
import { type AppConfig, ConfigError, loadConfig, loadDotEnv } from "./config/env.js";
import { createLogger } from "./shared/logger.js";

const SHUTDOWN_GRACE_MS = 10_000;

loadDotEnv(new URL("../../../.env", import.meta.url));

function readConfig(): AppConfig {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      createLogger("info").fatal({ problems: error.problems }, error.message);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = createLogger(config.logLevel);
const api = await composeEventApi(config, { logger }).catch((error: unknown) => {
  logger.fatal({ err: error }, "event API failed to start (is MySQL running? try: pnpm infra:up)");
  process.exit(1);
});

const server = api.app.listen(config.port, config.host, (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, "event API could not listen");
    process.exit(1);
  }
  logger.info({ host: config.host, port: config.port }, "event API listening");
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, "shutting down");
  setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  server.close(() => {
    void api.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, "shutdown failed");
        process.exit(1);
      },
    );
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
