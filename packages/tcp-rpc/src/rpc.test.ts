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

/** Whether `promise` settles within `ms`; the timer is always cleared so no handle outlives the test. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([promise.then(() => true), expired]);
  } finally {
    clearTimeout(timer);
  }
}

const GARBAGE = Buffer.concat([Buffer.from([0, 0, 0, 5]), Buffer.from("{oops")]);

/**
 * A peer without the secret: it sends garbage, reads the malformed reply, then never closes its side
 * (and, with `keepWriting`, keeps streaming bytes). Resolves once the reply has arrived.
 */
async function lingeringPeer(port: number, keepWriting: boolean): Promise<void> {
  const socket = new Socket({ allowHalfOpen: true });
  const decoder = new FrameDecoder(128 * 1024);
  let writer: NodeJS.Timeout | undefined;
  const stop = () => {
    clearInterval(writer);
  };
  socket.on("error", stop); // the server dropping a writing peer surfaces here as EPIPE/ECONNRESET
  socket.on("close", stop);
  cleanups.push(() => {
    stop();
    socket.destroy();
    return Promise.resolve();
  });
  await new Promise<void>((resolve) => {
    socket.on("data", (chunk: Buffer) => {
      if (decoder.push(chunk).length > 0) resolve();
    });
    socket.connect(port, HOST, () => socket.write(GARBAGE));
  });
  if (keepWriting) {
    writer = setInterval(() => {
      if (socket.writable) socket.write("more bytes");
    }, 20);
  }
}

const echo = (request: RpcMessage): Promise<RpcMessage> =>
  Promise.resolve({ requestId: request.requestId, echo: request.payload });

async function expectStillServing(port: number): Promise<void> {
  const client = createRpcClient({ host: HOST, port, secret: SECRET });
  expect(await client.call({ requestId: "next", payload: "ok" }, soon())).toEqual({
    requestId: "next",
    echo: "ok",
  });
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
    const order: string[] = [];
    const call = createRpcClient({ host: HOST, port, secret: SECRET })
      .call({ requestId: "r1" }, soon())
      .then((response) => {
        order.push("answered");
        return response;
      });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await server.close();
    order.push("closed");
    expect(await call).toEqual({ requestId: "r1", done: true });
    expect(order).toEqual(["answered", "closed"]);
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

  it("T3 §9: is not-sent when the connection is not established within the connect timeout", async () => {
    // 10.255.255.1 is non-routable: the SYN goes unanswered, so only the connect timer ends the call.
    const started = Date.now();
    const client = createRpcClient({
      host: "10.255.255.1",
      port: 9,
      secret: SECRET,
      connectTimeoutMs: 50,
    });
    const error = await failureOf(client.call({ requestId: "r1" }, soon()));
    expect([error.kind, error.reason]).toEqual(["not-sent", "connect-timeout"]);
    expect(Date.now() - started).toBeLessThan(1_000);
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

describe("rpc server connection bounds (F8)", () => {
  it.each([
    ["keeps its side open", false],
    ["keeps writing", true],
  ])(
    "a peer that %s after the reply is dropped within the idle timeout, so close() resolves",
    async (_label, keepWriting) => {
      const { server, port } = await startServer(); // idleTimeoutMs: 500
      await lingeringPeer(port, keepWriting);
      expect(await settlesWithin(server.close(), 1_000)).toBe(true);
    },
  );

  it("releases a well-behaved caller's connection at once, not after the linger bound", async () => {
    const { server, port } = await startServer();
    await createRpcClient({ host: HOST, port, secret: SECRET }).call({ requestId: "r1" }, soon());
    expect(await settlesWithin(server.close(), 250)).toBe(true);
  });
});

describe("rpc server fault isolation", () => {
  it("an unserialisable reply drops the connection and the server keeps serving", async () => {
    const { port } = await startServer({
      handle: (request) =>
        request.payload === "bad"
          ? Promise.resolve({ requestId: request.requestId, n: 1n })
          : echo(request),
    });
    const client = createRpcClient({ host: HOST, port, secret: SECRET });
    const error = await failureOf(client.call({ requestId: "r1", payload: "bad" }, soon()));
    expect(error.kind).toBe("outcome-unknown");
    expect(error.reason).not.toBe("deadline"); // dropped, not left hanging
    await expectStillServing(port);
  });

  it("a handler that throws synchronously drops the connection and the server keeps serving", async () => {
    const { port } = await startServer({
      handle: (request) => {
        if (request.payload === "bad") throw new Error("bug");
        return echo(request);
      },
    });
    const client = createRpcClient({ host: HOST, port, secret: SECRET });
    const error = await failureOf(client.call({ requestId: "r1", payload: "bad" }, soon()));
    expect(error.kind).toBe("outcome-unknown");
    expect(error.reason).not.toBe("deadline");
    await expectStillServing(port);
  });

  it("a reject that throws drops refused connections and the server keeps serving", async () => {
    const { port } = await startServer({
      reject: () => {
        throw new Error("bug");
      },
    });
    const wrongSecret = createRpcClient({ host: HOST, port, secret: `${SECRET}-wrong` });
    const error = await failureOf(wrongSecret.call({ requestId: "r1" }, soon()));
    expect(error.kind).toBe("outcome-unknown");
    expect(error.reason).not.toBe("deadline");
    expect(await rawExchange(port, GARBAGE)).toEqual([]); // malformed
    expect(await rawExchange(port, Buffer.alloc(0))).toEqual([]); // idle timeout
    await expectStillServing(port);
  });

  it("an oversized reply whose rejection is also oversized drops the connection", async () => {
    const blob = "x".repeat(200 * 1024);
    const { port } = await startServer({
      handle: (request) =>
        request.payload === "bad"
          ? Promise.resolve({ requestId: request.requestId, blob })
          : echo(request),
      reject: (rejection) => ({ requestId: rejection.request?.requestId ?? null, blob }),
    });
    const client = createRpcClient({ host: HOST, port, secret: SECRET });
    const error = await failureOf(client.call({ requestId: "r1", payload: "bad" }, soon()));
    expect(error.kind).toBe("outcome-unknown");
    expect(error.reason).not.toBe("deadline");
    await expectStillServing(port);
  });
});
