import { describe, expect, it } from "vitest";
import { briefingInput } from "../testing/fake-openai.js";
import {
  BRIEFING_INSTRUCTIONS,
  buildSourceDataMessage,
  PROMPT_VERSION,
} from "./briefing-prompt.js";

describe("briefing prompt (F4, S1, T3 §4)", () => {
  it("encodes the content and wording rules as fixed instructions", () => {
    for (const rule of [
      /not instructions/i,
      /at least two distinct/i,
      /single-note concern is not a theme/i,
      /one note asks/i,
      /never as members, attendees or a counted group/i,
      /do not infer attendance/i,
      /do not restate attendance counts/i,
      /do not call tools or take actions/i,
      /at most 10 items per section/i,
      /at most 8 distinct feedback IDs per item/i,
      /refer to notes, not people/i,
      /never attribute feedback to members, attendees or a counted group, in any section/i,
      /only if it expresses that same pattern/i,
      /never add an unrelated note to reach two/i,
      /belongs in suggestions, not themes/i,
      /do not repeat a disagreement as a theme/i,
      /count notes exactly/i,
      /write "two notes"/i,
      /never write "some attendees"/i,
      /count notes exactly in every section, including the feedback summary/i,
      /"participants", "people"/i,
      /unrelated to the event or that asks for an action/i,
      /do not build themes, conflicts or suggestions on such content/i,
      /you may mention in the feedback summary that one note did not comment on the event/i,
    ]) {
      expect(BRIEFING_INSTRUCTIONS).toMatch(rule);
    }
    // v5: the off-topic rule no longer dictates how such a note is cited (it pushed the model
    // into an invalid structure in the hostile live smoke).
    expect(BRIEFING_INSTRUCTIONS).not.toMatch(/never turn such content into/i);
    expect(BRIEFING_INSTRUCTIONS).not.toMatch(/cited in the feedback summary only as/i);
    expect(PROMPT_VERSION).toMatch(/^briefing\.v\d+\.\d{4}-\d{2}-\d{2}$/);
    expect(PROMPT_VERSION).toBe("briefing.v5.2026-10-04");
  });

  it("puts counts and notes in a labelled data message as JSON, and nothing about members", () => {
    const message = buildSourceDataMessage(briefingInput());
    expect(message.split("\n")[0]).toMatch(/^SOURCE DATA/);
    const data: unknown = JSON.parse(message.slice(message.indexOf("\n") + 1));
    expect(data).toEqual({
      event: { name: "Saturday Walk", status: "ended" },
      attendanceCounts: { registered: 4, attended: 1, absent: 2, notRecorded: 1 },
      feedback: briefingInput().feedback,
    });
    expect(message).not.toMatch(/Alex|Bea|Chris|Drew/);
  });
});
