import { describe, expect, it } from "vitest";
import { computeFreshness } from "../freshness.js";
import {
  SUPPLIED_FEEDBACK,
  SUPPLIED_FEEDBACK_DIGEST,
  SUPPLIED_MEMBERS,
} from "../supplied-records.js";
import { buildBriefingView, buildSeedEventView } from "../testing/index.js";
import { SaveAttendanceRequestSchema } from "./attendance-api.js";
import { SaveBriefingRequestSchema, SelectPreviewRequestSchema } from "./briefing-api.js";
import {
  EventChangedMessageSchema,
  EventViewSchema,
  GenerationStatusViewSchema,
} from "./event-view.js";
import { SubmitFeedbackRequestSchema } from "./feedback-api.js";
import { GenerateBriefingRequestSchema } from "./generation-api.js";

const GENERATION_ID = "0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f";

describe("EventView", () => {
  it("builds a briefing whose recorded freshness matches the supplied records", () => {
    const view = buildBriefingView();
    const recomputed = computeFreshness(view.provenance.input, {
      members: SUPPLIED_MEMBERS,
      feedbackIds: SUPPLIED_FEEDBACK.map((note) => note.id),
      feedbackDigest: SUPPLIED_FEEDBACK_DIGEST,
    });
    expect(view.freshness.current).toBe(true);
    expect(recomputed.current).toBe(true);
  });

  it("parses the seeded view (F1-01) and a view with a briefing", () => {
    expect(buildSeedEventView().counts).toEqual({
      registered: 4,
      attended: 1,
      absent: 2,
      notRecorded: 1,
    });
    const withBriefing = buildSeedEventView({ incomingPreview: buildBriefingView() });
    expect(EventViewSchema.safeParse(withBriefing).success).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(EventViewSchema.safeParse({ ...buildSeedEventView(), extra: 1 }).success).toBe(false);
  });

  it("requires an error code exactly when an outcome failed", () => {
    const status = { manual: null, batch: null, cooldownUntil: null };
    const outcome = {
      runId: "7",
      trigger: "feedback_batch",
      finishedAt: "2026-10-03T09:00:00.000Z",
    };
    const parse = (lastOutcome: object) =>
      GenerationStatusViewSchema.safeParse({ ...status, lastOutcome }).success;
    expect(parse({ ...outcome, status: "failed", code: "GATEWAY_UNAVAILABLE" })).toBe(true);
    expect(parse({ ...outcome, status: "failed" })).toBe(false);
    expect(parse({ ...outcome, status: "skipped", code: "INTERNAL" })).toBe(false);
  });
});

describe("PUT /attendance body (F2)", () => {
  const body = {
    baseAttendanceRevision: 0,
    members: [
      { id: "M01", attendance: "attended" },
      { id: "M02", attendance: "absent" },
      { id: "M03", attendance: "attended" },
      { id: "M04", attendance: "absent" },
    ],
  };

  it("accepts the spec example", () => {
    expect(SaveAttendanceRequestSchema.safeParse(body).success).toBe(true);
  });

  it("rejects duplicates, client counts, unknown states and negative revisions (F2-05)", () => {
    const dup = { ...body, members: [...body.members, { id: "M01", attendance: "absent" }] };
    expect(SaveAttendanceRequestSchema.safeParse(dup).success).toBe(false);
    expect(
      SaveAttendanceRequestSchema.safeParse({ ...body, counts: { registered: 4 } }).success,
    ).toBe(false);
    const late = { ...body, members: [{ id: "M01", attendance: "late" }] };
    expect(SaveAttendanceRequestSchema.safeParse(late).success).toBe(false);
    expect(
      SaveAttendanceRequestSchema.safeParse({ ...body, baseAttendanceRevision: -1 }).success,
    ).toBe(false);
  });
});

describe("generation, selection and save bodies", () => {
  it("accepts only a revision for Generate: never prompts or sources", () => {
    expect(GenerateBriefingRequestSchema.safeParse({ baseAttendanceRevision: 3 }).success).toBe(
      true,
    );
    expect(
      GenerateBriefingRequestSchema.safeParse({ baseAttendanceRevision: 3, prompt: "x" }).success,
    ).toBe(false);
  });

  it("allows null when no preview is selected yet", () => {
    const body = { generationId: GENERATION_ID, expectedSelectedGenerationId: null };
    expect(SelectPreviewRequestSchema.safeParse(body).success).toBe(true);
  });

  it("rejects provenance overrides on save (F5-11)", () => {
    const body = {
      baseBriefingRevision: 0,
      generationId: GENERATION_ID,
      textEdits: {
        attendanceOverview: "O",
        feedbackSummary: "S",
        themes: [],
        conflicts: [],
        suggestions: [],
      },
    };
    expect(SaveBriefingRequestSchema.safeParse(body).success).toBe(true);
    expect(SaveBriefingRequestSchema.safeParse({ ...body, provenance: {} }).success).toBe(false);
  });
});

describe("POST /feedback body (F3)", () => {
  const body = { submissionId: "5f0c6c1e-8d1b-4c39-9a4e-6a2b1f3c4d5e", text: "Great walk." };

  it("accepts an anonymous note", () => {
    expect(SubmitFeedbackRequestSchema.safeParse(body).success).toBe(true);
  });

  it("requires a lowercase submissionId, which is what the ascii_bin column stores", () => {
    expect(
      SubmitFeedbackRequestSchema.safeParse({
        ...body,
        submissionId: body.submissionId.toUpperCase(),
      }).success,
    ).toBe(false);
  });

  it("rejects identity fields, blank and over-long text (F3-12)", () => {
    expect(SubmitFeedbackRequestSchema.safeParse({ ...body, memberId: "M01" }).success).toBe(false);
    expect(SubmitFeedbackRequestSchema.safeParse({ ...body, text: " \n " }).success).toBe(false);
    expect(SubmitFeedbackRequestSchema.safeParse({ ...body, text: "x".repeat(1001) }).success).toBe(
      false,
    );
  });
});

describe("SSE changed message (A16)", () => {
  it("carries the view version, or null when the cache flush failed", () => {
    expect(EventChangedMessageSchema.parse({ version: 3 })).toEqual({ version: 3 });
    expect(EventChangedMessageSchema.parse({ version: null })).toEqual({ version: null });
    expect(EventChangedMessageSchema.safeParse({ version: -1 }).success).toBe(false);
  });
});
