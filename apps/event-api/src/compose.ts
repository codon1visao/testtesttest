import type { Express } from "express";
import { createApp } from "./app.js";
import type { AppConfig } from "./config/env.js";
import { createRedisClient, settleInitialConnection } from "./integrations/redis-client.js";
import { RedisEventViewCache } from "./integrations/redis-event-view-cache.js";
import { RedisHealthProbe } from "./integrations/redis-health-probe.js";
import { systemClock } from "./integrations/system-clock.js";
import { attendanceRoutes } from "./modules/attendance/attendance-controller.js";
import { AttendanceService } from "./modules/attendance/attendance-service.js";
import { CacheBypass } from "./modules/changes/cache-bypass.js";
import { EventChangePublisher } from "./modules/changes/event-change-publisher.js";
import { InProcessChangeNotifier } from "./modules/changes/in-process-change-notifier.js";
import { eventRoutes } from "./modules/event/event-controller.js";
import { EventViewService } from "./modules/event/event-view-service.js";
import { noGenerationActivity } from "./modules/event/no-generation-activity.js";
import { healthRoutes } from "./modules/health/health-controller.js";
import { createDataSource } from "./persistence/data-source.js";
import { MysqlHealthProbe } from "./persistence/mysql-health-probe.js";
import { bootstrapStore } from "./persistence/store-bootstrap.js";
import type { Clock } from "./ports/clock.js";
import { TypeOrmUnitOfWork } from "./repositories/typeorm-unit-of-work.js";
import type { Logger } from "./shared/logger.js";

export interface EventApi {
  readonly app: Express;
  readonly changes: EventChangePublisher;
  close(): Promise<void>;
}

export interface ComposeOptions {
  logger: Logger;
  clock?: Clock;
}

/**
 * The composition root: the only place that knows concrete adapters. Startup fails clearly
 * (and never seeds) when MySQL is unreachable; Redis is optional and reconnects on its own.
 */
export async function composeEventApi(
  config: AppConfig,
  { logger, clock = systemClock }: ComposeOptions,
): Promise<EventApi> {
  const dataSource = createDataSource(config.mysqlUrl);
  await dataSource.initialize();
  try {
    await bootstrapStore(dataSource, logger, clock.now());
  } catch (error) {
    await dataSource.destroy();
    throw error;
  }

  const redis = createRedisClient(config.redisUrl, logger);
  await settleInitialConnection(redis);
  const uow = new TypeOrmUnitOfWork(dataSource, logger);
  const cache = new RedisEventViewCache(redis, logger);
  const bypass = new CacheBypass();
  const notifier = new InProcessChangeNotifier(logger);
  const changes = new EventChangePublisher(cache, bypass, notifier, logger);
  const eventViews = new EventViewService({
    uow,
    cache,
    bypass,
    activity: noGenerationActivity,
    clock,
    defaultTtlMs: config.eventViewCacheTtlMs,
    logger,
  });
  const attendance = new AttendanceService(uow, changes);

  const app = createApp({
    logger,
    policy: { allowedOrigins: config.allowedOrigins, allowedHosts: config.allowedHosts },
    routes: [
      healthRoutes({
        mysql: new MysqlHealthProbe(dataSource),
        redis: new RedisHealthProbe(redis),
      }),
      eventRoutes(eventViews),
      attendanceRoutes(attendance),
    ],
  });

  return {
    app,
    changes,
    async close() {
      redis.disconnect();
      await dataSource.destroy();
    },
  };
}
