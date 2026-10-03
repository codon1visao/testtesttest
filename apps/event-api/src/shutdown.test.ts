import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./shared/logger.js";
import { closeApiResources, gracefulShutdown } from "./shutdown.js";

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
    closeApi: vi.fn(() => Promise.resolve()),
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
    expect(deps.closeApi).toHaveBeenCalledTimes(1);
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
    deps.closeApi.mockRejectedValueOnce(new Error("close failed"));
    shutdown("SIGTERM");
    pendingServerClose[0]?.();
    await vi.waitFor(() => {
      expect(deps.exit).toHaveBeenCalledWith(1);
    });
  });

  it("ends live streams before closing the HTTP server", () => {
    const order: string[] = [];
    const { deps } = setup();
    const shutdown = gracefulShutdown({
      ...deps,
      beforeClose: () => order.push("streams"),
      server: { close: () => order.push("server") },
    });
    shutdown("SIGTERM");
    expect(order).toEqual(["streams", "server"]);
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

  it("still closes the stores when the batch queue fails to close, and logs it", async () => {
    const r = resources({ closeBatchQueue: () => Promise.reject(new Error("queue close failed")) });
    await closeApiResources(r.value);
    expect(r.order).toEqual(["streams", "redis", "database"]);
    expect(r.lines.join("")).toContain("batch queue did not close cleanly");
  });
});
