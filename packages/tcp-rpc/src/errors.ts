export class FrameTooLargeError extends Error {
  readonly bytes: number;
  readonly maxBytes: number;
  constructor(bytes: number, maxBytes: number) {
    super(`Frame of ${bytes} bytes exceeds the ${maxBytes}-byte limit`);
    this.name = "FrameTooLargeError";
    this.bytes = bytes;
    this.maxBytes = maxBytes;
  }
}

export class MalformedFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedFrameError";
  }
}

/**
 * `not-sent`: the request bytes were never written, so the call is known not to have run.
 * `outcome-unknown`: anything after the write; the server may have acted (F8: never replay blindly).
 */
export type RpcCallFailure = "not-sent" | "outcome-unknown";

export type RpcCallReason =
  | "connect-failed"
  | "connect-timeout"
  | "deadline-passed"
  | "request-too-large"
  | "deadline"
  | "connection-closed"
  | "socket-error"
  | "bad-response"
  | "correlation-mismatch";

export class RpcCallError extends Error {
  readonly kind: RpcCallFailure;
  readonly reason: RpcCallReason;
  constructor(kind: RpcCallFailure, reason: RpcCallReason, options?: { cause?: unknown }) {
    super(`RPC call failed (${kind}: ${reason})`, options);
    this.name = "RpcCallError";
    this.kind = kind;
    this.reason = reason;
  }
}
