import { createServer, type Server, Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { RpcCallError } from "./errors.js";
import { encodeFrame, FrameDecoder, type RpcMessage } from "./frame-codec.js";
import { createRpcClient } from "./rpc-client.js";
import {
  createRpcServer,
  type RpcRejection,
  type RpcServer,
  type RpcServerOptions,
} from "./rpc-server.js";

const SECRET = "test-secret-".padEnd(40, "x");
const HOST = "127.0.0.1";
const soon = (ms = 2_000) => new Date(Date.now() + ms);
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function startServer(overrides: Partial<RpcServerOptions> = {}) {
  const handled: RpcMessage[] = [];
  const rejections: RpcRejection[] = [];
  const server: RpcServer = createRpcServer({
    secret: SECRET,
    handle: (request) => {
      handled.push(request);
      return Promise.resolve({ requestId: request.requestId, echo: request.payload });
    },
    reject: (rejection) => {
      rejections.push(rejection);
      return { requestId: rejection.request?.requestId ?? null, rejected: rejection.reason };
    },
    idleTimeoutMs: 500,
    ...overrides,
  });
  const port = await server.listen(HOST, 0);
  cleanups.push(() => server.close());
  return { server, port, handled, rejections };
}

/** A raw TCP server for misbehaving-peer cases the real server never produces. */
async function startRawServer(onConnection: (socket: Socket) => void): Promise<number> {
  const raw: Server = createServer(onConnection);
  await new Promise<void>((resolve) => raw.listen(0, HOST, resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) =>
        raw.close(() => {
          resolve();
        }),
      ),
  );
  const address = raw.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function rawExchange(port: number, bytes: Buffer): Promise<RpcMessage[]> {
  const socket = new Socket();
  const decoder = new FrameDecoder(128 * 1024);
  const received: RpcMessage[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.on("data", (chunk) => received.push(...decoder.push(chunk)));
    socket.on("close", () => {
      resolve();
    });
    socket.on("error", reject);
    socket.connect(port, HOST, () => socket.write(bytes));
  });
  return received;
}

async function failureOf(promise: Promise<unknown>): Promise<RpcCallError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcCallError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("rpc server and client", () => {
  it("round-trips one request; the handler never sees the credential", async () => {
    const { port, handled } = await startServer();
    const client = createRpcClient({ host: HOST, port, secret: SECRET });
    const response = await client.call({ requestId: "r1", payload: "hello" }, soon());
    expect(response).toEqual({ requestId: "r1", echo: "hello" });
    expect(handled).toEqual([{ requestId: "r1", payload: "hello" }]);
  });

  it("S1-11: a wrong secret is rejected before the handler runs", async () => {
    const { port, handled, rejections } = await startServer();
    const client = createRpcClient({ host: HOST, port, secret: `${SECRET}-wrong` });
    expect(await client.call({ requestId: "r1" }, soon())).toEqual({
      requestId: "r1",
      rejected: "unauthenticated",
    });
    expect(handled).toEqual([]);
    expect(rejections[0]?.request).toEqual({ requestId: "r1" });
  });

  it("F8-03: an oversized request frame is rejected without being buffered", async () => {
    const { port, handled } = await startServer();
    const client = createRpcClient({
      host: HOST,
      port,
      secret: SECRET,
      maxRequestBytes: 1024 * 1024,
    });
    const response = await client.call({ requestId: "r1", payload: "x".repeat(70 * 1024) }, soon());
    expect(response).toEqual({ requestId: null, rejected: "too-large" });
    expect(handled).toEqual([]);
  });

  it("answers a malformed frame and an idle connection through reject", async () => {
    const { port } = await startServer();
    const garbage = Buffer.concat([Buffer.from([0, 0, 0, 5]), Buffer.from("{oops")]);
    expect(await rawExchange(port, garbage)).toEqual([{ requestId: null, rejected: "malformed" }]);
    expect(await rawExchange(port, Buffer.alloc(0))).toEqual([
      { requestId: null, rejected: "idle-timeout" },
    ]);
  });

  it("F8-05: handles only the first of two combined frames", async () => {
    const { port, handled } = await startServer();
    const frames = Buffer.concat([
      encodeFrame({ auth: SECRET, requestId: "a" }, 1024),
      encodeFrame({ auth: SECRET, requestId: "b" }, 1024),
    ]);
    // The handler echoes `payload`, absent here; JSON drops the undefined field.
    expect(await rawExchange(port, frames)).toEqual([{ requestId: "a" }]);
    expect(handled.map((request) => request.requestId)).toEqual(["a"]);
  });

  it("replaces an oversized reply with a response-too-large rejection", async () => {
    const { port } = await startServer({
      handle: (request) =>
        Promise.resolve({ requestId: request.requestId, blob: "x".repeat(200 * 1024) }),
    });
    const client = createRpcClient({ host: HOST, port, secret: SECRET });
    expect(await client.call({ requestId: "r1" }, soon())).toEqual({
      requestId: "r1",
      rejected: "response-too-large",
    });
  });

  it("refuses to listen on a non-loopback address", async () => {
    const server = createRpcServer({
      secret: SECRET,
      handle: () => Promise.resolve({}),
      reject: () => ({}),
    });
    await expect(server.listen("0.0.0.0", 0)).rejects.toThrow(/loopback/);
  });

  it("close() waits for an in-flight call to be answered", async () => {
    const { server, port } = await startServer({
      handle: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { requestId: request.requestId, done: true };
      },
    });
    const call = createRpcClient({ host: HOST, port, secret: SECRET }).call(
      { requestId: "r1" },
      soon(),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await server.close();
    expect(await call).toEqual({ requestId: "r1", done: true });
  });
});

