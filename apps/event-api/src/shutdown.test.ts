import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./shared/logger.js";
import {
  type ApiResources,
  closeApiResources,
  closeApiStores,
  gracefulShutdown,
  stopApiWork,
} from "./shutdown.js";

function setup() {
  const lines: string[] = [];
  const pendingServerClose: (() => void)[] = [];
  const deps = {
    logger: createLogger("info", { write: (chunk: string) => void lines.push(chunk) }),
    server: {
      close: (done: () => void) => {
        pendingServerClose.push(done);
      },
    },
    stopWork: vi.fn(() => Promise.resolve()),
    closeStores: vi.fn(() => Promise.resolve()),
    exit: vi.fn<(code: number) => void>(),
    graceMs: 10_000,
  };
  return { deps, lines, pendingServerClose, shutdown: gracefulShutdown(deps) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("gracefulShutdown", () => {
  it("ignores a second signal instead of closing twice", async () => {
    const { deps, lines, pendingServerClose, shutdown } = setup();
    shutdown("SIGTERM");
    shutdown("SIGINT");
    expect(pendingServerClose).toHaveLength(1);
    pendingServerClose[0]?.();
    await vi.waitFor(() => {
      expect(deps.exit).toHaveBeenCalledWith(0);
    });
    expect(deps.stopWork).toHaveBeenCalledTimes(1);
    expect(deps.closeStores).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(lines.join("")).toContain("already shutting down");
  });

  it("exits with 1 when closing outlasts the grace period", () => {
    vi.useFakeTimers();
    const { deps, shutdown } = setup();
    shutdown("SIGTERM");
    vi.advanceTimersByTime(deps.graceMs);
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("exits with 1 when closing the stores fails", async () => {
    const { deps, pendingServerClose, shutdown } = setup();
    deps.closeStores.mockRejectedValueOnce(new Error("close failed"));
    shutdown("SIGTERM");
    pendingServerClose[0]?.();
    await vi.waitFor(() => {
      expect(deps.exit).toHaveBeenCalledWith(1);
    });
  });

  it("stops the API's work (streams, batch queue, manual drain) before closing the HTTP server", () => {
    const order: string[] = [];
    const { deps } = setup();
    const shutdown = gracefulShutdown({
      ...deps,
      stopWork: () => {
        order.push("work");
        return Promise.resolve();
      },
      server: { close: () => order.push("server") },
    });
    shutdown("SIGTERM");
    expect(order).toEqual(["work", "server"]);
  });

  it("closes the stores only after both the work and the HTTP server have stopped", async () => {
    const { deps, pendingServerClose, shutdown } = setup();
    let finishWork: () => void = () => undefined;
    deps.stopWork.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishWork = resolve;
      }),
    );
    shutdown("SIGTERM");
    pendingServerClose[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(deps.closeStores).not.toHaveBeenCalled();
    finishWork();
    await vi.waitFor(() => {
      expect(deps.exit).toHaveBeenCalledWith(0);
    });
    expect(deps.closeStores).toHaveBeenCalledTimes(1);
  });

  it("F1: a held HTTP request does not delay the batch queue close; the stores wait for both", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    let closing = false;
    const resources: ApiResources = {
      logger: createLogger("silent"),
      stopStreams: () => void order.push("streams"),
      closeBatchQueue: () => {
        closing = true; // the queue's flag is set synchronously at the start of close()
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push("queue");
            resolve();
          }, 5_000);
        });
      },
      whenManualIdle: () => Promise.resolve(),
      manualDrainMs: 8_000,
      closeRedis: () => void order.push("redis"),
      closeDatabase: () => {
        order.push("database");
        return Promise.resolve();
      },
    };
    const { deps } = setup();
    let httpClosed: () => void = () => undefined;
    const shutdown = gracefulShutdown({
      ...deps,
      // A manual Generate holds the server open: close() does not call back yet.
      server: {
        close: (done: () => void) => {
          httpClosed = done;
        },
      },
      stopWork: () => stopApiWork(resources),
      closeStores: () => closeApiStores(resources),
    });
    shutdown("SIGTERM");
    expect(closing).toBe(true);
    expect(order).toEqual(["streams"]);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(order).toEqual(["streams"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual(["streams", "queue"]);
    // The queue and drain are done, but the HTTP server is still open: the stores stay open.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(order).toEqual(["streams", "queue"]);
    httpClosed();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["streams", "queue", "redis", "database"]);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});

describe("closeApiResources (T3 §10)", () => {
  const after = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  function resources(overrides: {
    closeBatchQueue?: () => Promise<void>;
    whenManualIdle?: () => Promise<void>;
  }) {
    const order: string[] = [];
    const lines: string[] = [];
    return {
      order,
      lines,
      value: {
        logger: createLogger("info", { write: (chunk: string) => void lines.push(chunk) }),
        stopStreams: () => void order.push("streams"),
        closeBatchQueue: overrides.closeBatchQueue ?? (() => Promise.resolve()),
        whenManualIdle: overrides.whenManualIdle ?? (() => Promise.resolve()),
        closeRedis: () => void order.push("redis"),
        closeDatabase: () => {
          order.push("database");
          return Promise.resolve();
        },
        manualDrainMs: 8_000,
      },
    };
  }

  it("closes the batch queue and drains manual runs in parallel, within the grace period", async () => {
    vi.useFakeTimers();
    const r = resources({
      closeBatchQueue: () => after(5_000).then(() => void r.order.push("queue")),
      whenManualIdle: () => after(6_000).then(() => void r.order.push("manual")),
    });
    let closed = false;
    void closeApiResources(r.value).then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(closed).toBe(true);
    expect(r.order).toEqual(["streams", "queue", "manual", "redis", "database"]);
  });

  it("stops waiting for manual runs after the drain bound", async () => {
    vi.useFakeTimers();
    const r = resources({ whenManualIdle: () => new Promise<void>(() => undefined) });
    let closed = false;
    void closeApiResources(r.value).then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(closed).toBe(true);
    expect(r.order).toEqual(["streams", "redis", "database"]);
  });

  it("P14: warns when the manual drain bound expires", async () => {
    vi.useFakeTimers();
    const r = resources({ whenManualIdle: () => new Promise<void>(() => undefined) });
    void closeApiResources(r.value);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(r.lines.join("")).toContain("manual generations still running at shutdown");
  });

  it("does not warn when manual runs drain in time", async () => {
    const r = resources({});
    await closeApiResources(r.value);
    expect(r.lines.join("")).not.toContain("manual generations still running");
  });

  it("still closes the stores when the batch queue fails to close, and logs it", async () => {
    const r = resources({ closeBatchQueue: () => Promise.reject(new Error("queue close failed")) });
    await closeApiResources(r.value);
    expect(r.order).toEqual(["streams", "redis", "database"]);
    expect(r.lines.join("")).toContain("batch queue did not close cleanly");
  });
});
