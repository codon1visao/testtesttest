import { z } from "zod";
import { MemberSchema } from "./attendance.js";
import { EventSummarySchema } from "./event.js";
import { FeedbackNoteSchema, type FeedbackNote } from "./feedback.js";

// The fictional starting records from the project brief, parsed once so they carry branded types.
// Plan 2 seeds from these; tests and E2E assertions reuse them instead of repeating literals.

export const SUPPLIED_EVENT = EventSummarySchema.parse({
  id: "E101",
  name: "Saturday Walk",
  clubName: "Harbour Community Club",
  status: "ended",
});

export const SUPPLIED_MEMBERS = z
  .array(MemberSchema)
  .readonly()
  .parse([
    { id: "M01", name: "Alex", attendance: "attended" },
    { id: "M02", name: "Bea", attendance: "absent" },
    { id: "M03", name: "Chris", attendance: "not_recorded" },
    { id: "M04", name: "Drew", attendance: "absent" },
  ]);

export type SuppliedNote = Pick<FeedbackNote, "id" | "text">;

export const SUPPLIED_FEEDBACK: readonly SuppliedNote[] = z
  .array(FeedbackNoteSchema.pick({ id: true, text: true }))
  .readonly()
  .parse([
    { id: "F01", text: "The walk was enjoyable, but the meeting point was difficult to find." },
    { id: "F02", text: "Clear directions. I had no trouble finding the group." },
    { id: "F03", text: "Could we start earlier next time?" },
    { id: "F04", text: "An earlier start would be difficult for me." },
    { id: "F05", text: "A longer rest break halfway would help." },
    { id: "F06", text: "The rest stop felt rushed; a few more minutes would be good." },
    { id: "F07", text: "Could we try a shorter route? The final stretch felt long." },
    { id: "F08", text: "No extra suggestions from me." },
  ]);