describe("rpc client failure classification", () => {
  it("is not-sent when the connection is refused", async () => {
    const { server, port } = await startServer();
    await server.close();
    const error = await failureOf(
      createRpcClient({ host: HOST, port, secret: SECRET }).call({ requestId: "r1" }, soon()),
    );
    expect([error.kind, error.reason]).toEqual(["not-sent", "connect-failed"]);
  });

  it("is not-sent when the deadline has already passed", async () => {
    const error = await failureOf(
      createRpcClient({ host: HOST, port: 1, secret: SECRET }).call(
        { requestId: "r1" },
        new Date(Date.now() - 1),
      ),
    );
    expect([error.kind, error.reason]).toEqual(["not-sent", "deadline-passed"]);
  });

  it("Review Focus 2: a connection closed after the request was written is outcome-unknown", async () => {
    const port = await startRawServer((socket) => {
      socket.once("data", () => socket.destroy());
    });
    const error = await failureOf(
      createRpcClient({ host: HOST, port, secret: SECRET }).call({ requestId: "r1" }, soon()),
    );
    expect(error.kind).toBe("outcome-unknown");
  });

  it("is outcome-unknown when the deadline passes while the server works", async () => {
    const { port } = await startServer({
      handle: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        return { requestId: request.requestId };
      },
    });
    const started = Date.now();
    const error = await failureOf(
      createRpcClient({ host: HOST, port, secret: SECRET }).call({ requestId: "r1" }, soon(200)),
    );
    expect([error.kind, error.reason]).toEqual(["outcome-unknown", "deadline"]);
    expect(Date.now() - started).toBeLessThan(800);
  });

  it("F8-05: a reply for another request is outcome-unknown", async () => {
    const port = await startRawServer((socket) => {
      socket.once("data", () => socket.end(encodeFrame({ requestId: "someone-else" }, 1024)));
    });
    const error = await failureOf(
      createRpcClient({ host: HOST, port, secret: SECRET }).call({ requestId: "r1" }, soon()),
    );
    expect([error.kind, error.reason]).toEqual(["outcome-unknown", "correlation-mismatch"]);
  });

  it("a handler that throws drops the connection, which the client reports as outcome-unknown", async () => {
    const { port } = await startServer({ handle: () => Promise.reject(new Error("bug")) });
    const error = await failureOf(
      createRpcClient({ host: HOST, port, secret: SECRET }).call({ requestId: "r1" }, soon()),
    );
    expect(error.kind).toBe("outcome-unknown");
  });
});
