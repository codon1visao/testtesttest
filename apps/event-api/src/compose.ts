import type { Express } from "express";
import { createApp } from "./app.js";
import type { AppConfig } from "./config/env.js";
import { createRedisClient, settleInitialConnection } from "./integrations/redis-client.js";
import { RedisEventViewCache } from "./integrations/redis-event-view-cache.js";
import { RedisGenerationLimits } from "./integrations/redis-generation-limits.js";
import { RedisHealthProbe } from "./integrations/redis-health-probe.js";
import { systemClock } from "./integrations/system-clock.js";
import { TcpAiGatewayClient } from "./integrations/tcp-ai-gateway-client.js";
import { uuidV7IdGenerator } from "./integrations/uuid-v7-id-generator.js";
import { attendanceRoutes } from "./modules/attendance/attendance-controller.js";
import { AttendanceService } from "./modules/attendance/attendance-service.js";
import { CacheBypass } from "./modules/changes/cache-bypass.js";
import { briefingRoutes } from "./modules/briefing/briefing-controller.js";
import { BriefingSaveService } from "./modules/briefing/briefing-save-service.js";
import { PreviewSelectionService } from "./modules/briefing/preview-selection-service.js";
import { EventChangePublisher } from "./modules/changes/event-change-publisher.js";
import { InProcessChangeNotifier } from "./modules/changes/in-process-change-notifier.js";
import { eventRoutes } from "./modules/event/event-controller.js";
import { EventViewService } from "./modules/event/event-view-service.js";
import { BriefingGenerationService } from "./modules/generation/briefing-generation-service.js";
import { generationRoutes } from "./modules/generation/generation-controller.js";
import { ManualGenerationCoordinator } from "./modules/generation/manual-generation-coordinator.js";
import { healthRoutes } from "./modules/health/health-controller.js";
import { createDataSource } from "./persistence/data-source.js";
import { MysqlHealthProbe } from "./persistence/mysql-health-probe.js";
import { bootstrapStore } from "./persistence/store-bootstrap.js";
import type { Clock } from "./ports/clock.js";
import type { IdGenerator } from "./ports/id-generator.js";
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
  ids?: IdGenerator;
}

/**
 * The composition root: the only place that knows concrete adapters. Startup fails clearly
 * (and never seeds) when MySQL is unreachable; Redis is optional and reconnects on its own.
 */
export async function composeEventApi(
  config: AppConfig,
  { logger, clock = systemClock, ids = uuidV7IdGenerator }: ComposeOptions,
): Promise<EventApi> {
  const queryTimeoutMs = config.mysqlQueryTimeoutMs;
  const dataSource = createDataSource(config.mysqlUrl, { queryTimeoutMs });
  await dataSource.initialize();
  try {
    await bootstrapStore(dataSource, logger, clock.now());
  } catch (error) {
    await dataSource.destroy();
    throw error;
  }

  const redis = createRedisClient(config.redisUrl, logger);
  await settleInitialConnection(redis);
  const uow = new TypeOrmUnitOfWork(dataSource, logger, { queryTimeoutMs });
  const cache = new RedisEventViewCache(redis, logger);
  const bypass = new CacheBypass();
  const notifier = new InProcessChangeNotifier(logger);
  const changes = new EventChangePublisher(cache, bypass, notifier, logger);
  const generation = new BriefingGenerationService({
    uow,
    gateway: new TcpAiGatewayClient(config.gateway, logger),
    ids,
    clock,
    changes,
    logger,
    limits: new RedisGenerationLimits(redis, config.generationLimits, logger),
  });
  const manualGeneration = new ManualGenerationCoordinator({
    generation,
    ids,
    clock,
    changes,
    timeoutMs: config.manualGenerationTimeoutMs,
    logger,
  });
  const eventViews = new EventViewService({
    uow,
    cache,
    bypass,
    activity: manualGeneration,
    clock,
    defaultTtlMs: config.eventViewCacheTtlMs,
    logger,
  });
  const attendance = new AttendanceService(uow, changes);
  const selection = new PreviewSelectionService({ uow, clock, changes });
  const briefingSave = new BriefingSaveService({ uow, clock, changes });

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
      generationRoutes(manualGeneration),
      briefingRoutes({ selection, save: briefingSave }),
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
