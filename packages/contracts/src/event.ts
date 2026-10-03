import { z } from "zod";
import { EventIdSchema } from "./ids.js";

export const EventSummarySchema = z.strictObject({
  id: EventIdSchema,
  name: z.string().min(1).max(120),
  clubName: z.string().min(1).max(120),
  status: z.literal("ended"),
});
export type EventSummary = z.infer<typeof EventSummarySchema>;
