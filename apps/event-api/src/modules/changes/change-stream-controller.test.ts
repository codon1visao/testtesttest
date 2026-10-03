import { EventIdSchema, type EventId } from "@event-desk/contracts";
import { buildSeedEventView } from "@event-desk/contracts/testing";
import { get, type IncomingMessage, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { AppError } from "../../shared/app-error.js";
import { createLogger } from "../../shared/logger.js";
import { ChangeStreamHub } from "./change-stream.js";
import { changeStreamRoutes } from "./change-stream-controller.js";
import { InProcessChangeNotifier } from "./in-process-change-notifier.js";

const E101 = EventIdSchema.parse("E101");
const logger = createLogger("silent");
let server: Server | null = null;

afterEach(async () => {
  const open = server;
  server = null;
  if (open !== null) await new Promise((resolve) => open.close(resolve));
});

async function serve(hub: ChangeStreamHub): Promise<number> {
  const events = {
    get: (eventId: EventId) =>
      eventId === E101
        ? Promise.resolve(buildSeedEventView())
        : Promise.reject(new AppError("EVENT_NOT_FOUND", `Event ${eventId} was not found.`)),
  };
  const app = createApp({
    logger,
    policy: { allowedOrigins: ["http://localhost:5173"], allowedHosts: ["127.0.0.1"] },
    routes: [changeStreamRoutes(hub, events)],
  });
  const listening = app.listen(0, "127.0.0.1");
  server = listening;
  await new Promise((resolve) => listening.once("listening", resolve));
  const address = listening.address();
  if (typeof address !== "object" || address === null) throw new Error("server is not on TCP");
  return address.port;
}

function openStream(port: number, path: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = get(
      { host: "127.0.0.1", port, path, headers: { Accept: "text/event-stream" } },
      resolve,
    );
    req.on("error", reject);
  });
}

describe("changeStreamRoutes (T3 §5)", () => {
  it("opens a stream for a known event and detaches it when the client goes away", async () => {
    const hub = new ChangeStreamHub(new InProcessChangeNotifier(logger));
    const port = await serve(hub);
    const response = await openStream(port, `/api/events/${E101}/changes`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(hub.openCount).toBe(1);
    response.destroy();
    await vi.waitFor(() => {
      expect(hub.openCount).toBe(0);
    });
  });

  it("opens nothing for an unknown event", async () => {
    const hub = new ChangeStreamHub(new InProcessChangeNotifier(logger));
    const port = await serve(hub);
    const response = await openStream(port, "/api/events/E999/changes");
    expect(response.statusCode).toBe(404);
    response.resume();
    expect(hub.openCount).toBe(0);
  });
});
