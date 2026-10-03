import { describe, expect, it } from "vitest";
import { compareFeedbackIds, feedbackDigest, FeedbackNoteSchema } from "./feedback.js";
import { FeedbackIdSchema } from "./ids.js";

const id = (value: string) => FeedbackIdSchema.parse(value);

describe("compareFeedbackIds", () => {
  it("orders IDs numerically, so F100 follows F11", () => {
    const ids = ["F100", "F11", "F09"].map(id);
    expect(ids.toSorted(compareFeedbackIds)).toEqual(["F09", "F11", "F100"]);
  });
});

describe("feedbackDigest", () => {
  // Expected value: printf '%s' '[["F01","a"],["F02","b"],["F10","c"]]' | shasum -a 256
  const EXPECTED = "5253b596888a4d4b279f383fe4fba513647ec2578f57333b59466897e20eea9c";

  it("hashes the canonical [id, text] list in numeric ID order", async () => {
    const notes = [
      { id: id("F10"), text: "c" },
      { id: id("F01"), text: "a" },
      { id: id("F02"), text: "b" },
    ];
    expect(await feedbackDigest(notes)).toBe(EXPECTED);
  });

  it("changes when a note's text changes", async () => {
    const before = await feedbackDigest([{ id: id("F01"), text: "a" }]);
    const after = await feedbackDigest([{ id: id("F01"), text: "a " }]);
    expect(after).not.toBe(before);
  });
});

describe("FeedbackNoteSchema", () => {
  it("accepts a stored note and rejects identity fields", () => {
    const note = { id: "F09", text: "Great walk.", receivedAt: "2026-10-03T09:00:00.000Z" };
    expect(FeedbackNoteSchema.safeParse(note).success).toBe(true);
    expect(FeedbackNoteSchema.safeParse({ ...note, memberId: "M01" }).success).toBe(false);
  });

  it("rejects blank and over-long notes", () => {
    const base = { id: "F09", receivedAt: "2026-10-03T09:00:00.000Z" };
    expect(FeedbackNoteSchema.safeParse({ ...base, text: "  " }).success).toBe(false);
    expect(FeedbackNoteSchema.safeParse({ ...base, text: "x".repeat(1001) }).success).toBe(false);
  });
});
