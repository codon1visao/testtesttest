import {
  EventViewSchema,
  GenerationIdSchema,
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
