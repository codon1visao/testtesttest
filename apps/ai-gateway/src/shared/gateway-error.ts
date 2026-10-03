import type { GatewayErrorBody, GatewayErrorCode } from "@event-desk/contracts/gateway-rpc";

/** A failure the Gateway reports on the wire: a stable code and a fixed, safe sentence (F8). */
export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  /** True only when OpenAI is known not to have received the request. */
  readonly notSent: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    code: GatewayErrorCode,
    message: string,
    options: { notSent: boolean; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GatewayError";
    this.code = code;
    this.notSent = options.notSent;
    this.retryAfterMs = options.retryAfterMs;
  }

  toBody(): GatewayErrorBody {
    return {
      code: this.code,
      message: this.message,
      notSent: this.notSent,
      ...(this.retryAfterMs === undefined ? {} : { retryAfterMs: this.retryAfterMs }),
    };
  }
}
