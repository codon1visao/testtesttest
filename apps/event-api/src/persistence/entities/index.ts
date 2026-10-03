import type { EntitySchema } from "typeorm";
import {
  PreviewSlotEntity,
  SavedBriefingEntity,
  SavedBriefingItemEntity,
} from "./briefing-slot.entities.js";
import { EventEntity, FeedbackNoteEntity, MemberEntity } from "./event.entities.js";
import { GenerationOutcomeEntity } from "./generation-outcome.entity.js";
import {
  AttendanceInputEntity,
  BriefingItemEntity,
  BriefingItemSourceEntity,
  FeedbackInputEntity,
  GenerationEntity,
} from "./generation.entities.js";

/** Every mapped table; tasks add their EntitySchemas here. */
export const ENTITIES: EntitySchema[] = [
  EventEntity,
  MemberEntity,
  FeedbackNoteEntity,
  GenerationEntity,
  AttendanceInputEntity,
  FeedbackInputEntity,
  BriefingItemEntity,
  BriefingItemSourceEntity,
  PreviewSlotEntity,
  SavedBriefingEntity,
  SavedBriefingItemEntity,
  GenerationOutcomeEntity,
];
