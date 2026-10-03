import { deriveAttendanceCounts } from "../attendance.js";
import {
  type BriefingView,
  BriefingViewSchema,
  type EventView,
  EventViewSchema,
} from "../api/event-view.js";
import { SUPPLIED_EVENT, SUPPLIED_FEEDBACK, SUPPLIED_MEMBERS } from "../supplied-records.js";

export const FIXTURE_TIME = "2026-10-03T09:00:00.000Z";

/** The F1-01 starting view; overrides are re-validated so a fixture can never drift from the contract. */
export function buildSeedEventView(overrides: Partial<EventView> = {}): EventView {
  return EventViewSchema.parse({
    event: SUPPLIED_EVENT,
    members: SUPPLIED_MEMBERS,
    feedback: SUPPLIED_FEEDBACK.map((note) => ({ ...note, receivedAt: FIXTURE_TIME })),
    counts: deriveAttendanceCounts(SUPPLIED_MEMBERS),
    attendanceRevision: 0,
    briefingRevision: 0,
    savedBriefing: null,
    selectedPreview: null,
    incomingPreview: null,
    generation: { manual: null, batch: null, lastOutcome: null, cooldownUntil: null },
    ...overrides,
  });
}

/** A current manual briefing generated from the supplied records. */
export function buildBriefingView(overrides: Partial<BriefingView> = {}): BriefingView {
  return BriefingViewSchema.parse({
    provenance: {
      generationId: "0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f",
      runId: "manual:fixture",
      generatedAt: FIXTURE_TIME,
      model: "fixture-model",
      promptVersion: "briefing-v1",
      input: {
        attendance: SUPPLIED_MEMBERS.map((m) => ({ memberId: m.id, attendance: m.attendance })),
        counts: deriveAttendanceCounts(SUPPLIED_MEMBERS),
        feedbackIds: SUPPLIED_FEEDBACK.map((note) => note.id),
        feedbackDigest: "0".repeat(64),
      },
    },
    content: {
      attendanceOverview:
        "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      feedbackSummary: {
        text: "Feedback describes the walk as enjoyable, with comments mostly about logistics.",
        sourceIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"],
      },
      themes: [{ text: "Requests for more rest-break time.", sourceIds: ["F05", "F06"] }],
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
      suggestions: [
        { text: "Consider asking about start-time constraints.", sourceIds: ["F03", "F04"] },
        { text: "Consider reviewing the route length.", sourceIds: ["F07"] },
      ],
    },
    freshness: { current: true, attendanceChanges: [], newFeedbackIds: [] },
    trigger: "manual",
    ...overrides,
  });
}
