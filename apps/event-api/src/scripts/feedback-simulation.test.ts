import { describe, expect, it, vi } from "vitest";
import type { SimulateOptions } from "./feedback-simulate-args.js";
import { runSimulation } from "./feedback-simulation.js";

const options: SimulateOptions = {
  count: 3,
  intervalMs: 0,
  texts: ["A.", "B.", "C."],
  apiUrl: "http://127.0.0.1:4999",
  origin: "http://localhost:5173",
  eventId: "E101",
};
const created = (id: string) =>
  new Response(
    JSON.stringify({
      note: { id, text: "A.", receivedAt: "2026-10-04T10:00:00.000Z" },
      automaticBriefing: "scheduled",
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
const deps = (fetch: typeof globalThis.fetch) => ({
  fetch,
  sleep: () => Promise.resolve(),
  newSubmissionId: () => "0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f",
});

describe("runSimulation (F3 script)", () => {
  it("P16: halts at the first rejected note and sends nothing after it", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(created("F09"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "FEEDBACK_LIMIT_REACHED" } }), {
          status: 422,
        }),
      )
      .mockResolvedValue(created("F11"));
    await expect(runSimulation(options, deps(fetch))).rejects.toThrow(
      /Note 2 was rejected with HTTP 422/,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("P16: a connection error names the API URL", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("fetch failed"));
    await expect(runSimulation(options, deps(fetch))).rejects.toThrow(
      "Could not reach the event API at http://127.0.0.1:4999",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
