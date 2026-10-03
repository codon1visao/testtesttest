import {
  ApiErrorBodySchema,
  EventViewSchema,
  GenerationIdSchema,
  SaveBriefingResponseSchema,
  SelectPreviewResponseSchema,
  SUPPLIED_EVENT,
} from "@event-desk/contracts";
import type { Redis } from "ioredis";
import request from "supertest";
import type { DataSource } from "typeorm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { composeEventApi, type EventApi } from "../../compose.js";
import { openTestDataSource, truncateAllTables } from "../../testing/database.js";
import { errorCodeOf } from "../../testing/http.js";
import { clearApplicationKeys, openTestRedis } from "../../testing/redis.js";
import {
  DEFAULT_ITEMS,
  insertGenerationFixture,
  insertSavedBriefing,
  putPreviewSlot,
} from "../../testing/sql-fixtures.js";
import { integrationConfig, silentLogger } from "../../testing/test-config.js";

const E101 = SUPPLIED_EVENT.id;
const ORIGIN = "http://localhost:5173";
let dataSource: DataSource;
let redis: Redis;
let api: EventApi;

const generationId = (n: number) =>
  GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-${String(n).padStart(12, "0")}`);
/** A current fixture generation with item IDs unique to `n`. */
async function insertGeneration(n: number) {
  const items = DEFAULT_ITEMS.map((item, index) => ({
    ...item,
    id: `0199a4e8-0000-7000-8${String(n).padStart(3, "0")}-${String(index).padStart(12, "0")}`,
  }));
  const id = generationId(n);
  await insertGenerationFixture(dataSource, { id, runId: `manual:run-${String(n)}`, items });
  return { id, itemIds: items.map((item) => item.id) };
}
const select = (body: object) =>
  request(api.app)
    .post(`/api/events/${E101}/briefing-preview/select`)
    .set("Origin", ORIGIN)
    .send(body);
const view = async () =>
  EventViewSchema.parse((await request(api.app).get(`/api/events/${E101}`)).body);
const count = async (sql: string) => Number((await dataSource.query<{ n: number }[]>(sql))[0]?.n);
const saveBriefing = (body: object) =>
  request(api.app).put(`/api/events/${E101}/briefing`).set("Origin", ORIGIN).send(body);
const EDITS = {
  attendanceOverview:
    "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
  feedbackSummary: "Feedback describes the walk as enjoyable.",
  themes: ["People asked for longer rest breaks."],
  conflicts: ["Start time: earlier suits some, not others."],
  suggestions: ["Review the route length."],
};
const savedTexts = async () =>
  (
    await dataSource.query<{ item_id: string; text: string }[]>(
      "SELECT item_id, text FROM saved_briefing_items ORDER BY item_id",
    )
  ).map((row) => `${row.item_id}:${row.text}`);
const briefingRevision = async () => count("SELECT briefing_revision AS n FROM events");

beforeAll(async () => {
  dataSource = await openTestDataSource();
  redis = await openTestRedis();
});
afterAll(async () => {
  await clearApplicationKeys(redis);
  redis.disconnect();
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await clearApplicationKeys(redis);
  api = await composeEventApi(integrationConfig(), { logger: silentLogger });
});
afterEach(async () => {
  await api.close();
});

describe("POST /api/events/:eventId/briefing-preview/select (TX7)", () => {
  it("moves the incoming preview to selected and the next read shows it", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "incoming", id);
    await view(); // warm the cache: the flush after commit must replace it
    const res = await select({ generationId: id, expectedSelectedGenerationId: null });
    expect(res.status).toBe(200);
    const { selectedPreview } = SelectPreviewResponseSchema.parse(res.body);
    expect(selectedPreview.provenance.generationId).toBe(id);
    const after = await view();
    expect(after.selectedPreview?.provenance.generationId).toBe(id);
    expect(after.incomingPreview).toBeNull();
  });

  it("replaces the selected preview and deletes the replaced generation", async () => {
    const old = await insertGeneration(1);
    const next = await insertGeneration(2);
    await putPreviewSlot(dataSource, "selected", old.id);
    await putPreviewSlot(dataSource, "incoming", next.id);
    const res = await select({ generationId: next.id, expectedSelectedGenerationId: old.id });
    expect(res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM briefing_generations")).toBe(1);
    expect((await view()).selectedPreview?.provenance.generationId).toBe(next.id);
  });

  it("F6 race 3: a stale expected selection is PREVIEW_CONFLICT and changes nothing", async () => {
    const old = await insertGeneration(1);
    const next = await insertGeneration(2);
    await putPreviewSlot(dataSource, "selected", old.id);
    await putPreviewSlot(dataSource, "incoming", next.id);
    const res = await select({ generationId: next.id, expectedSelectedGenerationId: null });
    expect(res.status).toBe(409);
    expect(errorCodeOf(res)).toBe("PREVIEW_CONFLICT");
    const after = await view();
    expect(after.selectedPreview?.provenance.generationId).toBe(old.id);
    expect(after.incomingPreview?.provenance.generationId).toBe(next.id);
  });

  it("a generation that is not the incoming preview is PREVIEW_CONFLICT", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    const res = await select({ generationId: id, expectedSelectedGenerationId: id });
    expect(res.status).toBe(409);
    expect(errorCodeOf(res)).toBe("PREVIEW_CONFLICT");
  });

  it("rejects extra fields and malformed IDs with 400", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "incoming", id);
    expect(
      (await select({ generationId: id, expectedSelectedGenerationId: null, slot: "saved" }))
        .status,
    ).toBe(400);
    expect(
      (await select({ generationId: "not-a-uuid", expectedSelectedGenerationId: null })).status,
    ).toBe(400);
  });
});

describe("PUT /api/events/:eventId/briefing (TX8)", () => {
  it("F5-01/F6-01: saves the selected preview's wording with its original references and clears that slot", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    const res = await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: EDITS });
    expect(res.status).toBe(200);
    const body = SaveBriefingResponseSchema.parse(res.body);
    expect(body.briefingRevision).toBe(1);
    expect(body.selectedPreview).toBeNull();
    expect(body.savedBriefing.content.themes).toEqual([
      { text: "People asked for longer rest breaks.", sourceIds: ["F05", "F06"] },
    ]);
    expect(body.savedBriefing.provenance.generationId).toBe(id);
    expect(body.savedBriefing.freshness.current).toBe(true);
    const after = await view();
    expect(after.savedBriefing).toEqual(body.savedBriefing);
    expect(after.briefingRevision).toBe(1);
  });

  it("F5-09: saving a new preview replaces the saved briefing and deletes the replaced generation", async () => {
    const old = await insertGeneration(1);
    const next = await insertGeneration(2);
    await insertSavedBriefing(dataSource, {
      generationId: old.id,
      attendanceOverview: "Old overview.",
      itemTexts: Object.fromEntries(old.itemIds.map((itemId) => [itemId, "Old text."])),
    });
    await putPreviewSlot(dataSource, "selected", next.id);
    const res = await saveBriefing({
      baseBriefingRevision: 0,
      generationId: next.id,
      textEdits: EDITS,
    });
    expect(res.status).toBe(200);
    expect(SaveBriefingResponseSchema.parse(res.body).savedBriefing.provenance.generationId).toBe(
      next.id,
    );
    expect(await count("SELECT COUNT(*) AS n FROM briefing_generations")).toBe(1);
    expect(await savedTexts()).toHaveLength(4);
  });

  it("editing the saved briefing keeps an unrelated selected preview (F5 'API contract')", async () => {
    const saved = await insertGeneration(1);
    const selected = await insertGeneration(2);
    await insertSavedBriefing(dataSource, {
      generationId: saved.id,
      attendanceOverview: "Old overview.",
      itemTexts: Object.fromEntries(saved.itemIds.map((itemId) => [itemId, "Old text."])),
    });
    await putPreviewSlot(dataSource, "selected", selected.id);
    const res = await saveBriefing({
      baseBriefingRevision: 0,
      generationId: saved.id,
      textEdits: EDITS,
    });
    expect(res.status).toBe(200);
    expect(
      SaveBriefingResponseSchema.parse(res.body).selectedPreview?.provenance.generationId,
    ).toBe(selected.id);
  });

  it("a no-op save writes nothing and keeps the revision", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    expect(
      (await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: EDITS })).status,
    ).toBe(200);
    const again = await saveBriefing({
      baseBriefingRevision: 1,
      generationId: id,
      textEdits: EDITS,
    });
    expect(again.status).toBe(200);
    expect(SaveBriefingResponseSchema.parse(again.body).briefingRevision).toBe(1);
    expect(await briefingRevision()).toBe(1);
  });

  it("Review Focus 1 / F5-06 / F6-11: a stale revision is rejected and changes nothing", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    expect(
      (await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: EDITS })).status,
    ).toBe(200);
    const before = await savedTexts();
    const stale = await saveBriefing({
      baseBriefingRevision: 0,
      generationId: id,
      textEdits: { ...EDITS, themes: ["Tab B's wording."] },
    });
    expect(stale.status).toBe(409);
    expect(errorCodeOf(stale)).toBe("BRIEFING_CONFLICT");
    expect(await savedTexts()).toEqual(before);
    expect(await briefingRevision()).toBe(1);
  });

  it("Review Focus 2 / F5-03 / F5-11: source IDs, evidence objects or provenance in the body are rejected with nothing written", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    const bodies = [
      {
        baseBriefingRevision: 0,
        generationId: id,
        textEdits: { ...EDITS, themes: [{ text: "x", sourceIds: ["F01"] }] },
      },
      {
        baseBriefingRevision: 0,
        generationId: id,
        textEdits: { ...EDITS, sourceIds: ["F01"] },
      },
      {
        baseBriefingRevision: 0,
        generationId: id,
        textEdits: EDITS,
        provenance: { generatedAt: "2026-10-04T00:00:00.000Z" },
      },
      { baseBriefingRevision: 0, generationId: id, textEdits: { ...EDITS, extras: ["x"] } },
    ];
    for (const body of bodies) {
      const res = await saveBriefing(body);
      expect(res.status).toBe(400);
      expect(errorCodeOf(res)).toBe("VALIDATION_FAILED");
    }
    expect(await count("SELECT COUNT(*) AS n FROM saved_briefings")).toBe(0);
    expect(await briefingRevision()).toBe(0);
  });

  it("F5-04: a wrong item count is CONTENT_INVALID on that section; blank text is 400", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    const extra = await saveBriefing({
      baseBriefingRevision: 0,
      generationId: id,
      textEdits: { ...EDITS, themes: ["One.", "Two."] },
    });
    expect(extra.status).toBe(422);
    expect(errorCodeOf(extra)).toBe("CONTENT_INVALID");
    expect(ApiErrorBodySchema.parse(extra.body).error.field).toBe("textEdits.themes");
    const blank = await saveBriefing({
      baseBriefingRevision: 0,
      generationId: id,
      textEdits: { ...EDITS, conflicts: ["   "] },
    });
    expect(blank.status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM saved_briefings")).toBe(0);
  });

  it("F5-13: the incoming preview or an unknown generation is GENERATION_NOT_AVAILABLE", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "incoming", id);
    const incoming = await saveBriefing({
      baseBriefingRevision: 0,
      generationId: id,
      textEdits: EDITS,
    });
    expect(incoming.status).toBe(409);
    expect(errorCodeOf(incoming)).toBe("GENERATION_NOT_AVAILABLE");
    const unknown = await saveBriefing({
      baseBriefingRevision: 0,
      generationId: generationId(42),
      textEdits: EDITS,
    });
    expect(errorCodeOf(unknown)).toBe("GENERATION_NOT_AVAILABLE");
  });

  it("F5-13: a corrupt stored reference is REFERENCE_INVALID and nothing is saved", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    // fk_source_input cascades: the F07 suggestion is left citing no note, which only direct
    // corruption can cause. The save must refuse it, never bind the text to other sources.
    await dataSource.query(
      "DELETE FROM generation_feedback_inputs WHERE generation_id = ? AND feedback_id = 'F07'",
      [id],
    );
    const res = await saveBriefing({
      baseBriefingRevision: 0,
      generationId: id,
      textEdits: EDITS,
    });
    expect(res.status).toBe(422);
    expect(errorCodeOf(res)).toBe("REFERENCE_INVALID");
    expect(ApiErrorBodySchema.parse(res.body).error.field).toBe("textEdits.suggestions");
    expect(await count("SELECT COUNT(*) AS n FROM saved_briefings")).toBe(0);
  });

  it("Review Focus 4 / F5-07 / F6-12 / F6-17: saving a preview generated before an attendance change keeps it out of date", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    const attendance = await request(api.app)
      .put(`/api/events/${E101}/attendance`)
      .set("Origin", ORIGIN)
      .send({
        baseAttendanceRevision: 0,
        members: [
          { id: "M01", attendance: "attended" },
          { id: "M02", attendance: "absent" },
          { id: "M03", attendance: "attended" },
          { id: "M04", attendance: "absent" },
        ],
      });
    expect(attendance.status).toBe(200);
    const res = await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: EDITS });
    expect(res.status).toBe(200);
    const { savedBriefing } = SaveBriefingResponseSchema.parse(res.body);
    expect(savedBriefing.freshness).toEqual({
      current: false,
      attendanceChanges: [{ memberId: "M03", from: "not_recorded", to: "attended" }],
      newFeedbackIds: [],
    });
    expect(savedBriefing.provenance.input.counts).toMatchObject({ attended: 1, notRecorded: 1 });
  });
});
