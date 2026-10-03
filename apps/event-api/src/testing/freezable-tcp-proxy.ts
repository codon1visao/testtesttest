import { once } from "node:events";
import { createConnection, createServer, type Socket } from "node:net";

export interface FreezableTcpProxy {
  /** `host:port` of the proxy, to splice into a URL. */
  readonly address: string;
  /** Stops forwarding in both directions; sockets stay open, so peers see a silent server. */
  freeze(): void;
  /** Delivers what arrived while frozen and forwards again. */
  thaw(): void;
  /** Destroys every socket and stops listening. */
  close(): Promise<void>;
}

/** A loopback TCP proxy that can simulate a stalled server (MySQL that stops answering). */
export async function startFreezableTcpProxy(target: {
  host: string;
  port: number;
}): Promise<FreezableTcpProxy> {
  const sockets = new Set<Socket>();
  const held: { to: Socket; chunk: Buffer }[] = [];
  let frozen = false;

  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
  };
  const forward = (from: Socket, to: Socket) => {
    from.on("data", (chunk: Buffer) => {
      if (frozen) held.push({ to, chunk });
      else to.write(chunk);
    });
    from.on("close", () => to.destroy());
  };

  const server = createServer((client) => {
    const upstream = createConnection(target);
    track(client);
    track(upstream);
    forward(client, upstream);
    forward(upstream, client);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const bound = server.address();
  if (bound === null || typeof bound === "string") throw new Error("proxy has no TCP address");

  return {
    address: `127.0.0.1:${bound.port}`,
    freeze() {
      frozen = true;
    },
    thaw() {
      frozen = false;
      for (const { to, chunk } of held.splice(0)) to.write(chunk);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
