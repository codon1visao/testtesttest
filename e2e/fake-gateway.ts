import { createRpcServer, type RpcMessage } from "@event-desk/tcp-rpc";
import { z } from "zod";
import { E2E_GATEWAY_SECRET, E2E_PORTS } from "./e2e-env.js";

/** The part of a `briefing.generate.v1` request the scripted reply depends on. */
const BriefingRequestSchema = z.object({
  lane: z.enum(["interactive", "background"]),
  input: z.object({ feedback: z.array(z.unknown()) }),
});
type Lane = z.infer<typeof BriefingRequestSchema>["lane"];

/**
 * Deterministic sections per request: the theme names the lane and the number of notes read, so a
 * spec can tell a manual run from an automatic batch without depending on a call counter or on the
 * order the specs run in. Only the supplied notes F01-F08 are cited; they are in every input.
 */
function sections(lane: Lane, noteCount: number): unknown {
  return {
    feedbackSummary: {
      text: "Feedback describes the walk as enjoyable, with comments mostly about logistics.",
      sourceIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"],
    },
    themes: [
      {
        text: `Requests for more rest-break time (${lane}, ${String(noteCount)} notes).`,
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
    const { lane, input } = BriefingRequestSchema.parse(request);
    return Promise.resolve({
      v: 1,
      ok: true,
      ...correlation(request),
      result: {
        sections: sections(lane, input.feedback.length),
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
