import { composeGateway } from "./compose.js";
import { ConfigError, type GatewayConfig, loadConfig, loadDotEnv } from "./config/env.js";
import { createLogger } from "./shared/logger.js";

loadDotEnv(new URL("../../../.env", import.meta.url));

function readConfig(): GatewayConfig {
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
const gateway = composeGateway(config, { logger });

if (config.provider === null) {
  logger.warn("OPENAI_API_KEY is not set: briefing calls will answer PROVIDER_NOT_CONFIGURED");
}

const port = await gateway.listen().catch((error: unknown) => {
  logger.fatal(
    { errorClass: error instanceof Error ? error.name : typeof error },
    "AI Gateway could not listen",
  );
  process.exit(1);
});
logger.info(
  { host: config.host, port, model: config.provider?.model ?? null },
  "AI Gateway listening",
);

/**
 * SIGTERM/SIGINT: stop accepting, let in-flight calls finish or hit their deadline (each is capped at
 * GATEWAY_MAX_CALL_MS), then exit. A second signal is ignored; a hard timer bounds the wait.
 */
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    logger.warn({ signal }, "already shutting down; signal ignored");
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  setTimeout(() => process.exit(1), config.maxCallMs + 5_000).unref();
  void gateway.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
