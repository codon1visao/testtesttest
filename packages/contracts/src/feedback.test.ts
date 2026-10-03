import { describe, expect, it } from "vitest";
import { compareFeedbackIds, feedbackDigest, FeedbackNoteSchema } from "./feedback.js";
import { FeedbackIdSchema } from "./ids.js";

const id = (value: string) => FeedbackIdSchema.parse(value);

describe("compareFeedbackIds", () => {
  it("orders IDs numerically, so F100 follows F11", () => {
    const ids = ["F100", "F11", "F09"].map(id);
    expect(ids.toSorted(compareFeedbackIds)).toEqual(["F09", "F11", "F100"]);
  });

  it("breaks numeric ties lexically, so equal numbers still have one total order", () => {
    expect(compareFeedbackIds(id("F01"), id("F001"))).toBeGreaterThan(0);
    expect(compareFeedbackIds(id("F001"), id("F01"))).toBeLessThan(0);
    expect(compareFeedbackIds(id("F01"), id("F01"))).toBe(0);
    expect([id("F01"), id("F001")].toSorted(compareFeedbackIds)).toEqual(["F001", "F01"]);
    expect([id("F001"), id("F01")].toSorted(compareFeedbackIds)).toEqual(["F001", "F01"]);
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

  // Expected values (numeric order, then the lexical order the digest must NOT use):
  //   printf '%s' '[["F09","a"],["F11","b"],["F100","c"]]' | shasum -a 256
  //   printf '%s' '[["F09","a"],["F100","c"],["F11","b"]]' | shasum -a 256
  const NUMERIC_ORDER = "628f40dbb18ec21892949b5415a2df49bf546e9dc9bbe17c702bc8e815329b1d";
  const LEXICAL_ORDER = "d5d7ba0ed622839ab653dca0dc9a6217c350605b46effd481e2645c07398b8f5";

  it("orders F100 after F11 whatever order the notes arrive in, never lexically", async () => {
    const f100 = { id: id("F100"), text: "c" };
    const f11 = { id: id("F11"), text: "b" };
    const f09 = { id: id("F09"), text: "a" };
    expect(await feedbackDigest([f09, f11, f100])).toBe(NUMERIC_ORDER);
    expect(await feedbackDigest([f100, f11, f09])).toBe(NUMERIC_ORDER);
    expect(await feedbackDigest([f11, f09, f100])).toBe(NUMERIC_ORDER);
    expect(await feedbackDigest([f09, f11, f100])).not.toBe(LEXICAL_ORDER);
  });

  it("does not depend on input order for IDs with equal numbers", async () => {
    const a = { id: id("F01"), text: "a" };
    const b = { id: id("F001"), text: "b" };
    expect(await feedbackDigest([a, b])).toBe(await feedbackDigest([b, a]));
  });

  // Expected value: printf '%s' '[["F01","Café 😀"]]' | shasum -a 256
  it("hashes non-ASCII text as UTF-8", async () => {
    expect(await feedbackDigest([{ id: id("F01"), text: "Café 😀" }])).toBe(
      "4db31837ddc0d59bfac00ccdb275a5e80abadbc748343135b9b61dff92c34121",
    );
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
