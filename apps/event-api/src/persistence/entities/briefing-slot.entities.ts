import { EntitySchema } from "typeorm";
import { asciiBin } from "./column-types.js";

export const PREVIEW_SLOT_NAMES = ["selected", "incoming"] as const;
export type PreviewSlotName = (typeof PREVIEW_SLOT_NAMES)[number];

export interface PreviewSlotRow {
  eventId: string;
  slot: PreviewSlotName;
  generationId: string;
  updatedAt: Date;
}

export const PreviewSlotEntity = new EntitySchema<PreviewSlotRow>({
  name: "PreviewSlot",
  tableName: "preview_slots",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    slot: { type: "enum", enum: [...PREVIEW_SLOT_NAMES], primary: true },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    updatedAt: { name: "updated_at", type: "datetime", precision: 3 },
  },
});

export interface SavedBriefingRow {
  eventId: string;
  generationId: string;
  attendanceOverview: string;
  savedAt: Date;
}

export const SavedBriefingEntity = new EntitySchema<SavedBriefingRow>({
  name: "SavedBriefing",
  tableName: "saved_briefings",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    attendanceOverview: { name: "attendance_overview", type: "varchar", length: 500 },
    savedAt: { name: "saved_at", type: "datetime", precision: 3 },
  },
});

export interface SavedBriefingItemRow {
  eventId: string;
  generationId: string;
  itemId: string;
  text: string;
}

export const SavedBriefingItemEntity = new EntitySchema<SavedBriefingItemRow>({
  name: "SavedBriefingItem",
  tableName: "saved_briefing_items",
  columns: {
    eventId: { name: "event_id", type: "varchar", length: 16, primary: true, ...asciiBin },
    generationId: { name: "generation_id", type: "char", length: 36, ...asciiBin },
    itemId: { name: "item_id", type: "char", length: 36, primary: true, ...asciiBin },
    text: { type: "varchar", length: 1000 },
  },
});
