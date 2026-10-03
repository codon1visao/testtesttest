import {
  BRIEFING_GENERATE_V1,
  BriefingGenerateV1RequestSchema,
  type BriefingGenerateV1Response,
  BriefingGenerateV1ResponseSchema,
  type GatewayErrorBody,
  GatewayRequestHeaderSchema,
} from "@event-desk/contracts/gateway-rpc";
import {
  createRpcServer,
  type RpcMessage,
  type RpcRejectionReason,
  type RpcServer,
} from "@event-desk/tcp-rpc";
import type { BriefingGenerateV1 } from "../operations/briefing-generate-v1.js";
import { GatewayError } from "../shared/gateway-error.js";
import type { Logger } from "../shared/logger.js";

interface Correlation {
  requestId: string | null;
  runId: string | null;
  attemptId: string | null;
}
const NO_CORRELATION: Correlation = { requestId: null, runId: null, attemptId: null };

function correlationOf(message: RpcMessage | null): Correlation {
  const header = GatewayRequestHeaderSchema.safeParse(message);
  if (!header.success) return NO_CORRELATION;
  const { requestId, runId, attemptId } = header.data;
  return { requestId, runId, attemptId };
}

function failure(correlation: Correlation, error: GatewayErrorBody): BriefingGenerateV1Response {
  return { v: 1, ok: false, ...correlation, error };
}

const TRANSPORT_REJECTIONS: Record<RpcRejectionReason, GatewayErrorBody> = {
  unauthenticated: {
    code: "GATEWAY_AUTH_FAILED",
    message: "The caller is not authorised.",
    notSent: true,
  },
  malformed: {
    code: "VALIDATION_FAILED",
    message: "The request could not be read.",
    notSent: true,
  },
  "too-large": {
    code: "VALIDATION_FAILED",
    message: "The request exceeds the Gateway's size limit.",
    notSent: true,
  },
  "idle-timeout": {
    code: "VALIDATION_FAILED",
    message: "The request did not arrive in time.",
    notSent: true,
  },
  "response-too-large": {
    code: "OUTPUT_INVALID",
    message: "The result exceeds the Gateway's response size limit.",
    notSent: false,
  },
};

export interface GatewayRpcServerDeps {
  secret: string;
  briefingGenerateV1: BriefingGenerateV1;
  logger: Logger;
}

/** The TCP edge: authenticate (tcp-rpc), validate against the shared contract, route, answer safely. */
export function createGatewayRpcServer(deps: GatewayRpcServerDeps): RpcServer {
  const { logger } = deps;

  async function handle(message: RpcMessage): Promise<RpcMessage> {
    const started = performance.now();
    const correlation = correlationOf(message);
    if (correlation.requestId === null) {
      logger.warn({ outcome: "VALIDATION_FAILED" }, "request envelope invalid");
      return failure(NO_CORRELATION, {
        code: "VALIDATION_FAILED",
        message: "The request envelope is invalid.",
        notSent: true,
      });
    }
    const operation = typeof message.operation === "string" ? message.operation : "unknown";
    const log = logger.child({ ...correlation, operation });
    if (operation !== BRIEFING_GENERATE_V1) {
      log.warn({ outcome: "VALIDATION_FAILED" }, "unsupported operation");
      return failure(correlation, {
        code: "VALIDATION_FAILED",
        message: "Unsupported operation.",
        notSent: true,
      });
    }
    const parsed = BriefingGenerateV1RequestSchema.safeParse(message);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.map(String).join("."));
      log.warn({ outcome: "VALIDATION_FAILED", fields }, "request rejected");
      return failure(correlation, {
        code: "VALIDATION_FAILED",
        message: "The request does not match briefing.generate.v1.",
        notSent: true,
      });
    }
    const request = parsed.data;
    const durationMs = () => Math.round(performance.now() - started);
    try {
      const result = await deps.briefingGenerateV1(request);
      const reply = BriefingGenerateV1ResponseSchema.safeParse({
        v: 1,
        ok: true,
        requestId: request.requestId,
        runId: request.runId,
        attemptId: request.attemptId,
        result,
      } satisfies BriefingGenerateV1Response);
      if (!reply.success) {
        // A Gateway bug, not a caller error: the provider call already happened, so notSent is false.
        const fields = reply.error.issues.map((issue) => issue.path.map(String).join("."));
        log.error(
          {
            lane: request.lane,
            outcome: "OUTPUT_INVALID",
            notSent: false,
            durationMs: durationMs(),
            fields,
          },
          "briefing result broke the contract",
        );
        return failure(correlation, {
          code: "OUTPUT_INVALID",
          message: "The Gateway produced a result that does not match briefing.generate.v1.",
          notSent: false,
        });
      }
      log.info(
        {
          lane: request.lane,
          outcome: "ok",
          durationMs: durationMs(),
          model: result.model,
          promptVersion: result.promptVersion,
          providerRequestId: result.providerRequestId,
          usage: result.usage,
        },
        "briefing generated",
      );
      return reply.data;
    } catch (error) {
      const body =
        error instanceof GatewayError
          ? error.toBody()
          : ({
              code: "INTERNAL",
              message: "The Gateway failed unexpectedly.",
              notSent: false,
            } satisfies GatewayErrorBody);
      const level = body.code === "INTERNAL" ? "error" : "warn";
      log[level](
        {
          lane: request.lane,
          outcome: body.code,
          notSent: body.notSent,
          durationMs: durationMs(),
          errorClass: error instanceof Error ? error.constructor.name : typeof error,
        },
        "briefing failed",
      );
      return failure(correlation, body);
    }
  }

  return createRpcServer({
    secret: deps.secret,
    handle,
    reject: (rejection) => {
      const correlation = correlationOf(rejection.request);
      logger.warn(
        {
          ...correlation,
          outcome: TRANSPORT_REJECTIONS[rejection.reason].code,
          reason: rejection.reason,
        },
        "request refused",
      );
      return failure(correlation, TRANSPORT_REJECTIONS[rejection.reason]);
    },
  });
}
