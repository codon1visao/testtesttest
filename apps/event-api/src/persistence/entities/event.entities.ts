import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@event-desk/contracts";
import { EntitySchema } from "typeorm";
import { asciiBin } from "./column-types.js";

export interface EventRow {
  id: string;
  name: string;
  clubName: string;
  status: "ended";
  attendanceRevision: number;
  briefingRevision: number;
  nextFeedbackNumber: number;
  feedbackPendingSince: Date | null;
}

export const EventEntity = new EntitySchema<EventRow>({
  name: "Event",
  tableName: "events",
  columns: {
    id: { type: "varchar", length: 16, primary: true, ...asciiBin },
    name: { type: "varchar", length: 120 },
    clubName: { name: "club_name", type: "varchar", length: 120 },
    status: { type: "enum", enum: ["ended"] },
    attendanceRevision: { name: "attendance_revision", type: "int", unsigned: true },
    briefingRevision: { name: "briefing_revision", type: "int", unsigned: true },
    nextFeedbackNumber: { name: "next_feedback_number", type: "int", unsigned: true },
    feedbackPendingSince: {
      name: "feedback_pending_since",
      type: "datetime",
      precision: 3,
      nullable: true,
    },
  },
});

export interface MemberRow {
  eventId: string;
  id: string;
  name: string;
  attendance: AttendanceStatus;
  displayOrder: number;
}

export const MemberEntity = new EntitySchema<MemberRow>({
  name: "Member",
  tableName: "members",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    id: { type: "varchar", length: 16, primary: true, ...asciiBin },
    name: { type: "varchar", length: 120 },
    attendance: { type: "enum", enum: [...ATTENDANCE_STATUSES] },
    displayOrder: { name: "display_order", type: "smallint", unsigned: true },
  },
});

export interface FeedbackNoteRow {
  eventId: string;
  id: string;
  text: string;
  origin: "seed" | "submitted";
  submissionId: string | null;
  receivedAt: Date;
  displayOrder: number;
}

export const FeedbackNoteEntity = new EntitySchema<FeedbackNoteRow>({
  name: "FeedbackNote",
  tableName: "feedback_notes",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    id: { type: "varchar", length: 16, primary: true, ...asciiBin },
    text: { type: "varchar", length: 1000 },
    origin: { type: "enum", enum: ["seed", "submitted"] },
    submissionId: { name: "submission_id", type: "char", length: 36, nullable: true, ...asciiBin },
    receivedAt: { name: "received_at", type: "datetime", precision: 3 },
    displayOrder: { name: "display_order", type: "int", unsigned: true },
  },
});
