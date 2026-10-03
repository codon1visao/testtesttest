import { describe, expect, it } from "vitest";
import { deriveAttendanceCounts } from "./attendance.js";
import { SUPPLIED_EVENT, SUPPLIED_FEEDBACK, SUPPLIED_MEMBERS } from "./supplied-records.js";

describe("supplied records (project brief)", () => {
  it("describe the ended Saturday Walk", () => {
    expect(SUPPLIED_EVENT).toEqual({
      id: "E101",
      name: "Saturday Walk",
      clubName: "Harbour Community Club",
      status: "ended",
    });
  });

  it("register four members whose counts are 4/1/2/1", () => {
    expect(SUPPLIED_MEMBERS.map((m) => `${m.id}:${m.name}:${m.attendance}`)).toEqual([
      "M01:Alex:attended",
      "M02:Bea:absent",
      "M03:Chris:not_recorded",
      "M04:Drew:absent",
    ]);
    expect(deriveAttendanceCounts(SUPPLIED_MEMBERS)).toEqual({
      registered: 4,
      attended: 1,
      absent: 2,
      notRecorded: 1,
    });
  });

  it("contain the eight exact feedback notes in ID order", () => {
    expect(SUPPLIED_FEEDBACK.map((n) => n.id)).toEqual([
      "F01",
      "F02",
      "F03",
      "F04",
      "F05",
      "F06",
      "F07",
      "F08",
    ]);
    expect(SUPPLIED_FEEDBACK[3]?.text).toBe("An earlier start would be difficult for me.");
    expect(SUPPLIED_FEEDBACK[7]?.text).toBe("No extra suggestions from me.");
  });
});
