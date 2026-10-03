import type { BriefingGenerateV1Request } from "@event-desk/contracts/gateway-rpc";
import { describe, expect, it } from "vitest";
import { LaneGate } from "../limits/lane-gate.js";
import { UsageBackstop } from "../limits/usage-backstop.js";
import { GatewayError } from "../shared/gateway-error.js";
import { briefingInput, validSections } from "../testing/fake-openai.js";
import type { BriefingModel, BriefingModelOutput } from "./briefing-model.js";
import { type BriefingGenerateV1Deps, createBriefingGenerateV1 } from "./briefing-generate-v1.js";

const inMs = (ms: number) => new Date(Date.now() + ms).toISOString();

function request(overrides: Partial<BriefingGenerateV1Request> = {}): BriefingGenerateV1Request {
  return {
    v: 1,
    operation: "briefing.generate.v1",
    requestId: "req-1",
    runId: "run-1",
    attemptId: "1",
    lane: "interactive",
    deadlineAt: inMs(5_000),
    input: briefingInput(),
    ...overrides,
  };
}

function fakeModel(behaviour: (signal: AbortSignal) => Promise<BriefingModelOutput>) {
  const calls: AbortSignal[] = [];
  const model: BriefingModel = {
    model: "gpt-test",
    promptVersion: "briefing.v1.test",
    generate: (_input, signal) => {
      calls.push(signal);
      return behaviour(signal);
    },
  };
  return { model, calls };
}

const succeed =
  (sections: unknown = validSections()) =>
  () =>
    Promise.resolve({
      sections,
      providerRequestId: "resp_1",
      usage: { inputTokens: 10, outputTokens: 5 },
    } as BriefingModelOutput);

/** Resolves only when aborted, then throws the error the real adapter maps an abort to. */
const hang = (signal: AbortSignal) =>
  new Promise<BriefingModelOutput>((_, reject) => {
    signal.addEventListener("abort", () => {
      reject(
        new GatewayError("DEADLINE_EXCEEDED", "The model did not answer before the deadline.", {
          notSent: false,
        }),
      );
    });
  });

function operation(model: BriefingModel | null, overrides: Partial<BriefingGenerateV1Deps> = {}) {
  return createBriefingGenerateV1({
    model,
    lanes: new LaneGate(),
    backstop: new UsageBackstop(10, () => new Date()),
    now: () => new Date(),
    maxCallMs: 60_000,
    responseMarginMs: 100,
    ...overrides,
  });
}

async function gatewayErrorOf(promise: Promise<unknown>): Promise<GatewayError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GatewayError) return error;
    throw error;
  }
  throw new Error("expected a GatewayError");
}

describe("briefing.generate.v1", () => {
  it("returns the validated sections with model, prompt version and usage", async () => {
    const { model } = fakeModel(succeed());
    expect(await operation(model)(request())).toEqual({
      sections: validSections(),
      model: "gpt-test",
      promptVersion: "briefing.v1.test",
      providerRequestId: "resp_1",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("Review Focus 5: without a provider it answers PROVIDER_NOT_CONFIGURED and never fabricates output", async () => {
    const error = await gatewayErrorOf(operation(null)(request()));
    expect([error.code, error.notSent]).toEqual(["PROVIDER_NOT_CONFIGURED", true]);
  });

  it("refuses a request that arrives too close to its deadline, before any provider call", async () => {
    const { model, calls } = fakeModel(succeed());
    const error = await gatewayErrorOf(operation(model)(request({ deadlineAt: inMs(50) })));
    expect([error.code, error.notSent]).toEqual(["DEADLINE_EXCEEDED", true]);
    expect(calls).toHaveLength(0);
  });

  it("S1: caps a far deadline at its own ceiling and aborts the model before it", async () => {
    const { model } = fakeModel(hang);
    const started = Date.now();
    const error = await gatewayErrorOf(
      operation(model, { maxCallMs: 400, responseMarginMs: 100 })(
        request({ deadlineAt: inMs(3_600_000) }),
      ),
    );
    expect(error.code).toBe("DEADLINE_EXCEEDED");
    expect(Date.now() - started).toBeLessThan(600);
  });

  it("F8-11 / Review Focus 4: one call per lane; a background call never blocks an interactive one", async () => {
    const { model } = fakeModel(hang);
    const generate = operation(model, { maxCallMs: 400 });
    const first = generate(request({ deadlineAt: inMs(300) }));
    const second = await gatewayErrorOf(generate(request({ requestId: "req-2" })));
    expect([second.code, second.notSent]).toEqual(["GATEWAY_UNAVAILABLE", true]);

    const background = generate(
      request({ requestId: "req-3", lane: "background", deadlineAt: inMs(300) }),
    );
    await expect(first).rejects.toBeInstanceOf(GatewayError);
    await expect(background).rejects.toBeInstanceOf(GatewayError); // ran (and timed out) beside the busy lane
  });

  it("releases the lane after a failure", async () => {
    const lanes = new LaneGate();
    const failing = fakeModel(() =>
      Promise.reject(new GatewayError("PROVIDER_TEMPORARY", "x", { notSent: false })),
    );
    await gatewayErrorOf(operation(failing.model, { lanes })(request()));
    expect(lanes.tryEnter("interactive")).not.toBeNull();
  });

  it("stops at the daily backstop; a busy-lane refusal does not consume budget", async () => {
    const backstop = new UsageBackstop(1, () => new Date());
    const lanes = new LaneGate();
    const release = lanes.tryEnter("interactive");
    await gatewayErrorOf(operation(fakeModel(succeed()).model, { backstop, lanes })(request()));
    release?.();

    const { model } = fakeModel(succeed());
    const generate = operation(model, { backstop, lanes });
    await generate(request());
    const error = await gatewayErrorOf(generate(request({ requestId: "req-2" })));
    expect([error.code, error.notSent]).toEqual(["DAILY_LIMIT_REACHED", true]);
  });

  it("F4-12 / F4-15: rejects a theme or conflict with fewer than two distinct notes", async () => {
    const singleTheme = {
      ...validSections(),
      themes: [{ text: "Rest breaks.", sourceIds: ["F05", "F05"] }],
    };
    const oneSidedConflict = {
      ...validSections(),
      conflicts: [{ text: "Start time.", sourceIds: ["F03"] }],
    };
    for (const sections of [singleTheme, oneSidedConflict]) {
      const { model } = fakeModel(succeed(sections));
      const error = await gatewayErrorOf(operation(model)(request()));
      expect([error.code, error.notSent]).toEqual(["OUTPUT_INVALID", false]);
    }
  });
});
