import { ConfigError, loadConfig, loadDotEnv } from "../config/env.js";
import { ResetIncompleteError, ResetRefusedError, resetStore } from "./reset-store.js";

try {
  loadDotEnv(new URL("../../../../.env", import.meta.url));
  const config = loadConfig();
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  const report = await resetStore({
    mysqlUrl: config.mysqlUrl,
    redisUrl: config.redisUrl,
    healthUrl: `http://${host}:${config.port}/api/health`,
  });
  const keys = Object.entries(report.deletedKeys)
    .map(([prefix, count]) => `${prefix}* (${count})`)
    .join(", ");
  console.log(
    [
      "Reset complete.",
      `- MySQL database "${report.database}" dropped and recreated: saved attendance, briefings, previews,`,
      "  generation snapshots, outcomes and added feedback notes are gone.",
      `- Redis keys deleted: ${keys}. Other keys were left untouched.`,
      "Start the event API (pnpm dev) to migrate and reseed E101 with F01–F08.",
    ].join("\n"),
  );
} catch (error) {
  if (
    error instanceof ResetRefusedError ||
    error instanceof ResetIncompleteError ||
    error instanceof ConfigError
  ) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
