import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { RawEvidenceSections } from "./briefing-rules.js";
import { buildGeneratedSectionsSchema, type GeneratedSections } from "./generated-sections.js";
import { FeedbackIdSchema } from "./ids.js";

const IDS = ["F01", "F02", "F05"].map((id) => FeedbackIdSchema.parse(id));
const schema = buildGeneratedSectionsSchema(IDS);
const output = {
  feedbackSummary: { text: "Summary.", sourceIds: ["F01"] },
  themes: [{ text: "Rest breaks.", sourceIds: ["F05", "F02"] }],
  conflicts: [],
  suggestions: [],
};

type JsonNode = Record<string, unknown>;
function objectNodes(node: unknown): JsonNode[] {
  if (node === null || typeof node !== "object") return [];
  const record = node as JsonNode;
  const children = Object.values(record).flatMap(objectNodes);
  return record.type === "object" ? [record, ...children] : children;
}

describe("buildGeneratedSectionsSchema", () => {
  it("parses a candidate that cites captured notes", () => {
    expect(schema.safeParse(output).success).toBe(true);
  });

  it("rejects IDs outside this request and extra action fields", () => {
    const unknown = { ...output, suggestions: [{ text: "x", sourceIds: ["F99"] }] };
    expect(schema.safeParse(unknown).success).toBe(false);
    expect(schema.safeParse({ ...output, sendEmail: true }).success).toBe(false);
  });

  it("emits a strict-mode JSON Schema: closed objects, all fields required, enum IDs", () => {
    const json = z.toJSONSchema(schema);
    const objects = objectNodes(json);
    expect(objects.length).toBeGreaterThan(0);
    for (const node of objects) {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties as JsonNode));
    }
    expect(JSON.stringify(json)).toContain('"enum":["F01","F02","F05"]');
  });

  it("refuses to build a schema with no notes", () => {
    expect(() => buildGeneratedSectionsSchema([])).toThrow("at least one feedback note");
  });

  it("produces output the evidence validator accepts as input", () => {
    const parsed: GeneratedSections = schema.parse(output);
    const raw: RawEvidenceSections = parsed;
    expect(raw.themes[0]?.sourceIds).toEqual(["F05", "F02"]);
  });
});
