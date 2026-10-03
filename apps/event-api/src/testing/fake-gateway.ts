import { assertNever } from "@event-desk/contracts";
import type { GatewayErrorCode } from "@event-desk/contracts/gateway-rpc";
import { createRpcServer, type RpcMessage } from "@event-desk/tcp-rpc";

export type FakeGatewayReply =
  | { kind: "result"; sections?: unknown; delayMs?: number }
  | { kind: "error"; code: GatewayErrorCode; notSent: boolean; retryAfterMs?: number }
  | { kind: "drop" }
  | { kind: "hold" }
  | { kind: "raw"; message: RpcMessage };

export interface FakeGateway {
  readonly port: number;
  /** Every authenticated request, auth removed, in arrival order. */
  readonly requests: RpcMessage[];
  enqueue(reply: FakeGatewayReply): void;
  /** Lets every held call answer. */
  release(): void;
  close(): Promise<void>;
}

/** A structurally valid candidate for whatever notes the request carried. */
export function minimalSections(request: RpcMessage): unknown {
  const input = request.input as { feedback?: { id: string }[] } | undefined;
  const firstId = input?.feedback?.[0]?.id ?? "F01";
  return {
    feedbackSummary: { text: "Fixture summary of the notes.", sourceIds: [firstId] },
    themes: [],
    conflicts: [],
    suggestions: [],
  };
}

/**
 * A scripted AI Gateway speaking the real tcp-rpc protocol on 127.0.0.1, so integration tests
 * exercise the real client adapter. Replies are consumed in order; the default is a valid result.
 */
export async function startFakeGateway(secret: string): Promise<FakeGateway> {
  const queue: FakeGatewayReply[] = [];
  const requests: RpcMessage[] = [];
  const held: (() => void)[] = [];
  const correlation = (request: RpcMessage) => ({
    requestId: request.requestId ?? null,
    runId: request.runId ?? null,
    attemptId: request.attemptId ?? null,
  });
  const result = (request: RpcMessage, sections: unknown): RpcMessage => ({
    v: 1,
    ok: true,
    ...correlation(request),
    result: {
      sections,
      model: "fake-model",
      promptVersion: "fake-prompt.v1",
      providerRequestId: "resp_fake",
      usage: { inputTokens: 1, outputTokens: 1 },
    },
  });
  const release = () => {
    for (const resume of held.splice(0)) resume();
  };

  const server = createRpcServer({
    secret,
    idleTimeoutMs: 2_000,
    async handle(request) {
      requests.push(request);
      const reply = queue.shift() ?? { kind: "result" };
      switch (reply.kind) {
        case "result":
          if (reply.delayMs !== undefined)
            await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
          return result(request, reply.sections ?? minimalSections(request));
        case "error":
          return {
            v: 1,
            ok: false,
            ...correlation(request),
            error: {
              code: reply.code,
              message: "Fake gateway error.",
              notSent: reply.notSent,
              ...(reply.retryAfterMs === undefined ? {} : { retryAfterMs: reply.retryAfterMs }),
            },
          };
        case "drop":
          throw new Error("fake gateway drops the connection");
        case "hold":
          await new Promise<void>((resolve) => held.push(resolve));
          return result(request, minimalSections(request));
        case "raw":
          return { requestId: request.requestId ?? null, ...reply.message };
        default:
          return assertNever(reply, "fake reply");
      }
    },
    reject: (rejection) => ({
      v: 1,
      ok: false,
      requestId: null,
      runId: null,
      attemptId: null,
      error: {
        code: "GATEWAY_AUTH_FAILED",
        message: `Fake gateway refused: ${rejection.reason}.`,
        notSent: true,
      },
    }),
  });
  const port = await server.listen("127.0.0.1", 0);
  return {
    port,
    requests,
    enqueue: (reply) => queue.push(reply),
    release,
    async close() {
      release();
      await server.close();
    },
  };
}
