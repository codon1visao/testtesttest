import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { loadDotEnv } from "../config/env.js";
import { parseSimulateArgs, UsageError } from "./feedback-simulate-args.js";
import { runSimulation } from "./feedback-simulation.js";

try {
  loadDotEnv(new URL("../../../../.env", import.meta.url));
  const options = parseSimulateArgs(process.argv.slice(2), process.env, (path) =>
    readFileSync(path, "utf8"),
  );
  const results = await runSimulation(options, {
    fetch,
    sleep: (ms) => sleep(ms),
    newSubmissionId: () => randomUUID(),
  });
  for (const result of results) {
    console.log(`${result.id} saved — automatic briefing ${result.automaticBriefing}`);
  }
  console.log(
    `${String(results.length)} notes sent; with the default 3 s window they produce one automatic briefing.`,
  );
} catch (error) {
  console.error(
    error instanceof UsageError
      ? `Usage: pnpm feedback:simulate [--count N] [--interval-ms MS] [--text-file FILE]\n${error.message}`
      : error instanceof Error
        ? error.message
        : String(error),
  );
  process.exitCode = 1;
}
