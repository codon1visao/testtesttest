import {
  ATTENDANCE_STATUSES,
  type AttendanceStatus,
  GENERATION_TRIGGERS,
  type GenerationTrigger,
} from "@event-desk/contracts";
import { EntitySchema } from "typeorm";
import { asciiBin } from "./column-types.js";

export interface GenerationRow {
  id: string;
  eventId: string;
  runId: string;
  triggerType: GenerationTrigger;
  model: string;
  promptVersion: string;
  attendanceOverview: string;
  feedbackDigest: string;
  inputCapturedAt: Date;
  generatedAt: Date;
}

export const GenerationEntity = new EntitySchema<GenerationRow>({
  name: "BriefingGeneration",
  tableName: "briefing_generations",
  columns: {
    id: { type: "char", length: 36, primary: true, ...asciiBin },
    eventId: { name: "event_id", type: "varchar", length: 16, ...asciiBin },
    runId: { name: "run_id", type: "varchar", length: 64, ...asciiBin },
    triggerType: { name: "trigger_type", type: "enum", enum: [...GENERATION_TRIGGERS] },
    model: { type: "varchar", length: 100 },
    promptVersion: { name: "prompt_version", type: "varchar", length: 32 },
    attendanceOverview: { name: "attendance_overview", type: "varchar", length: 500 },
    feedbackDigest: { name: "feedback_digest", type: "char", length: 64, ...asciiBin },
    inputCapturedAt: { name: "input_captured_at", type: "datetime", precision: 3 },
    generatedAt: { name: "generated_at", type: "datetime", precision: 3 },
  },
});

export interface AttendanceInputRow {
  generationId: string;
  eventId: string;
  memberId: string;
  attendance: AttendanceStatus;
}

export const AttendanceInputEntity = new EntitySchema<AttendanceInputRow>({
  name: "GenerationAttendanceInput",
  tableName: "generation_attendance_inputs",
  columns: {
    generationId: { name: "generation_id", type: "char", length: 36, primary: true, ...asciiBin },
    eventId: { name: "event_id", type: "varchar", length: 16, ...asciiBin },
    memberId: { name: "member_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    attendance: { type: "enum", enum: [...ATTENDANCE_STATUSES] },
  },
});

export interface FeedbackInputRow {
  generationId: string;
  eventId: string;
  feedbackId: string;
}

export const FeedbackInputEntity = new EntitySchema<FeedbackInputRow>({
  name: "GenerationFeedbackInput",
  tableName: "generation_feedback_inputs",
  columns: {
    generationId: { name: "generation_id", type: "char", length: 36, primary: true, ...asciiBin },
    eventId: { name: "event_id", type: "varchar", length: 16, ...asciiBin },
    feedbackId: { name: "feedback_id", type: "varchar", length: 16, primary: true, ...asciiBin },
  },
});

export const BRIEFING_ITEM_SECTIONS = ["summary", "theme", "conflict", "suggestion"] as const;
export type BriefingItemSection = (typeof BRIEFING_ITEM_SECTIONS)[number];

export interface BriefingItemRow {
  id: string;
  generationId: string;
  section: BriefingItemSection;
  position: number;
  text: string;
}

export const BriefingItemEntity = new EntitySchema<BriefingItemRow>({
  name: "BriefingItem",
  tableName: "briefing_items",
  columns: {
    id: { type: "char", length: 36, primary: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    section: { type: "enum", enum: [...BRIEFING_ITEM_SECTIONS] },
    position: { type: "tinyint", unsigned: true },
    text: { type: "varchar", length: 1000 },
  },
});

export interface BriefingItemSourceRow {
  itemId: string;
  generationId: string;
  feedbackId: string;
  position: number;
}

export const BriefingItemSourceEntity = new EntitySchema<BriefingItemSourceRow>({
  name: "BriefingItemSource",
  tableName: "briefing_item_sources",
  columns: {
    itemId: { name: "item_id", type: "char", length: 36, primary: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    feedbackId: { name: "feedback_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    position: { type: "tinyint", unsigned: true },
  },
});
