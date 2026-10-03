import { connect, type Socket } from "node:net";
import { RpcCallError, type RpcCallReason } from "./errors.js";
import { DEFAULT_LIMITS, encodeFrame, FrameDecoder, type RpcMessage } from "./frame-codec.js";
import { LOOPBACK_HOSTS } from "./loopback.js";

export interface RpcClientOptions {
  /** Must be a loopback host: the shared secret never crosses an unprotected remote link (F8). */
  host: string;
  port: number;
  secret: string;
  connectTimeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** Opens the connection; defaults to `net.connect`. Tests inject a socket that never connects. */
  createConnection?: (options: { host: string; port: number }) => Socket;
}

export interface RpcClient {
  /** One connection, one request, one response (F8). Never retries; throws RpcCallError. */
  call(request: RpcMessage & { requestId: string }, deadlineAt: Date): Promise<RpcMessage>;
}

export function createRpcClient(options: RpcClientOptions): RpcClient {
  if (!LOOPBACK_HOSTS.has(options.host)) {
    throw new Error(
      `Refusing to call ${options.host}: the RPC client sends its credential to loopback only`,
    );
  }
  const createConnection = options.createConnection ?? connect;
  const connectTimeoutMs = options.connectTimeoutMs ?? 2_000;
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_LIMITS.maxRequestBytes;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_LIMITS.maxResponseBytes;

  return {
    call(request, deadlineAt) {
      return new Promise((resolve, reject) => {
        const remainingMs = deadlineAt.getTime() - Date.now();
        if (remainingMs <= 0) {
          reject(new RpcCallError("not-sent", "deadline-passed"));
          return;
        }
        let frame: Buffer;
        try {
          frame = encodeFrame({ ...request, auth: options.secret }, maxRequestBytes);
        } catch (error) {
          reject(new RpcCallError("not-sent", "request-too-large", { cause: error }));
          return;
        }

        const decoder = new FrameDecoder(maxResponseBytes);
        const socket = createConnection({ host: options.host, port: options.port });
        let written = false;
        let settled = false;

        const settle = (outcome: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(connectTimer);
          clearTimeout(deadlineTimer);
          socket.destroy();
          outcome();
        };
        /** Anything after the write is outcome-unknown: the server may already have acted. */
        const fail = (reason: RpcCallReason, cause?: unknown): void => {
          settle(() => {
            reject(new RpcCallError(written ? "outcome-unknown" : "not-sent", reason, { cause }));
          });
        };

        const connectTimer = setTimeout(
          () => {
            fail("connect-timeout");
          },
          Math.min(connectTimeoutMs, remainingMs),
        );
        const deadlineTimer = setTimeout(() => {
          fail("deadline");
        }, remainingMs);

        socket.once("connect", () => {
          clearTimeout(connectTimer);
          written = true;
          socket.write(frame);
        });
        socket.on("data", (chunk: Buffer) => {
          let messages: RpcMessage[];
          try {
            messages = decoder.push(chunk);
          } catch (error) {
            fail("bad-response", error);
            return;
          }
          const [response] = messages;
          if (response === undefined) return;
          // One connection per request: a null requestId is the server saying it could not read ours.
          if (response.requestId !== request.requestId && response.requestId !== null) {
            fail("correlation-mismatch");
            return;
          }
          settle(() => {
            resolve(response);
          });
        });
        socket.on("error", (error) => {
          fail(written ? "socket-error" : "connect-failed", error);
        });
        socket.on("close", () => {
          fail("connection-closed");
        });
      });
    },
  };
}
