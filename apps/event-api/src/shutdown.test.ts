import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./shared/logger.js";
import { gracefulShutdown } from "./shutdown.js";

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
