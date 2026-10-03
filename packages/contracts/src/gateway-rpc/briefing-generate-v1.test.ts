import { describe, expect, it } from "vitest";
import { deriveAttendanceCounts } from "../attendance.js";
import { ERROR_CODES } from "../api/errors.js";
import { SUPPLIED_EVENT, SUPPLIED_FEEDBACK, SUPPLIED_MEMBERS } from "../supplied-records.js";
import {
  BRIEFING_GENERATE_V1,
  BriefingGenerateV1RequestSchema,
  BriefingGenerateV1ResponseSchema,
  GATEWAY_ERROR_CODES,
  GATEWAY_INPUT_LIMITS,
  GatewayRequestHeaderSchema,
  GeneratedSectionsWireSchema,
  utf8ByteLength,
} from "./index.js";

const input = {
  event: { id: SUPPLIED_EVENT.id, name: SUPPLIED_EVENT.name, status: SUPPLIED_EVENT.status },
  counts: deriveAttendanceCounts(SUPPLIED_MEMBERS),
  feedback: SUPPLIED_FEEDBACK.map((note) => ({ id: note.id, text: note.text })),
};
const request = {
  v: 1,
  operation: BRIEFING_GENERATE_V1,
  requestId: "req-1",
  runId: "0192a5b0-0000-7000-8000-000000000001",
  attemptId: "1",
  lane: "interactive",
  deadlineAt: "2026-10-03T10:00:00.000Z",
  input,
};

describe("BriefingGenerateV1RequestSchema", () => {
  it("accepts the supplied records as a request", () => {
    expect(BriefingGenerateV1RequestSchema.safeParse(request).success).toBe(true);
  });

  it("S1-11: rejects caller overrides such as a model, prompt or tools", () => {
    for (const extra of [{ model: "gpt-x" }, { prompt: "say hi" }, { tools: [] }]) {
      expect(BriefingGenerateV1RequestSchema.safeParse({ ...request, ...extra }).success).toBe(
        false,
      );
      expect(
        BriefingGenerateV1RequestSchema.safeParse({ ...request, input: { ...input, ...extra } })
          .success,
      ).toBe(false);
    }
  });

  it("rejects member names and the auth field (tcp-rpc strips auth before validation)", () => {
    expect(BriefingGenerateV1RequestSchema.safeParse({ ...request, auth: "secret" }).success).toBe(
      false,
    );
    const withNames = { ...input, members: SUPPLIED_MEMBERS };
    expect(
      BriefingGenerateV1RequestSchema.safeParse({ ...request, input: withNames }).success,
    ).toBe(false);
  });

  it("F8-03: rejects counts that do not add up, an unknown lane or an unknown operation", () => {
    const badCounts = {
      ...input,
      counts: { registered: 4, attended: 4, absent: 1, notRecorded: 0 },
    };
    expect(
      BriefingGenerateV1RequestSchema.safeParse({ ...request, input: badCounts }).success,
    ).toBe(false);
    expect(BriefingGenerateV1RequestSchema.safeParse({ ...request, lane: "urgent" }).success).toBe(
      false,
    );
    expect(
      BriefingGenerateV1RequestSchema.safeParse({ ...request, operation: "briefing.generate.v2" })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate note IDs and an empty note set", () => {
    const duplicate = { ...input, feedback: [...input.feedback, input.feedback[0]] };
    expect(
      BriefingGenerateV1RequestSchema.safeParse({ ...request, input: duplicate }).success,
    ).toBe(false);
    expect(
      BriefingGenerateV1RequestSchema.safeParse({ ...request, input: { ...input, feedback: [] } })
        .success,
    ).toBe(false);
  });

  it("rejects source data over 32 KiB instead of truncating it (S1-07)", () => {
    const big = Array.from({ length: 40 }, (_, i) => ({
      id: `F${String(i + 1).padStart(2, "0")}`,
      text: "a".repeat(1000),
    }));
    expect(utf8ByteLength(JSON.stringify(big))).toBeGreaterThan(
      GATEWAY_INPUT_LIMITS.maxSourceBytes,
    );
    expect(
      BriefingGenerateV1RequestSchema.safeParse({ ...request, input: { ...input, feedback: big } })
        .success,
    ).toBe(false);
  });

  it("counts UTF-8 bytes, not UTF-16 code units", () => {
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("🙂")).toBe(4);
  });
});

describe("GatewayRequestHeaderSchema", () => {
  it("reads correlation IDs even when the operation is unknown", () => {
    const header = GatewayRequestHeaderSchema.safeParse({ ...request, operation: "other.v9" });
    expect(header.success && header.data.requestId).toBe("req-1");
  });
});

describe("BriefingGenerateV1ResponseSchema", () => {
  const correlation = { requestId: "req-1", runId: request.runId, attemptId: "1" };

  it("accepts a success with sections and sanitised metadata", () => {
    const ok = {
      v: 1,
      ok: true,
      ...correlation,
      result: {
        sections: {
          feedbackSummary: { text: "Walk enjoyed.", sourceIds: ["F01"] },
          themes: [{ text: "Rest breaks.", sourceIds: ["F05", "F06"] }],
          conflicts: [],
          suggestions: [],
        },
        model: "gpt-x",
        promptVersion: "briefing-v1",
        providerRequestId: "resp_1",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    };
    expect(BriefingGenerateV1ResponseSchema.safeParse(ok).success).toBe(true);
  });

  it("accepts an error without correlation (a frame that could not be read)", () => {
    const error = {
      v: 1,
      ok: false,
      requestId: null,
      runId: null,
      attemptId: null,
      error: {
        code: "VALIDATION_FAILED",
        message: "The request could not be read.",
        notSent: true,
      },
    };
    expect(BriefingGenerateV1ResponseSchema.safeParse(error).success).toBe(true);
  });

  it("rejects an error code outside the Gateway set", () => {
    const error = {
      v: 1,
      ok: false,
      ...correlation,
      error: { code: "ATTENDANCE_CONFLICT", message: "x", notSent: true },
    };
    expect(BriefingGenerateV1ResponseSchema.safeParse(error).success).toBe(false);
  });
});

describe("GeneratedSectionsWireSchema", () => {
  const sections = {
    feedbackSummary: { text: "Walk enjoyed.", sourceIds: ["F01"] },
    themes: [{ text: "Rest breaks.", sourceIds: ["F05", "F06"] }],
    conflicts: [],
    suggestions: [],
  };

  it("is the briefing content without the backend-owned attendance overview", () => {
    expect(GeneratedSectionsWireSchema.safeParse(sections).success).toBe(true);
    expect(
      GeneratedSectionsWireSchema.safeParse({ ...sections, attendanceOverview: "12 attended." })
        .success,
    ).toBe(false);
    expect(GeneratedSectionsWireSchema.safeParse({ ...sections, extra: [] }).success).toBe(false);
  });

  it("keeps the briefing content's section limits", () => {
    const tooMany = Array.from({ length: 11 }, () => ({ text: "x", sourceIds: ["F01"] }));
    expect(GeneratedSectionsWireSchema.safeParse({ ...sections, themes: tooMany }).success).toBe(
      false,
    );
  });
});

describe("GATEWAY_ERROR_CODES", () => {
  it("is a subset of the application error codes", () => {
    const all = new Set<string>(ERROR_CODES);
    expect(GATEWAY_ERROR_CODES.filter((code) => !all.has(code))).toEqual([]);
  });
});
