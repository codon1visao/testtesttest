import { Writable } from "node:stream";
import {
  BRIEFING_GENERATE_V1,
  type BriefingGenerateV1Result,
  BriefingGenerateV1ResponseSchema,
  GeneratedSectionsWireSchema,
} from "@event-desk/contracts/gateway-rpc";
import { createRpcClient, type RpcServer } from "@event-desk/tcp-rpc";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../shared/logger.js";
import { briefingInput, validSections } from "../testing/fake-openai.js";
import { createGatewayRpcServer } from "./rpc-server.js";

const SECRET = "transport-test-secret-".padEnd(40, "t");
const LEAKED_TEXT = "model text that must never be logged ".repeat(30);
const servers: RpcServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function start(
  result: BriefingGenerateV1Result,
  onCall: (lines: string[]) => void = () => undefined,
) {
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
  const server = createGatewayRpcServer({
    secret: SECRET,
    briefingGenerateV1: () => {
      onCall(lines);
      return Promise.resolve(result);
    },
    logger,
  });
  servers.push(server);
  const port = await server.listen("127.0.0.1", 0);
  const deadlineAt = new Date(Date.now() + 5_000);
  const raw = await createRpcClient({ host: "127.0.0.1", port, secret: SECRET }).call(
    {
      v: 1,
      operation: BRIEFING_GENERATE_V1,
      requestId: "req-1",
      runId: "run-1",
      attemptId: "1",
      lane: "interactive",
      deadlineAt: deadlineAt.toISOString(),
      input: briefingInput(),
    },
    deadlineAt,
  );
  return { response: BriefingGenerateV1ResponseSchema.parse(raw), lines };
}

const sections = GeneratedSectionsWireSchema.parse(validSections());
const goodResult: BriefingGenerateV1Result = {
  sections,
  model: "gpt-test",
  promptVersion: "briefing-v1",
  providerRequestId: "resp_1",
  usage: { inputTokens: 10, outputTokens: 5 },
};

describe("Gateway RPC edge: success replies are validated before they leave (F8)", () => {
  it("answers a contract-valid result as a success", async () => {
    const { response } = await start(goodResult);
    expect(response).toMatchObject({ ok: true, requestId: "req-1", result: goodResult });
  });

  it("answers OUTPUT_INVALID (notSent: false) for a result that breaks the contract", async () => {
    const { response, lines } = await start({
      ...goodResult,
      model: "",
      sections: {
        ...sections,
        themes: [{ text: LEAKED_TEXT, sourceIds: sections.feedbackSummary.sourceIds }],
      },
    });
    expect(response).toMatchObject({
      ok: false,
      requestId: "req-1",
      runId: "run-1",
      attemptId: "1",
      error: { code: "OUTPUT_INVALID", notSent: false },
    });
    const log = lines.join("");
    expect(log).toContain('"level":50'); // pino's error level
    expect(log).toContain('"outcome":"OUTPUT_INVALID"');
    expect(log).toContain("sections.themes.0.text");
    expect(log).not.toContain(LEAKED_TEXT.trim());
    expect(log).not.toContain('"outcome":"ok"');
  });
});

describe("Gateway RPC edge: logging", () => {
  it("logs the request's arrival before the operation runs, with metadata only", async () => {
    let atCall = "";
    const { lines } = await start(goodResult, (current) => {
      atCall = current.join("");
    });
    expect(atCall).toContain("briefing request received");
    const received = lines.find((line) => line.includes("briefing request received")) ?? "";
    expect(JSON.parse(received)).toMatchObject({
      level: 30,
      requestId: "req-1",
      runId: "run-1",
      attemptId: "1",
      operation: BRIEFING_GENERATE_V1,
      lane: "interactive",
      feedbackCount: briefingInput().feedback.length,
    });
    for (const note of briefingInput().feedback) expect(received).not.toContain(note.text);
  });
});
