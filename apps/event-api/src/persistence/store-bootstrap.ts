import type { DataSource } from "typeorm";
import type { Logger } from "../shared/logger.js";
import { seedIfMissing } from "./seed.js";

/** Startup: apply pending migrations, then seed if (and only if) E101 does not exist. */
export async function bootstrapStore(
  dataSource: DataSource,
  logger: Logger,
  now: Date,
): Promise<void> {
  const applied = await dataSource.runMigrations({ transaction: "none" });
  const seed = await seedIfMissing(dataSource, now);
  logger.info({ migrationsApplied: applied.map((m) => m.name), seed }, "event store ready");
}
