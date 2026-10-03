import type { RunId } from "@event-desk/contracts";
import type {
  BriefingGenerateV1Input,
  BriefingGenerateV1Result,
  GatewayErrorCode,
  GatewayLane,
} from "@event-desk/contracts/gateway-rpc";

export interface BriefingCallRequest {
  runId: RunId;
  attemptId: string;
  lane: GatewayLane;
  deadlineAt: Date;
  input: BriefingGenerateV1Input;
}

/**
 * One attempt's result. `notSent: false` on a failure means the provider may have received (and
 * billed) the request: callers must not replay it automatically (F8, the Plan 3 contract).
 */
export type BriefingCallResult =
  | { ok: true; result: BriefingGenerateV1Result }
  | { ok: false; code: GatewayErrorCode; notSent: boolean; retryAfterMs?: number };

export interface AiGatewayClient {
  /** Exactly one RPC attempt; never retries; Gateway and transport failures are results, not throws. */
  generateBriefing(request: BriefingCallRequest): Promise<BriefingCallResult>;
}
