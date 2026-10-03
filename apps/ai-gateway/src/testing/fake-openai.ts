import {
  assertNever,
  deriveAttendanceCounts,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { BriefingGenerateV1Input } from "@event-desk/contracts/gateway-rpc";
import type OpenAI from "openai";
import { createOpenAIClient } from "../ai/openai-client.js";

export type FakeReply =
  | { kind: "output"; output: unknown }
  | { kind: "refusal" }
  | { kind: "incomplete" }
  | { kind: "http"; status: number; headers?: Record<string, string> }
  | { kind: "connection-refused" }
  | { kind: "connection-reset" }
  | { kind: "hang" };

export interface FakeOpenAIOptions {
  timeoutMs?: number;
  /**
   * Runs when the SDK reads a successful reply's body, i.e. after the HTTP exchange completed:
   * e.g. to fire a deadline between the provider's answer and the end of the agent run.
   */
  onReplyBodyRead?: () => void;
}

export interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

export function briefingInput(
  overrides: Partial<BriefingGenerateV1Input> = {},
): BriefingGenerateV1Input {
  return {
    event: { id: SUPPLIED_EVENT.id, name: SUPPLIED_EVENT.name, status: SUPPLIED_EVENT.status },
    counts: deriveAttendanceCounts(SUPPLIED_MEMBERS),
    feedback: SUPPLIED_FEEDBACK.map((note) => ({ id: note.id, text: note.text })),
    ...overrides,
  };
}

/** A structurally valid candidate for the supplied notes (it passes validateEvidenceSections). */
export function validSections() {
  return {
    feedbackSummary: {
      text: "Notes describe an enjoyable walk with logistics comments.",
      sourceIds: ["F01", "F08"],
    },
    themes: [{ text: "Requests for more rest-break time.", sourceIds: ["F05", "F06"] }],
    conflicts: [
      {
        text: "One note asks to start earlier; another says that would be difficult.",
        sourceIds: ["F03", "F04"],
      },
    ],
    suggestions: [{ text: "Consider checking the route length.", sourceIds: ["F07"] }],
  };
}

function responseBody(reply: Extract<FakeReply, { kind: "output" | "refusal" | "incomplete" }>) {
  const text = reply.kind === "output" ? JSON.stringify(reply.output) : '{"feedbackSummary":{"te';
  const content =
    reply.kind === "refusal"
      ? [{ type: "refusal", refusal: "I can't help with that." }]
      : [{ type: "output_text", text, annotations: [] }];
  return {
    id: "resp_fake_1",
    object: "response",
    created_at: 1,
    status: reply.kind === "incomplete" ? "incomplete" : "completed",
    incomplete_details: reply.kind === "incomplete" ? { reason: "max_output_tokens" } : null,
    model: "fake-model",
    output: [{ type: "message", id: "msg_1", role: "assistant", status: "completed", content }],
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      total_tokens: 200,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

/** A body that calls `onRead` when the SDK first pulls it (highWaterMark 0: not before). */
function replyBody(
  json: string,
  onRead: (() => void) | undefined,
): string | ReadableStream<Uint8Array> {
  if (onRead === undefined) return json;
  const bytes = new TextEncoder().encode(json);
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        onRead();
        controller.enqueue(bytes);
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * The real OpenAI client and Agents SDK over a fake `fetch`: tests exercise the SDK's actual request
 * mapping and error classes without network access. Replies are consumed in order.
 */
export function createFakeOpenAI(
  replies: FakeReply | FakeReply[],
  options: FakeOpenAIOptions = {},
): { client: OpenAI; requests: CapturedRequest[] } {
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  const requests: CapturedRequest[] = [];
  const fakeFetch = (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    requests.push({
      url: typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
      body: typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {},
    });
    const reply: FakeReply = queue.shift() ?? { kind: "http", status: 500 };
    switch (reply.kind) {
      case "output":
      case "refusal":
      case "incomplete":
        return Promise.resolve(
          new Response(replyBody(JSON.stringify(responseBody(reply)), options.onReplyBodyRead), {
            status: 200,
            headers: { "content-type": "application/json", "x-request-id": "req_fake" },
          }),
        );
      case "http":
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: "fake provider error", type: "fake" } }),
            {
              status: reply.status,
              headers: { "content-type": "application/json", ...reply.headers },
            },
          ),
        );
      case "connection-refused":
        return Promise.reject(
          Object.assign(new TypeError("fetch failed"), {
            cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
          }),
        );
      case "connection-reset":
        return Promise.reject(
          Object.assign(new TypeError("fetch failed"), {
            cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
          }),
        );
      case "hang":
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const reason: unknown = init.signal?.reason;
            reject(reason instanceof Error ? reason : new DOMException("aborted", "AbortError"));
          });
        });
      default:
        return assertNever(reply, "fake reply");
    }
  };
  const client = createOpenAIClient({
    apiKey: "sk-test-fake",
    timeoutMs: options.timeoutMs ?? 10_000,
    fetch: fakeFetch,
  });
  return { client, requests };
}
