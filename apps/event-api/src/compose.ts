import type { Express } from "express";
import { createApp } from "./app.js";
import type { AppConfig } from "./config/env.js";
import { createRedisClient, settleInitialConnection } from "./integrations/redis-client.js";
import { BullMqBriefingBatchQueue } from "./integrations/bullmq-briefing-batch-queue.js";
import { RedisEventViewCache } from "./integrations/redis-event-view-cache.js";
import { RedisGenerationLimits } from "./integrations/redis-generation-limits.js";
import { RedisHealthProbe } from "./integrations/redis-health-probe.js";
import { systemClock } from "./integrations/system-clock.js";
import { TcpAiGatewayClient } from "./integrations/tcp-ai-gateway-client.js";
import { uuidV7IdGenerator } from "./integrations/uuid-v7-id-generator.js";
import { attendanceRoutes } from "./modules/attendance/attendance-controller.js";
import { AttendanceService } from "./modules/attendance/attendance-service.js";
import { CacheBypass } from "./modules/changes/cache-bypass.js";
import { ChangeStreamHub } from "./modules/changes/change-stream.js";
import { changeStreamRoutes } from "./modules/changes/change-stream-controller.js";
import { briefingRoutes } from "./modules/briefing/briefing-controller.js";
import { BriefingSaveService } from "./modules/briefing/briefing-save-service.js";
import { PreviewSelectionService } from "./modules/briefing/preview-selection-service.js";
import { EventChangePublisher } from "./modules/changes/event-change-publisher.js";
import { InProcessChangeNotifier } from "./modules/changes/in-process-change-notifier.js";
import { eventRoutes } from "./modules/event/event-controller.js";
import { EventViewService } from "./modules/event/event-view-service.js";
import { BriefingGenerationService } from "./modules/generation/briefing-generation-service.js";
import { feedbackRoutes } from "./modules/feedback/feedback-controller.js";
import { FeedbackSubmissionService } from "./modules/feedback/feedback-submission-service.js";
import { BatchGenerationProcessor } from "./modules/generation/batch-generation-processor.js";
import { BatchScheduler } from "./modules/generation/batch-scheduler.js";
import { BATCH_MAX_ATTEMPTS } from "./modules/generation/domain/batch-jobs.js";
import { GenerationActivityService } from "./modules/generation/generation-activity-service.js";
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
import { closeApiResources } from "./shutdown.js";

export interface EventApi {
  readonly app: Express;
  readonly changes: EventChangePublisher;
  /** Ends every open change stream; the HTTP server cannot close while one is open. */
  stopStreams(): void;
  /** Ends streams, stops the worker while manual runs drain, then closes the stores (T3 §10). */
  close(): Promise<void>;
}

/** Shutdown waits this long for in-flight manual generations to record their outcome. */
const MANUAL_DRAIN_MS = 8_000;

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
  const hub = new ChangeStreamHub(notifier);
  const limits = new RedisGenerationLimits(redis, config.generationLimits, logger);
  const generation = new BriefingGenerationService({
    uow,
    gateway: new TcpAiGatewayClient(config.gateway, logger),
    ids,
    clock,
    changes,
    logger,
    limits,
  });
  const manualGeneration = new ManualGenerationCoordinator({
    generation,
    ids,
    clock,
    changes,
    timeoutMs: config.manualGenerationTimeoutMs,
    logger,
  });
  const attendance = new AttendanceService(uow, changes);
  const selection = new PreviewSelectionService({ uow, clock, changes });
  const briefingSave = new BriefingSaveService({ uow, clock, changes });
  const batchQueue = new BullMqBriefingBatchQueue({
    redisUrl: config.redisUrl,
    windowMs: config.batchWindowMs,
    maxAttempts: BATCH_MAX_ATTEMPTS,
    ids,
    clock,
    logger,
  });
  const eventViews = new EventViewService({
    uow,
    cache,
    bypass,
    activity: new GenerationActivityService({
      manual: manualGeneration,
      queue: batchQueue,
      limits,
      clock,
      logger,
    }),
    clock,
    defaultTtlMs: config.eventViewCacheTtlMs,
    logger,
  });
  const scheduler = new BatchScheduler({ queue: batchQueue, uow, changes, logger });
  const feedback = new FeedbackSubmissionService({
    uow,
    scheduler,
    clock,
    changes,
    maxNotesPerEvent: config.feedback.maxNotesPerEvent,
  });
  const processor = new BatchGenerationProcessor({
    generation,
    manual: manualGeneration,
    limits,
    changes,
    clock,
    logger,
  });
  await scheduler.reconcile();
  batchQueue.start(processor);

  const app = createApp({
    logger,
    policy: { allowedOrigins: config.allowedOrigins, allowedHosts: config.allowedHosts },
    routes: [
      healthRoutes({
        mysql: new MysqlHealthProbe(dataSource),
        redis: new RedisHealthProbe(redis),
      }),
      eventRoutes(eventViews),
      changeStreamRoutes(hub, eventViews),
      attendanceRoutes(attendance),
      generationRoutes(manualGeneration),
      briefingRoutes({ selection, save: briefingSave }),
      feedbackRoutes(feedback, { enabled: config.feedback.submissionEnabled }),
    ],
  });

  return {
    app,
    changes,
    stopStreams() {
      hub.closeAll();
    },
    close() {
      return closeApiResources({
        logger,
        stopStreams: () => {
          hub.closeAll();
        },
        closeBatchQueue: () => batchQueue.close(),
        // A manual run records its outcome before the stores go away (carry-forward from Plan 4).
        whenManualIdle: () => manualGeneration.whenAllIdle(),
        manualDrainMs: MANUAL_DRAIN_MS,
        closeRedis: () => {
          redis.disconnect();
        },
        closeDatabase: () => dataSource.destroy(),
      });
    },
  };
}
