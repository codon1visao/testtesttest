import {
  deriveAttendanceCounts,
  type EventId,
  type SaveAttendanceResponse,
} from "@event-desk/contracts";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import { freshnessSummary, loadBriefingViews } from "../briefing/briefing-views.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import {
  type AttendanceDiff,
  applyAttendanceChanges,
  diffAttendance,
  type RequestedAttendance,
} from "./domain/diff-attendance.js";

export interface SaveAttendanceCommand {
  eventId: EventId;
  baseAttendanceRevision: number;
  members: readonly RequestedAttendance[];
}

function rosterMismatch(diff: Extract<AttendanceDiff, { kind: "roster_mismatch" }>): AppError {
  const problems = [
    ...(diff.missing.length > 0 ? [`missing ${diff.missing.join(", ")}`] : []),
    ...(diff.unknown.length > 0 ? [`not registered ${diff.unknown.join(", ")}`] : []),
  ];
  return new AppError(
    "VALIDATION_FAILED",
    `members must list each registered member exactly once (${problems.join("; ")}).`,
    {
      field: "members",
    },
  );
}

/** TX3: lock the event row, check the revision inside the lock, write only changed members. */
export class AttendanceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly changes: Pick<EventChangePublisher, "publish">,
  ) {}

  save(command: SaveAttendanceCommand): Promise<SaveAttendanceResponse> {
    return this.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(command.eventId);
      const diff = diffAttendance(aggregate.members, command.members);
      if (diff.kind === "roster_mismatch") throw rosterMismatch(diff);
      if (aggregate.attendanceRevision !== command.baseAttendanceRevision) {
        throw new AppError(
          "ATTENDANCE_CONFLICT",
          "Attendance was saved elsewhere since you loaded it. Reload to see the latest records.",
        );
      }

      let members = aggregate.members;
      let attendanceRevision = aggregate.attendanceRevision;
      if (diff.changes.length > 0) {
        await tx.events.applyAttendanceChanges(command.eventId, diff.changes);
        members = applyAttendanceChanges(aggregate.members, diff.changes);
        attendanceRevision += 1;
        tx.afterCommit(() => this.changes.publish(command.eventId));
      }

      const briefings = await loadBriefingViews(tx, command.eventId, members, aggregate.feedback);
      return {
        members,
        counts: deriveAttendanceCounts(members),
        attendanceRevision,
        freshness: freshnessSummary(briefings),
      };
    });
  }
}
