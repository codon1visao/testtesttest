import { randomUUID } from "node:crypto";
import {
  BRIEFING_GENERATE_V1,
  BriefingGenerateV1ResponseSchema,
} from "@event-desk/contracts/gateway-rpc";
import {
  createRpcClient,
  RpcCallError,
  type RpcClient,
  type RpcMessage,
} from "@event-desk/tcp-rpc";
import type {
  AiGatewayClient,
  BriefingCallRequest,
  BriefingCallResult,
} from "../ports/ai-gateway-client.js";
import type { Logger } from "../shared/logger.js";

export interface GatewayClientConfig {
  host: string;
  port: number;
  secret: string;
}

const OUTCOME_UNKNOWN: BriefingCallResult = {
  ok: false,
  code: "AI_OUTCOME_UNKNOWN",
  notSent: false,
};

/** The event API's only way to the AI Gateway: one authenticated TCP request per attempt (F8). */
export class TcpAiGatewayClient implements AiGatewayClient {
  private readonly rpc: RpcClient;

  constructor(
    config: GatewayClientConfig,
    private readonly logger: Logger,
  ) {
    this.rpc = createRpcClient({ host: config.host, port: config.port, secret: config.secret });
  }

  async generateBriefing(request: BriefingCallRequest): Promise<BriefingCallResult> {
    const requestId = randomUUID();
    const log = this.logger.child({
      requestId,
      runId: request.runId,
      attemptId: request.attemptId,
    });
    let raw: RpcMessage;
    try {
      raw = await this.rpc.call(
        {
          v: 1,
          operation: BRIEFING_GENERATE_V1,
          requestId,
          runId: request.runId,
          attemptId: request.attemptId,
          lane: request.lane,
          deadlineAt: request.deadlineAt.toISOString(),
          input: request.input,
        },
        request.deadlineAt,
      );
    } catch (error) {
      if (!(error instanceof RpcCallError)) throw error;
      log.warn({ kind: error.kind, reason: error.reason }, "gateway call failed");
      return error.kind === "not-sent"
        ? { ok: false, code: "GATEWAY_UNAVAILABLE", notSent: true }
        : OUTCOME_UNKNOWN;
    }

    const parsed = BriefingGenerateV1ResponseSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn({ reason: "unreadable-reply" }, "gateway reply did not match the contract");
      return OUTCOME_UNKNOWN;
    }
    const reply = parsed.data;
    const mismatched =
      (reply.runId !== null && reply.runId !== request.runId) ||
      (reply.attemptId !== null && reply.attemptId !== request.attemptId);
    if (mismatched) {
      log.warn({ reason: "correlation-mismatch" }, "gateway reply was for another attempt");
      return OUTCOME_UNKNOWN;
    }
    if (reply.ok) return { ok: true, result: reply.result };
    log.info(
      { code: reply.error.code, notSent: reply.error.notSent },
      "gateway answered with an error",
    );
    return {
      ok: false,
      code: reply.error.code,
      notSent: reply.error.notSent,
      ...(reply.error.retryAfterMs === undefined ? {} : { retryAfterMs: reply.error.retryAfterMs }),
    };
  }
}
