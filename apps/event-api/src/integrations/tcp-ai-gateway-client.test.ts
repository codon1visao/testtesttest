import {
  deriveAttendanceCounts,
  RunIdSchema,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { BriefingCallRequest } from "../ports/ai-gateway-client.js";
import { type FakeGateway, startFakeGateway } from "../testing/fake-gateway.js";
import { silentLogger } from "../testing/test-config.js";
import { TcpAiGatewayClient } from "./tcp-ai-gateway-client.js";

const SECRET = "event-api-test-secret-".padEnd(40, "s");
let gateway: FakeGateway | null = null;

afterEach(async () => {
  await gateway?.close();
  gateway = null;
});

function request(overrides: Partial<BriefingCallRequest> = {}): BriefingCallRequest {
  return {
    runId: RunIdSchema.parse("manual:0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f"),
    attemptId: "1",
    lane: "interactive",
    deadlineAt: new Date(Date.now() + 5_000),
    input: {
      event: { id: SUPPLIED_EVENT.id, name: SUPPLIED_EVENT.name, status: SUPPLIED_EVENT.status },
      counts: deriveAttendanceCounts(SUPPLIED_MEMBERS),
      feedback: SUPPLIED_FEEDBACK.map(({ id, text }) => ({ id, text })),
    },
    ...overrides,
  };
}

async function client() {
  gateway = await startFakeGateway(SECRET);
  return new TcpAiGatewayClient(
    { host: "127.0.0.1", port: gateway.port, secret: SECRET },
    silentLogger,
  );
}

describe("TcpAiGatewayClient", () => {
  it("sends one briefing.generate.v1 envelope and returns the result", async () => {
    const result = await (await client()).generateBriefing(request());
    expect(result.ok).toBe(true);
    expect(gateway?.requests).toHaveLength(1);
    expect(gateway?.requests[0]).toMatchObject({
      v: 1,
      operation: "briefing.generate.v1",
      runId: "manual:0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f",
      attemptId: "1",
      lane: "interactive",
    });
    expect(gateway?.requests[0]).not.toHaveProperty("auth");
  });

  it("passes a Gateway error through with notSent and retryAfterMs", async () => {
    const gatewayClient = await client();
    gateway?.enqueue({
      kind: "error",
      code: "PROVIDER_RATE_LIMITED",
      notSent: false,
      retryAfterMs: 1500,
    });
    expect(await gatewayClient.generateBriefing(request())).toEqual({
      ok: false,
      code: "PROVIDER_RATE_LIMITED",
      notSent: false,
      retryAfterMs: 1500,
    });
  });

  it("F8-06: an unreachable Gateway is GATEWAY_UNAVAILABLE and known not sent", async () => {
    const gatewayClient = await client();
    await gateway?.close();
    gateway = null;
    expect(await gatewayClient.generateBriefing(request())).toEqual({
      ok: false,
      code: "GATEWAY_UNAVAILABLE",
      notSent: true,
    });
  });

  it("F8-07: a connection dropped after sending is AI_OUTCOME_UNKNOWN", async () => {
    const gatewayClient = await client();
    gateway?.enqueue({ kind: "drop" });
    expect(await gatewayClient.generateBriefing(request())).toEqual({
      ok: false,
      code: "AI_OUTCOME_UNKNOWN",
      notSent: false,
    });
  });

  it("F8-05 / F8-08: a reply for another run, or an unreadable reply, is AI_OUTCOME_UNKNOWN", async () => {
    const gatewayClient = await client();
    gateway?.enqueue({
      kind: "raw",
      message: {
        v: 1,
        ok: false,
        requestId: null,
        runId: "manual:someone-else",
        attemptId: "1",
        error: { code: "INTERNAL", message: "x", notSent: false },
      },
    });
    gateway?.enqueue({ kind: "raw", message: { hello: "world" } });
    const unknown = { ok: false, code: "AI_OUTCOME_UNKNOWN", notSent: false };
    expect(await gatewayClient.generateBriefing(request())).toEqual(unknown);
    expect(await gatewayClient.generateBriefing(request())).toEqual(unknown);
  });

  it("passes a wrong-secret refusal through as GATEWAY_AUTH_FAILED, known not sent", async () => {
    gateway = await startFakeGateway(SECRET);
    const wrongSecret = new TcpAiGatewayClient(
      { host: "127.0.0.1", port: gateway.port, secret: "another-secret-".padEnd(40, "x") },
      silentLogger,
    );
    expect(await wrongSecret.generateBriefing(request())).toEqual({
      ok: false,
      code: "GATEWAY_AUTH_FAILED",
      notSent: true,
    });
    expect(gateway.requests).toHaveLength(0);
  });

  it("F8-05: a reply for another attempt of the same run is AI_OUTCOME_UNKNOWN", async () => {
    const gatewayClient = await client();
    const sent = request();
    gateway?.enqueue({
      kind: "raw",
      message: {
        v: 1,
        ok: false,
        runId: sent.runId,
        attemptId: "2",
        error: { code: "INTERNAL", message: "x", notSent: true },
      },
    });
    expect(await gatewayClient.generateBriefing(sent)).toEqual({
      ok: false,
      code: "AI_OUTCOME_UNKNOWN",
      notSent: false,
    });
  });

  it("F8-08: no answer before the deadline is AI_OUTCOME_UNKNOWN", async () => {
    const gatewayClient = await client();
    gateway?.enqueue({ kind: "hold" });
    const started = Date.now();
    expect(
      await gatewayClient.generateBriefing(request({ deadlineAt: new Date(Date.now() + 150) })),
    ).toEqual({ ok: false, code: "AI_OUTCOME_UNKNOWN", notSent: false });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(gateway?.requests).toHaveLength(1);
  });
});
