import { createOpenAIBriefingModel } from "./ai/openai-briefing-model.js";
import { createOpenAIClient } from "./ai/openai-client.js";
import type { GatewayConfig } from "./config/env.js";
import { LaneGate } from "./limits/lane-gate.js";
import { UsageBackstop } from "./limits/usage-backstop.js";
import { createBriefingGenerateV1 } from "./operations/briefing-generate-v1.js";
import type { BriefingModel } from "./operations/briefing-model.js";
import type { Logger } from "./shared/logger.js";
import { createGatewayRpcServer } from "./transport/rpc-server.js";

export interface GatewayDeps {
  logger: Logger;
  now?: () => Date;
  /** Tests only: replaces the model built from config (null = no provider). */
  briefingModel?: BriefingModel | null;
}

export interface Gateway {
  /** Resolves with the bound port. */
  listen(): Promise<number>;
  /** Stops accepting connections; resolves once in-flight calls have been answered. */
  close(): Promise<void>;
}

/** The composition root (T3 §10): every dependency is wired here by hand. */
export function composeGateway(config: GatewayConfig, deps: GatewayDeps): Gateway {
  const now = deps.now ?? (() => new Date());
  const { provider } = config;
  const model =
    deps.briefingModel !== undefined
      ? deps.briefingModel
      : provider === null
        ? null
        : createOpenAIBriefingModel(
            createOpenAIClient({ apiKey: provider.apiKey, timeoutMs: provider.timeoutMs }),
            {
              model: provider.model,
              maxOutputTokens: provider.maxOutputTokens,
              reasoningEffort: provider.reasoningEffort,
            },
          );

  const briefingGenerateV1 = createBriefingGenerateV1({
    model,
    lanes: new LaneGate(),
    backstop: new UsageBackstop(config.dailyCallLimit, now),
    now,
    maxCallMs: config.maxCallMs,
    responseMarginMs: config.responseMarginMs,
  });
  const server = createGatewayRpcServer({
    secret: config.serviceSecret,
    briefingGenerateV1,
    logger: deps.logger,
  });

  return {
    listen: () => server.listen(config.host, config.port),
    close: () => server.close(),
  };
}
