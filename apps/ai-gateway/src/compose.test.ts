import { Writable } from "node:stream";
import {
  BriefingGenerateV1ResponseSchema,
  type BriefingGenerateV1Response,
} from "@event-desk/contracts/gateway-rpc";
import { createRpcClient } from "@event-desk/tcp-rpc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAIBriefingModel } from "./ai/openai-briefing-model.js";
import { composeGateway, type Gateway } from "./compose.js";
import type { GatewayConfig } from "./config/env.js";
import type { BriefingModel } from "./operations/briefing-model.js";
import { createLogger } from "./shared/logger.js";
import {
  briefingInput,
  createFakeOpenAI,
  type FakeReply,
  validSections,
} from "./testing/fake-openai.js";

const SECRET = "compose-test-secret-".padEnd(40, "z");
const CONFIG: GatewayConfig = {
  host: "127.0.0.1",
  port: 0,
  serviceSecret: SECRET,
  provider: null, // the tests inject the model
  maxCallMs: 10_000,
  responseMarginMs: 300,
  dailyCallLimit: 10,
  logLevel: "info",
};
const gateways: Gateway[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

async function start(replies: FakeReply | FakeReply[] | null) {
  const lines: string[] = [];
  const logger = createLogger(
    "info",
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString("utf8"));
        done();
      },
    }),
  );
  const fake = replies === null ? null : createFakeOpenAI(replies);
  const briefingModel: BriefingModel | null =
    fake === null
      ? null
      : createOpenAIBriefingModel(fake.client, {
          model: "gpt-test",
          maxOutputTokens: 4000,
          reasoningEffort: undefined,
        });
  const gateway = composeGateway(CONFIG, { logger, briefingModel });
  gateways.push(gateway);
  const port = await gateway.listen();
  return { port, lines, requests: fake?.requests ?? [] };
}

let sequence = 0;
function request(overrides: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    v: 1,
    operation: "briefing.generate.v1",
    requestId: `req-${sequence}`,
    runId: "run-1",
    attemptId: "1",
    lane: "interactive",
    deadlineAt: new Date(Date.now() + 5_000).toISOString(),
    input: briefingInput(),
    ...overrides,
  };
}

async function call(
  port: number,
  body: ReturnType<typeof request>,
  secret = SECRET,
): Promise<BriefingGenerateV1Response> {
  const client = createRpcClient({ host: "127.0.0.1", port, secret });
  const deadline = new Date(Date.parse(body.deadlineAt) + 1_000);
  return BriefingGenerateV1ResponseSchema.parse(await client.call(body, deadline));
}

function errorOf(response: BriefingGenerateV1Response) {
  if (response.ok) throw new Error("expected an error response");
  return response.error;
}

