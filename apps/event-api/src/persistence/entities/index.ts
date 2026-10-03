import type { EntitySchema } from "typeorm";
import { EventEntity, FeedbackNoteEntity, MemberEntity } from "./event.entities.js";

/** Every mapped table; tasks add their EntitySchemas here. */
export const ENTITIES: EntitySchema[] = [EventEntity, MemberEntity, FeedbackNoteEntity];
