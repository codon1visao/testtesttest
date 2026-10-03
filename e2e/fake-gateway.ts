import { createRpcServer, type RpcMessage } from "@event-desk/tcp-rpc";
import { E2E_GATEWAY_SECRET, E2E_PORTS } from "./e2e-env.js";

let calls = 0;

/** Deterministic sections for the supplied notes; each call's theme wording is distinct. */
function sections(call: number): unknown {
  return {
    feedbackSummary: {
      text: "Feedback describes the walk as enjoyable, with comments mostly about logistics.",
      sourceIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"],
    },
    themes: [
      {
        text: `Requests for more rest-break time (run ${String(call)}).`,
        sourceIds: ["F05", "F06"],
      },
    ],
    conflicts: [
      {
        text: "One note found the meeting point hard to find; another had no trouble.",
        sourceIds: ["F01", "F02"],
      },
      {
        text: "One note asks for an earlier start; another says it would be difficult.",
        sourceIds: ["F03", "F04"],
      },
    ],
    suggestions: [{ text: "Consider reviewing the route length.", sourceIds: ["F07"] }],
  };
}

const correlation = (request: RpcMessage) => ({
  requestId: request.requestId ?? null,
  runId: request.runId ?? null,
  attemptId: request.attemptId ?? null,
});

const server = createRpcServer({
  secret: E2E_GATEWAY_SECRET,
  idleTimeoutMs: 2_000,
  handle(request) {
    calls += 1;
    return Promise.resolve({
      v: 1,
      ok: true,
      ...correlation(request),
      result: {
        sections: sections(calls),
        model: "e2e-fake-model",
        promptVersion: "e2e.v1",
        providerRequestId: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });
  },
  reject: (rejection) => ({
    v: 1,
    ok: false,
    requestId: null,
    runId: null,
    attemptId: null,
    error: {
      code: "GATEWAY_AUTH_FAILED",
      message: `E2E gateway refused: ${rejection.reason}.`,
      notSent: true,
    },
  }),
});

await server.listen("127.0.0.1", E2E_PORTS.gateway);
process.stdout.write(`e2e fake gateway listening on 127.0.0.1:${String(E2E_PORTS.gateway)}\n`);
const stop = () => {
  void server.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
