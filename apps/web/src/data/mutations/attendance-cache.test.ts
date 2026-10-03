import {
  deriveAttendanceCounts,
  MemberIdSchema,
  type SaveAttendanceResponse,
} from "@event-desk/contracts";
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { applyAttendanceSaved } from "./attendance-cache";

describe("applyAttendanceSaved", () => {
  it("replaces members, counts, revision and each existing briefing's freshness", () => {
    const view = buildSeedEventView({ savedBriefing: buildBriefingView() });
    const members = view.members.map((m) =>
      m.id === "M03" ? { ...m, attendance: "attended" as const } : m,
    );
    const stale = {
      current: false,
      attendanceChanges: [
        {
          memberId: MemberIdSchema.parse("M03"),
          from: "not_recorded" as const,
          to: "attended" as const,
        },
      ],
      newFeedbackIds: [],
    };
    const saved: SaveAttendanceResponse = {
      members,
      counts: deriveAttendanceCounts(members),
      attendanceRevision: 1,
      freshness: { savedBriefing: stale, selectedPreview: null, incomingPreview: null },
    };
    const next = applyAttendanceSaved(view, saved);
    expect(next.members).toEqual(members);
    expect(next.counts).toEqual({ registered: 4, attended: 2, absent: 2, notRecorded: 0 });
    expect(next.attendanceRevision).toBe(1);
    expect(next.savedBriefing?.freshness).toEqual(stale);
    expect(next.savedBriefing?.content).toEqual(view.savedBriefing?.content);
    expect(next.feedback).toBe(view.feedback);
  });
});