describe("AI Gateway over TCP", () => {
  it("F8-10: answers a valid request with correlated, validated sections", async () => {
    const { port, requests } = await start({ kind: "output", output: validSections() });
    const response = await call(port, request({ requestId: "req-ok" }));
    expect(response).toMatchObject({
      ok: true,
      requestId: "req-ok",
      runId: "run-1",
      attemptId: "1",
    });
    expect(response.ok && response.result.sections).toEqual(validSections());
    expect(requests).toHaveLength(1);
  });

  it("S1-11: a wrong secret is refused before validation or any provider call", async () => {
    const { port, requests } = await start({ kind: "output", output: validSections() });
    const error = errorOf(await call(port, request(), `${SECRET}-wrong`));
    expect([error.code, error.notSent]).toEqual(["GATEWAY_AUTH_FAILED", true]);
    expect(requests).toHaveLength(0);
  });

  it("F8-03 / S1-11: rejects an unknown operation, override fields and malformed counts", async () => {
    const { port, requests } = await start({ kind: "output", output: validSections() });
    const bad = [
      request({ operation: "briefing.generate.v9" }),
      request({ model: "gpt-x" }),
      request({
        input: {
          ...briefingInput(),
          counts: { registered: 9, attended: 0, absent: 0, notRecorded: 0 },
        },
      }),
    ];
    for (const body of bad) {
      const response = await call(port, body);
      expect(response).toMatchObject({ ok: false, requestId: body.requestId });
      expect([errorOf(response).code, errorOf(response).notSent]).toEqual([
        "VALIDATION_FAILED",
        true,
      ]);
    }
    expect(requests).toHaveLength(0);
  });

  it("Review Focus 5: answers PROVIDER_NOT_CONFIGURED without a key", async () => {
    const { port } = await start(null);
    const error = errorOf(await call(port, request()));
    expect([error.code, error.notSent]).toEqual(["PROVIDER_NOT_CONFIGURED", true]);
  });

  it("Review Focus 3: a model slower than the deadline is aborted and answered in time", async () => {
    const { port } = await start({ kind: "hang" });
    const deadlineAt = new Date(Date.now() + 1_500);
    const response = await call(port, request({ deadlineAt: deadlineAt.toISOString() }));
    expect(errorOf(response).code).toBe("DEADLINE_EXCEEDED");
    expect(Date.now()).toBeLessThan(deadlineAt.getTime());
  });

  it("Review Focus 4 / F8-11: one call per lane; background runs beside a busy interactive lane", async () => {
    const { port, requests } = await start([
      { kind: "hang" },
      { kind: "output", output: validSections() },
    ]);
    const slow = call(port, request({ deadlineAt: new Date(Date.now() + 1_500).toISOString() }));
    // The hanging call holds the interactive lane once its provider request is in flight.
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    const second = errorOf(await call(port, request()));
    expect([second.code, second.notSent]).toEqual(["GATEWAY_UNAVAILABLE", true]);
    const background = await call(port, request({ lane: "background" }));
    expect(background.ok).toBe(true);
    expect(errorOf(await slow).code).toBe("DEADLINE_EXCEEDED");
  });

  it("F8-11: an interactive call runs beside a busy background lane", async () => {
    const { port, requests } = await start([
      { kind: "hang" },
      { kind: "output", output: validSections() },
    ]);
    const slow = call(
      port,
      request({ lane: "background", deadlineAt: new Date(Date.now() + 1_500).toISOString() }),
    );
    await vi.waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    const busy = errorOf(await call(port, request({ lane: "background" })));
    expect([busy.code, busy.notSent]).toEqual(["GATEWAY_UNAVAILABLE", true]);
    const interactive = await call(port, request({ lane: "interactive" }));
    expect(interactive.ok && interactive.result.sections).toEqual(validSections());
    expect(errorOf(await slow).code).toBe("DEADLINE_EXCEEDED");
  });

  it("F4/P17: an evidence rejection logs each issue's section, index and code only", async () => {
    const output = {
      ...validSections(),
      themes: [{ text: "A theme about the meeting point.", sourceIds: ["F05"] }],
    };
    const { port, lines } = await start({ kind: "output", output });
    expect(errorOf(await call(port, request())).code).toBe("OUTPUT_INVALID");
    const failed = lines.find((line) => line.includes('"msg":"briefing failed"'));
    expect(failed).toBeDefined();
    const entry: unknown = JSON.parse(failed ?? "{}");
    expect(entry).toMatchObject({
      outcome: "OUTPUT_INVALID",
      evidenceIssues: [{ section: "themes", index: 0, code: "TOO_FEW_SOURCES" }],
    });
    // Metadata only: no item text, no issue message, no source IDs.
    expect(failed).not.toContain("meeting point");
    expect(failed).not.toContain("message");
    expect(failed).not.toContain("F05");
  });

  it("S1-08: logs carry metadata only — no notes, model output or secret", async () => {
    const { port, lines } = await start([
      { kind: "output", output: validSections() },
      { kind: "refusal" },
    ]);
    await call(port, request());
    await call(port, request());
    const log = lines.join("");
    expect(log).toContain('"outcome":"ok"');
    expect(log).toContain('"outcome":"PROVIDER_REFUSED"');
    for (const forbidden of [SECRET, "meeting point", "rest-break time", "can't help"]) {
      expect(log).not.toContain(forbidden);
    }
  });
});
