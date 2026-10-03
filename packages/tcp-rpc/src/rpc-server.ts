import { createServer, type Socket } from "node:net";
import { secretsMatch } from "./auth.js";
import { FrameTooLargeError } from "./errors.js";
import { DEFAULT_LIMITS, encodeFrame, FrameDecoder, type RpcMessage } from "./frame-codec.js";

export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"]);

export type RpcRejectionReason =
  "unauthenticated" | "malformed" | "too-large" | "idle-timeout" | "response-too-large";

export interface RpcRejection {
  reason: RpcRejectionReason;
  /** The decoded request with `auth` removed, when one was read. */
  request: RpcMessage | null;
}

export interface RpcServerOptions {
  secret: string;
  /** Runs one authenticated request (auth removed). It owns its deadline and must settle. */
  handle(request: RpcMessage): Promise<RpcMessage>;
  /** Builds the reply for a request the transport refused. */
  reject(rejection: RpcRejection): RpcMessage;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** How long a connection may take to deliver its one request. */
  idleTimeoutMs?: number;
  maxConnections?: number;
}

export interface RpcServer {
  /** Resolves with the bound port. Only loopback hosts are allowed (F8). */
  listen(host: string, port: number): Promise<number>;
  /** Stops accepting connections and resolves once every connection has been answered and closed. */
  close(): Promise<void>;
}

export function createRpcServer(options: RpcServerOptions): RpcServer {
  const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_LIMITS.maxRequestBytes;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_LIMITS.maxResponseBytes;
  const idleTimeoutMs = options.idleTimeoutMs ?? 5_000;

  function serve(socket: Socket): void {
    const decoder = new FrameDecoder(maxRequestBytes);
    let answered = false;

    const reply = (message: RpcMessage, request: RpcMessage | null): void => {
      if (socket.destroyed) return;
      let frame: Buffer;
      try {
        frame = encodeFrame(message, maxResponseBytes);
      } catch (error) {
        if (!(error instanceof FrameTooLargeError)) throw error;
        frame = encodeFrame(
          options.reject({ reason: "response-too-large", request }),
          maxResponseBytes,
        );
      }
      socket.end(frame);
    };

    const refuse = (reason: RpcRejectionReason, request: RpcMessage | null): void => {
      answered = true;
      clearTimeout(idle);
      reply(options.reject({ reason, request }), request);
    };

    const idle = setTimeout(() => {
      if (!answered) refuse("idle-timeout", null);
    }, idleTimeoutMs);

    socket.on("data", (chunk: Buffer) => {
      if (answered) return; // one request per connection: later bytes are ignored
      let messages: RpcMessage[];
      try {
        messages = decoder.push(chunk);
      } catch (error) {
        refuse(error instanceof FrameTooLargeError ? "too-large" : "malformed", null);
        return;
      }
      const [first] = messages;
      if (first === undefined) return;
      answered = true;
      clearTimeout(idle);
      const { auth, ...request } = first;
      if (!secretsMatch(auth, options.secret)) {
        reply(options.reject({ reason: "unauthenticated", request }), request);
        return;
      }
      options.handle(request).then(
        (response) => {
          reply(response, request);
        },
        () => {
          socket.destroy(); // a handler bug: the caller sees outcome-unknown, never a guessed reply
        },
      );
    });
    socket.on("error", () => {
      socket.destroy(); // a broken peer must never crash the server
    });
    socket.on("close", () => {
      clearTimeout(idle);
    });
  }

  const server = createServer(serve);
  server.maxConnections = options.maxConnections ?? 16;

  return {
    listen(host, port) {
      if (!LOOPBACK_HOSTS.has(host)) {
        return Promise.reject(
          new Error(`Refusing to listen on ${host}: the RPC server binds to loopback only`),
        );
      }
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          resolve(typeof address === "object" && address !== null ? address.port : port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
