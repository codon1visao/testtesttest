# Event Desk — Plan 4: Review, Edit and Save the Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coordinator selects a generated preview (automatically after their own Generate when the editor is clean), inspects each item's source notes, edits only the wording, and explicitly saves or replaces the briefing. Freshness warnings say exactly what changed. A Playwright walkthrough proves the F6 example end to end.

**Architecture:**
- **Server.** Two new transactions follow the existing pattern: lock the event row first, use `afterCommit` for the flush, and keep the decisions pure.
  - TX7 `PreviewSelectionService` moves incoming to selected, with expected-ID checks.
  - TX8 `BriefingSaveService` checks the revision, resolves the generation against the saved or selected slot, applies the text edits with a pure `applyTextEdits` that never touches references, writes the saved briefing, clears the selected slot, deletes the replaced generation if it is unreferenced, and bumps the revision on a real change.
- **Web.** The briefing editor is React Hook Form, keyed by `slot:generationId:briefingRevision` (T3 §11). Mutations go through `useSelectPreview` and `useSaveBriefing`. Cross-panel `briefingDirty` lives in Zustand. Source disclosure is inline and accessible.
- **End to end.** A new `e2e/` workspace package runs Playwright against the real web app and event API with a scripted fake Gateway.

**Tech Stack:**
- Existing: Express 5, TypeORM 1.1 on MySQL 8.4, React 19, TanStack Query 5, React Hook Form 7, Zustand 5, Astryx 0.6.5, MSW 3.
- New dev tooling: `@playwright/test` 1.63.0 (approved in A13).

**Spec:**
- [F5](../../specs/05-briefing-editor.md): editing flow, human content rules, API contract, states, F5-01…F5-14.
- [F6](../../specs/06-freshness-and-regeneration.md): freshness rule, example walkthrough, regeneration table, races, F6-01…F6-18.
- [F3 "Reading and inspection flow", "Reference contract", "Evidence limits"](../../specs/03-feedback-and-sources.md), F3-02…F3-09.
- [F7 "Preview ownership and the editor"](../../specs/07-generation-queue.md#preview-ownership-and-the-editor).
- [F4 step 7](../../specs/04-ai-briefing-generation.md#generation-flow): auto-select after a manual result when the editor is clean.
- [T3 §5, §11, §12](../../specs/12-architecture-and-repository.md): API, web state table, E2E row.
- [T4 TX7/TX8](../../specs/13-data-model-and-transactions.md#6-transactions), T4-02/T4-06.
- [README "Screen and interaction"](../../specs/README.md).

---

## Plan series

| Plan | Scope | Status |
| --- | --- | --- |
| 1, 2, 2B, 3, 3B | Foundation; event API; web shell; AI Gateway; manual generation | Done |
| **4 — Review and save (this plan)** | TX7 select, TX8 save, freshness notices, source disclosure, briefing editor, auto-select, Playwright F6 walkthrough | — |
| 5 — Automatic batches | Feedback form and script, BullMQ, SSE, persisted cooldown and budget, retries, S1 cases | next |
| 6 — Hand-in | README | — |

**Carried in from the Plan 3B review, and done here:**
- F4 step 7 auto-select.
- Replace the deprecated `VALUES()` upsert with a row alias.
- A test for the saved-briefing reference guard on delete.
- Fewer region landmarks in the briefing display.

**Carried to Plan 5:**
- Prompt v4 for banned phrasings.
- Batch reuse of the generation service, `whenIdle`, `notSent` propagation, the keep/skip responses.
- Draining runs at shutdown.
- Resetting a stale Retry banner when the incoming preview changes (needs SSE).

## Before you start

- Branch from `main`: `git switch -c feat/review-and-save main`.
- `pnpm infra:up`. Integration tests use `event_desk_test` and Redis DB 1. The E2E run (Task 9) uses `event_desk_test` and Redis DB 2, so do not run it while integration tests are running.
- No OpenAI calls in this plan. E2E uses a fake Gateway.

## Global Constraints

- **Earlier plans' constraints still apply:**
  - TypeScript strict, with no `any`, no non-null assertions and no string throws.
  - Exact pins, kebab-case files, `.js` imports in Node packages and extensionless imports in `apps/web`.
  - Conventional commits with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Transactions (T4 §6):**
  - TX7 and TX8 lock the event row first.
  - Revision and expected-ID checks happen inside the lock.
  - Flushes run via `afterCommit`.
  - No client value decides structure, references, provenance or freshness.
- **TX7 select (F7, T3 §5):** `POST /api/events/:eventId/briefing-preview/select` `{ generationId, expectedSelectedGenerationId }` → `200 { selectedPreview }`.
  - If the incoming slot does not hold `generationId`, or the selected slot (or `null`) differs from `expectedSelectedGenerationId`: `409 PREVIEW_CONFLICT`.
  - Otherwise: clear incoming, put it in selected, and delete the old selected generation if it is unreferenced.
- **TX8 save (F5 "API contract", T4 TX8):** `PUT /api/events/:eventId/briefing` `{ baseBriefingRevision, generationId, textEdits }` → `200 { savedBriefing, briefingRevision, selectedPreview }`.
  - A stale revision is `409 BRIEFING_CONFLICT`.
  - A `generationId` that is neither the saved nor the selected generation is `409 GENERATION_NOT_AVAILABLE`.
  - A wrong item count for a section is `422 CONTENT_INVALID` with `field` `textEdits.<section>`.
  - Blank or over-long text is `400 VALIDATION_FAILED` (Zod, before the transaction) or `422 CONTENT_INVALID` for the server-side check.
  - Invalid stored references are `422 REFERENCE_INVALID`.
  - Any extra field (source IDs, evidence objects, provenance) is `400 VALIDATION_FAILED`, through the strict schema.
  - Saving the selected preview clears that slot only.
  - A real change bumps `briefingRevision` by 1. A no-op (same generation, identical texts) writes nothing and keeps the revision.
  - The write order follows T4 TX8 steps 1–5.
- **Text-only editing (D2, F5).** Edits never change item count, order, sources, provenance or the generation snapshot. Text is stored exactly as typed (trim only to validate).
- **Freshness (D5, F6)** comes only from the server's `freshness`.
  - Text: **"Out of date — attendance changed since this briefing was generated"** when attendance changed, or **"Out of date — new feedback since this briefing was generated"** when only notes changed.
  - Changes are listed by member name: "Chris: Not recorded → Attended".
  - New notes are listed: "2 new notes since this briefing: F09, F10".
  - Show the snapshot counts against the current saved counts.
  - Saving text never clears staleness.
- **Source disclosure (F3).**
  - Each cited ID is a toggle labelled **"Read source F05"**, with `aria-expanded` and `aria-controls` pointing at the inline note, which shows the ID and the full text as plain text.
  - An ID missing from the event's notes shows **"Source F99 is unavailable"**, as an error, never as a note.
  - The evidence-limit notice appears near the briefing: **"References identify the source notes; they do not automatically prove that the wording is supported. Review the notes before saving."**
- **Editor (F5, T3 §11):**
  - React Hook Form, keyed by `slot:generationId:briefingRevision`.
  - Fields are labelled text areas, one per existing item. There is no add, remove or reorder.
  - Labels:
    - Selected preview: "Generated preview — not saved as briefing".
    - Saved briefing: "Saved briefing · last saved {time}".
    - Action: **"Save briefing"**, or **"Save and replace briefing"** when editing a preview while a saved briefing exists.
    - **"Discard edits"** with confirmation.
  - Under the overview field, three lines: "Check edited wording against the counts.", "Generated from: {snapshot counts}" and "Saved records now: {current counts}". Counts use the attendance panel's format, "4 registered · 1 attended · 2 absent · 1 not recorded".
  - Fields are locked while saving. A conflict keeps the draft. A lost response is reconciled by re-read: report saved only if the saved briefing now holds the same generation and texts.
  - `beforeunload` warns while dirty. `briefingDirty` lives in Zustand.
- **Selection (F7, F4 step 7):**
  - After this tab's Generate succeeds, auto-select the new incoming preview if `briefingDirty` is false.
  - Otherwise, or for a result from elsewhere, show **"New briefing ready to review"** with **"Review new preview"**. While dirty, reviewing asks first: "Discard your edits and review the new preview?" Cancel keeps editing; Save stays available in the editor.
- **Feedback panel.** Notes that are not in the displayed briefing's input carry **"New since this briefing"**. The displayed briefing is the selected preview, else the saved briefing, else the incoming preview.
- **Accessibility (README).** Labelled controls, keyboard operation, visible focus, state in text, and no unexpected focus moves.
- **E2E.**
  - `@playwright/test` 1.63.0 in a new private workspace package `e2e/`. Chromium only.
  - A fake Gateway (tcp-rpc) gives deterministic sections.
  - The stack runs on its own ports so it never clashes with `pnpm dev`: Gateway 4199, event API 4010, web 5183.
  - It uses DB `event_desk_test` and Redis DB 2, reset before each run.
- **Dependencies.** Approving this plan approves exactly `@playwright/test` 1.63.0 (dev, `e2e/` package) and the Chromium download through `playwright install chromium`. The `e2e/` package also lists `tsx` 4.23.15, the version the workspace already pins. Nothing else.

## Review Focus

1. **Two tabs.** Tab A saves the briefing, then tab B (still on the old revision) saves its edits. B must get a conflict that keeps its text, and A's wording must survive. Pinned in Task 4 ("F5-06/F6-11: a stale revision is rejected and changes nothing") and Task 7 ("a conflict keeps the draft").
2. **References on a save request.** A save request carries extra fields such as source IDs or provenance, or the wrong number of items. It must be rejected with nothing written. Pinned in Task 4 (F5-03/F5-04/F5-11).
3. **New preview while editing.** A new preview arrives while the coordinator has unsaved edits. The edits must stay, nothing may switch automatically, and reviewing it must ask first. Pinned in Task 8 ("a new preview never replaces a dirty editor").
4. **Saving a stale briefing.** Attendance changes after the preview was generated, and the coordinator saves the preview anyway. The saved briefing must stay out of date (F6-12/F6-17). Pinned in Task 4.
5. **Keyboard source inspection.** The coordinator opens a source with the keyboard while typing. The draft must survive, and the toggle must announce its state. Pinned in Task 6 (component) and Task 9 (E2E).

---

## File structure

```text
apps/event-api/src/
├─ ports/unit-of-work.ts                       # Task 1: selected slot, clear, structure, saved-briefing write, bumpBriefingRevision
├─ repositories/
│  ├─ preview-slot-repository.ts               # Task 1: selected(), putSelected(), clear(); row-alias upserts
│  ├─ generation-write-repository.ts           # Task 1: structure()
│  ├─ saved-briefing-write-repository.ts       # Task 1 (new)
│  ├─ event-repository.ts                      # Task 1: bumpBriefingRevision()
│  └─ typeorm-unit-of-work.ts                  # Task 1: savedBriefings in the transaction scope
├─ modules/briefing/
│  ├─ domain/apply-text-edits.ts               # Task 2 (pure)
│  ├─ preview-selection-service.ts             # Task 3 (TX7)
│  ├─ briefing-save-service.ts                 # Task 4 (TX8)
│  └─ briefing-controller.ts                   # Tasks 3–4
└─ compose.ts                                  # Tasks 3–4

apps/web/src/
├─ data/api/event-api.ts                       # Task 5: selectPreview, saveBriefing
├─ data/mutations/briefing-cache.ts · use-select-preview.ts · use-save-briefing.ts   # Task 5
├─ state/ui-store.ts                           # Task 6: briefingDirty
├─ testing/fake-event-api.ts · setup.ts        # Tasks 5–7: select + save endpoints, dirty reset, saveDelayMs
└─ features/
   ├─ attendance/attendance-counts.tsx         # Task 6: export formatAttendanceCounts
   ├─ feedback/source-reference.tsx            # Task 6
   ├─ feedback/feedback-panel.tsx              # Task 6: "New since this briefing"
   ├─ event/event-page.tsx                     # Tasks 6–7: new-since set, refetch to the briefing panel
   └─ briefing/
      ├─ active-briefing.ts · freshness-text.ts · freshness-notice.tsx   # Task 6
      ├─ briefing-copy.ts · briefing-form-model.ts · use-briefing-form.ts · briefing-editor.tsx   # Task 7
      ├─ incoming-preview-notice.tsx           # Task 8
      └─ briefing-panel.tsx · generate-briefing-control.tsx · briefing-preview.tsx   # Tasks 7–8

apps/web/vite.config.ts                        # Task 9: EVENT_API_URL proxy override
e2e/                                           # Task 9 (new workspace package @event-desk/e2e)
├─ package.json · tsconfig.json · playwright.config.ts
├─ e2e-env.ts · reset.ts · fake-gateway.ts
└─ tests/f6-walkthrough.spec.ts
.github/workflows/ci.yml · AGENTS.md · package.json · pnpm-workspace.yaml   # Task 9
```

---
### Task 1: Persistence for selection and saving — selected slot, structure, saved-briefing writes, revision bump

**Files:**
- Modify: `apps/event-api/src/ports/unit-of-work.ts`
- Modify: `apps/event-api/src/repositories/preview-slot-repository.ts`, `apps/event-api/src/repositories/generation-write-repository.ts`, `apps/event-api/src/repositories/event-repository.ts`, `apps/event-api/src/repositories/typeorm-unit-of-work.ts`
- Create: `apps/event-api/src/repositories/saved-briefing-write-repository.ts`
- Test: `apps/event-api/src/repositories/briefing-write-repositories.int.test.ts`

**Interfaces:**
- Consumes:
  - entities `GenerationEntity`, `BriefingItemEntity`, `BriefingItemSourceEntity`, `FeedbackInputEntity`, `PreviewSlotEntity`, `SavedBriefingEntity`, `SavedBriefingItemEntity`, `EventEntity`;
  - `ITEM_SECTIONS`, `ItemSection`, `NewItem` (`modules/generation/domain/generation-items.ts`);
  - `parseStoredRow`.
- Produces. In `ports/unit-of-work.ts`:

```ts
/** A slot's generation with the facts the incoming-slot rules need. */
export interface SlotHolder {
  generationId: GenerationId;
  trigger: GenerationTrigger;
  inputCapturedAt: Date;
}
/** Kept for the Plan 3B callers. */
export type IncomingSlot = SlotHolder;

export interface PreviewSlotRepository {
  incoming(eventId: EventId): Promise<SlotHolder | null>;
  selected(eventId: EventId): Promise<SlotHolder | null>;
  putIncoming(eventId: EventId, generationId: GenerationId, now: Date): Promise<void>;
  putSelected(eventId: EventId, generationId: GenerationId, now: Date): Promise<void>;
  clear(eventId: EventId, slot: "selected" | "incoming"): Promise<void>;
}

/** A stored generation's fixed structure: what TX8 edits text against (D2). */
export interface GenerationStructure {
  attendanceOverview: string;
  feedbackIds: FeedbackId[];
  /** Reading order: summary, themes, conflicts, suggestions; by position; sources in citation order. */
  items: NewItem[];
}
// GenerationWriteRepository gains:
//   structure(eventId: EventId, generationId: GenerationId): Promise<GenerationStructure | null>;

export interface StoredSavedBriefing {
  generationId: GenerationId;
  attendanceOverview: string;
  itemTexts: ReadonlyMap<string, string>;
}

export interface SavedBriefingWrite {
  eventId: EventId;
  generationId: GenerationId;
  attendanceOverview: string;
  /** Exactly one entry per item of the generation, keyed by briefing_items.id. */
  itemTexts: ReadonlyMap<string, string>;
  savedAt: Date;
}

export interface SavedBriefingWriteRepository {
  get(eventId: EventId): Promise<StoredSavedBriefing | null>;
  /** T4 TX8 steps 1–3: delete old texts, upsert saved_briefings, insert new texts. */
  replace(saved: SavedBriefingWrite): Promise<void>;
}
// EventWriteRepository gains:  bumpBriefingRevision(eventId: EventId): Promise<void>;
// TransactionScope gains:      savedBriefings: SavedBriefingWriteRepository;
```

**SQL:**
- **Upserts** use the MySQL 8 row-alias form. `VALUES()` has been deprecated since 8.0.20 (carried over from the Plan 3B review):
  `INSERT INTO preview_slots (event_id, slot, generation_id, updated_at) VALUES (?, ?, ?, ?) AS new ON DUPLICATE KEY UPDATE generation_id = new.generation_id, updated_at = new.updated_at`.
- **The `uq_slot_generation` rule.** A generation may sit in only one slot. Callers move a generation by clearing its old slot first. The doc comment on `putSelected` says so.
- **`clear`**: `DELETE FROM preview_slots WHERE event_id = ? AND slot = ?`.
- **`savedBriefings.replace`**:
  1. `DELETE FROM saved_briefing_items WHERE event_id = ?`.
  2. `INSERT INTO saved_briefings (event_id, generation_id, attendance_overview, saved_at) VALUES (?, ?, ?, ?) AS new ON DUPLICATE KEY UPDATE generation_id = new.generation_id, attendance_overview = new.attendance_overview, saved_at = new.saved_at`.
  3. A multi-row `INSERT INTO saved_briefing_items (event_id, generation_id, item_id, text)`.

  The composite FKs stay valid at every step, per the T4 TX8 order.

- [ ] **Step 1: Write the failing integration test**

`apps/event-api/src/repositories/briefing-write-repositories.int.test.ts`:

```ts
import { GenerationIdSchema, SUPPLIED_EVENT } from "@event-desk/contracts";
import type { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openTestDataSource, truncateAllTables } from "../testing/database.js";
import { DEFAULT_ITEMS, insertEventFixture, insertGenerationFixture } from "../testing/sql-fixtures.js";
import { silentLogger } from "../testing/test-config.js";
import { TypeOrmUnitOfWork } from "./typeorm-unit-of-work.js";

const E101 = SUPPLIED_EVENT.id;
const NOW = new Date("2026-10-04T12:00:00.000Z");
let dataSource: DataSource;
let uow: TypeOrmUnitOfWork;

const generationId = (n: number) => GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-${String(n).padStart(12, "0")}`);
/** A fixture generation whose item IDs are unique to `n`. */
async function insertGeneration(n: number): Promise<{ id: ReturnType<typeof generationId>; itemIds: string[] }> {
  const items = DEFAULT_ITEMS.map((item, index) => ({ ...item, id: `0199a4e8-0000-7000-8${String(n).padStart(3, "0")}-${String(index).padStart(12, "0")}` }));
  const id = generationId(n);
  await insertGenerationFixture(dataSource, { id, runId: `manual:run-${n}`, items });
  return { id, itemIds: items.map((item) => item.id) };
}
const rows = (sql: string) => dataSource.query<Record<string, unknown>[]>(sql);

beforeAll(async () => {
  dataSource = await openTestDataSource();
  uow = new TypeOrmUnitOfWork(dataSource, silentLogger, { queryTimeoutMs: 5_000 });
});
afterAll(async () => {
  await dataSource.destroy();
});
beforeEach(async () => {
  await truncateAllTables(dataSource);
  await insertEventFixture(dataSource);
});

describe("preview slots (TX7)", () => {
  it("moves a generation from incoming to selected and replaces with the row-alias upsert", async () => {
    const first = await insertGeneration(1);
    const second = await insertGeneration(2);
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.slots.putIncoming(E101, first.id, NOW);
      await tx.slots.putIncoming(E101, second.id, NOW); // upsert replaces
      expect((await tx.slots.incoming(E101))?.generationId).toBe(second.id);
      await tx.slots.clear(E101, "incoming");
      await tx.slots.putSelected(E101, second.id, NOW);
    });
    const holders = await uow.run(async (tx) => ({ incoming: await tx.slots.incoming(E101), selected: await tx.slots.selected(E101) }));
    expect(holders.incoming).toBeNull();
    expect(holders.selected).toMatchObject({ generationId: second.id, trigger: "manual" });
  });
});

describe("generation structure (TX8 input)", () => {
  it("returns items in reading order with sources in citation order, scoped to the event", async () => {
    const { id, itemIds } = await insertGeneration(3);
    const structure = await uow.run((tx) => tx.generations.structure(E101, id));
    expect(structure?.items.map((item) => [item.id, item.section, item.position])).toEqual([
      [itemIds[0], "summary", 0],
      [itemIds[1], "theme", 0],
      [itemIds[2], "conflict", 0],
      [itemIds[3], "suggestion", 0],
    ]);
    expect(structure?.items[1]?.sourceIds).toEqual(["F05", "F06"]);
    expect(structure?.feedbackIds).toHaveLength(8);
    expect(await uow.run((tx) => tx.generations.structure(E101, generationId(99)))).toBeNull();
  });
});

describe("saved briefing writes (TX8)", () => {
  it("replaces the saved wording, keeps references, and lets the replaced generation go", async () => {
    const first = await insertGeneration(4);
    const second = await insertGeneration(5);
    const texts = (ids: string[], prefix: string) => new Map(ids.map((itemId, i) => [itemId, `${prefix} ${String(i)}`]));
    await uow.run(async (tx) => {
      await tx.events.lockForUpdate(E101);
      await tx.savedBriefings.replace({ eventId: E101, generationId: first.id, attendanceOverview: "Overview A", itemTexts: texts(first.itemIds, "A"), savedAt: NOW });
      expect(await tx.generations.deleteIfUnreferenced(E101, first.id)).toBe(false); // the saved briefing holds it
      await tx.savedBriefings.replace({ eventId: E101, generationId: second.id, attendanceOverview: "Overview B", itemTexts: texts(second.itemIds, "B"), savedAt: NOW });
      expect(await tx.generations.deleteIfUnreferenced(E101, first.id)).toBe(true);
      await tx.events.bumpBriefingRevision(E101);
    });
    const saved = await uow.run((tx) => tx.savedBriefings.get(E101));
    expect(saved?.generationId).toBe(second.id);
    expect(saved?.attendanceOverview).toBe("Overview B");
    expect(saved?.itemTexts.get(second.itemIds[1] ?? "")).toBe("B 1");
    expect(await rows("SELECT briefing_revision AS r FROM events")).toEqual([{ r: 1 }]);
    const slots = await uow.readSnapshot((scope) => scope.briefings.loadSlots(E101));
    expect(slots.saved?.content.themes).toEqual([{ text: "B 1", sourceIds: ["F05", "F06"] }]);
  });

  it("returns null when nothing is saved", async () => {
    expect(await uow.run((tx) => tx.savedBriefings.get(E101))).toBeNull();
  });
});
```

The helper's item IDs only have to be unique 36-character ASCII strings: `briefing_items.id` is `CHAR(36) ascii_bin`, not a validated UUID.

Run: `pnpm test:integration`
Expected: FAIL. The type check fails on `tx.slots.selected`, `tx.generations.structure` and `tx.savedBriefings`, or the new file's tests fail.

- [ ] **Step 2: Implement the ports and repositories**

Apply the port additions above to `ports/unit-of-work.ts` (keep `IncomingSlot` as an alias of `SlotHolder`).

`apps/event-api/src/repositories/preview-slot-repository.ts`: replace the body with:

```ts
import { type EventId, type GenerationId, GenerationIdSchema, GenerationTriggerSchema } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import type { PreviewSlotRepository, SlotHolder } from "../ports/unit-of-work.js";
import { parseStoredRow } from "./row-parsing.js";

type SlotName = "selected" | "incoming";

const HolderRowSchema = z.object({
  generation_id: GenerationIdSchema,
  trigger_type: GenerationTriggerSchema,
  input_captured_at: z.date(),
});

export class TypeOrmPreviewSlotRepository implements PreviewSlotRepository {
  constructor(private readonly manager: EntityManager) {}

  incoming(eventId: EventId): Promise<SlotHolder | null> {
    return this.holder(eventId, "incoming");
  }

  selected(eventId: EventId): Promise<SlotHolder | null> {
    return this.holder(eventId, "selected");
  }

  putIncoming(eventId: EventId, generationId: GenerationId, now: Date): Promise<void> {
    return this.put(eventId, "incoming", generationId, now);
  }

  /** The generation must not occupy the other slot (uq_slot_generation): clear it first. */
  putSelected(eventId: EventId, generationId: GenerationId, now: Date): Promise<void> {
    return this.put(eventId, "selected", generationId, now);
  }

  async clear(eventId: EventId, slot: SlotName): Promise<void> {
    await this.manager.query("DELETE FROM preview_slots WHERE event_id = ? AND slot = ?", [eventId, slot]);
  }

  private async holder(eventId: EventId, slot: SlotName): Promise<SlotHolder | null> {
    const rows = await this.manager.query<unknown[]>(
      `SELECT s.generation_id, g.trigger_type, g.input_captured_at
         FROM preview_slots s JOIN briefing_generations g ON g.id = s.generation_id
        WHERE s.event_id = ? AND s.slot = ?`,
      [eventId, slot],
    );
    const [row] = rows;
    if (row === undefined) return null;
    const parsed = parseStoredRow(HolderRowSchema, row, "preview_slots");
    return { generationId: parsed.generation_id, trigger: parsed.trigger_type, inputCapturedAt: parsed.input_captured_at };
  }

  private async put(eventId: EventId, slot: SlotName, generationId: GenerationId, now: Date): Promise<void> {
    await this.manager.query(
      `INSERT INTO preview_slots (event_id, slot, generation_id, updated_at) VALUES (?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE generation_id = new.generation_id, updated_at = new.updated_at`,
      [eventId, slot, generationId, now],
    );
  }
}
```

Add to `TypeOrmGenerationWriteRepository` (`generation-write-repository.ts`):

```ts
  async structure(eventId: EventId, generationId: GenerationId): Promise<GenerationStructure | null> {
    const generation = await this.manager.findOne(GenerationEntity, { where: { id: generationId, eventId } });
    if (generation === null) return null;
    const where = { generationId };
    const items = await this.manager.find(BriefingItemEntity, { where });
    const sources = await this.manager.find(BriefingItemSourceEntity, { where });
    const inputs = await this.manager.find(FeedbackInputEntity, { where });
    const order = (section: ItemSection) => ITEM_SECTIONS.indexOf(section);
    return parseStoredRow(
      StructureSchema,
      {
        attendanceOverview: generation.attendanceOverview,
        feedbackIds: inputs.map((input) => input.feedbackId).toSorted(),
        items: items
          .toSorted((a, b) => order(a.section) - order(b.section) || a.position - b.position)
          .map((item) => ({
            id: item.id,
            section: item.section,
            position: item.position,
            text: item.text,
            sourceIds: sources
              .filter((source) => source.itemId === item.id)
              .toSorted((a, b) => a.position - b.position)
              .map((source) => source.feedbackId),
          })),
      },
      "briefing_items",
    );
  }
```

`StructureSchema` (module-level, same file):

```ts
const StructureSchema = z.object({
  attendanceOverview: z.string().min(1),
  feedbackIds: z.array(FeedbackIdSchema),
  items: z.array(
    z.object({
      id: z.string().length(36),
      section: z.enum(ITEM_SECTIONS),
      position: z.int().min(0).max(9),
      text: z.string().min(1),
      sourceIds: z.array(FeedbackIdSchema),
    }),
  ),
});
```

Import `ITEM_SECTIONS`, `ItemSection` from `../modules/generation/domain/generation-items.js`. Adapters may import domain code: the `event-api-adapters-not-to-application` rule exempts `/domain/`. Import `FeedbackIdSchema` from contracts, `z` from zod, and `type GenerationStructure` from the port.

`apps/event-api/src/repositories/saved-briefing-write-repository.ts`:

```ts
import { type EventId, GenerationIdSchema } from "@event-desk/contracts";
import type { EntityManager } from "typeorm";
import { SavedBriefingEntity, SavedBriefingItemEntity } from "../persistence/entities/briefing-slot.entities.js";
import type { SavedBriefingWrite, SavedBriefingWriteRepository, StoredSavedBriefing } from "../ports/unit-of-work.js";
import { parseStoredRow } from "./row-parsing.js";

export class TypeOrmSavedBriefingWriteRepository implements SavedBriefingWriteRepository {
  constructor(private readonly manager: EntityManager) {}

  async get(eventId: EventId): Promise<StoredSavedBriefing | null> {
    const row = await this.manager.findOne(SavedBriefingEntity, { where: { eventId } });
    if (row === null) return null;
    const texts = await this.manager.find(SavedBriefingItemEntity, { where: { eventId } });
    return {
      generationId: parseStoredRow(GenerationIdSchema, row.generationId, "saved_briefings"),
      attendanceOverview: row.attendanceOverview,
      itemTexts: new Map(texts.map((text) => [text.itemId, text.text])),
    };
  }

  /** T4 TX8 steps 1–3, in an order that keeps every composite FK valid. */
  async replace(saved: SavedBriefingWrite): Promise<void> {
    await this.manager.query("DELETE FROM saved_briefing_items WHERE event_id = ?", [saved.eventId]);
    await this.manager.query(
      `INSERT INTO saved_briefings (event_id, generation_id, attendance_overview, saved_at) VALUES (?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE generation_id = new.generation_id, attendance_overview = new.attendance_overview, saved_at = new.saved_at`,
      [saved.eventId, saved.generationId, saved.attendanceOverview, saved.savedAt],
    );
    const values = [...saved.itemTexts].map(([itemId, text]) => ({
      eventId: saved.eventId,
      generationId: saved.generationId,
      itemId,
      text,
    }));
    if (values.length > 0) await this.manager.insert(SavedBriefingItemEntity, values);
  }
}
```

`event-repository.ts`: add

```ts
  async bumpBriefingRevision(eventId: EventId): Promise<void> {
    await this.manager.increment(EventEntity, { id: eventId }, "briefingRevision", 1);
  }
```

`typeorm-unit-of-work.ts`: `transactionScope` adds `savedBriefings: new TypeOrmSavedBriefingWriteRepository(manager)`.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test:integration`
Expected: PASS, including every Plan 2–3B integration suite. The Plan 3B service still uses `incoming` and `putIncoming`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify && pnpm test:integration`
Expected: exit 0.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): persistence for preview selection and saving — selected slot, structure, saved texts, revision" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: `applyTextEdits` — the pure text-only edit rule (D2, F5)

**Files:**
- Create: `apps/event-api/src/modules/briefing/domain/apply-text-edits.ts`
- Test: `apps/event-api/src/modules/briefing/domain/apply-text-edits.test.ts`

**Interfaces:**
- Consumes:
  - `BriefingTextEdits`, `boundedText`, `TEXT_LIMITS`, `validateEvidenceSections`, `RawEvidenceSections`, `EvidenceIssue`, `FeedbackId` (contracts);
  - `NewItem`, `ItemSection` (`modules/generation/domain/generation-items.ts`).
- Produces:

```ts
/** What a stored generation fixes and an edit may not touch: item IDs, order and sources. */
export interface EditableStructure {
  feedbackIds: readonly FeedbackId[];
  items: readonly NewItem[];
}

export interface EditedWording {
  attendanceOverview: string;
  /** briefing_items.id → the text exactly as typed (trimmed only to validate). */
  itemTexts: ReadonlyMap<string, string>;
}

export type TextEditResult =
  | { ok: true; wording: EditedWording }
  | { ok: false; code: "CONTENT_INVALID" | "REFERENCE_INVALID"; field: string; message: string };

export function applyTextEdits(structure: EditableStructure, edits: BriefingTextEdits): TextEditResult;

/** True when saving `wording` for `generationId` would change nothing (F5: no-op, no new revision). */
export function sameAsSaved(
  saved: { generationId: string; attendanceOverview: string; itemTexts: ReadonlyMap<string, string> } | null,
  generationId: string,
  wording: EditedWording,
): boolean;
```

`GenerationStructure` (Task 1) is structurally assignable to `EditableStructure`, and `StoredSavedBriefing` is assignable to `sameAsSaved`'s first parameter. The domain never imports ports.

**Rules:**
1. **Counts first.** For each text section, the number of entries must equal the stored item count:
   - `feedbackSummary` is one string against the stored `summary` item;
   - `themes` → `theme`, `conflicts` → `conflict`, `suggestions` → `suggestion`.

   A mismatch fails with `CONTENT_INVALID`, `field` `textEdits.<section>`, and the message "Expected N items, got M." Sections are checked in reading order: `feedbackSummary`, `themes`, `conflicts`, `suggestions`.
2. **The overview** must pass `boundedText(TEXT_LIMITS.attendanceOverview)`, else `CONTENT_INVALID` with field `textEdits.attendanceOverview`.
3. **Each position** takes the new text and keeps the stored item's `sourceIds`. The result goes through `validateEvidenceSections(sections, structure.feedbackIds)`. Any source issue (`UNKNOWN_SOURCE`, `TOO_FEW_SOURCES`, `TOO_MANY_SOURCES`, `TOO_MANY_ITEMS`) is a stored-reference fault and wins over text issues: `REFERENCE_INVALID` with field `textEdits.<section>`. Otherwise the first `TEXT_INVALID` is `CONTENT_INVALID` with field `textEdits.<section>.<index>`, or `textEdits.feedbackSummary` for the summary.
4. **The returned texts** are the strings as typed. They are never trimmed or normalised.

- [ ] **Step 1: Write the failing test**

`apps/event-api/src/modules/briefing/domain/apply-text-edits.test.ts`:

```ts
import { type BriefingTextEdits, FeedbackIdSchema } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import type { NewItem } from "../../generation/domain/generation-items.js";
import { applyTextEdits, type EditableStructure, sameAsSaved } from "./apply-text-edits.js";

const ids = (...raw: string[]) => raw.map((id) => FeedbackIdSchema.parse(id));
const item = (id: string, section: NewItem["section"], position: number, sources: string[]): NewItem => ({
  id,
  section,
  position,
  text: `Generated ${id}`,
  sourceIds: ids(...sources),
});
const STRUCTURE: EditableStructure = {
  feedbackIds: ids("F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"),
  items: [
    item("summary-0", "summary", 0, ["F01", "F02"]),
    item("theme-0", "theme", 0, ["F05", "F06"]),
    item("conflict-0", "conflict", 0, ["F03", "F04"]),
    item("suggestion-0", "suggestion", 0, ["F07"]),
  ],
};
const EDITS: BriefingTextEdits = {
  attendanceOverview: "Edited overview.",
  feedbackSummary: "Edited summary.",
  themes: ["  Rest breaks, in our words.  "],
  conflicts: ["Start time."],
  suggestions: ["Route length."],
};

describe("applyTextEdits (D2: wording only)", () => {
  it("F5-01: maps each position to its stored item and keeps the text exactly as typed", () => {
    const result = applyTextEdits(STRUCTURE, EDITS);
    expect(result).toEqual({
      ok: true,
      wording: {
        attendanceOverview: "Edited overview.",
        itemTexts: new Map([
          ["summary-0", "Edited summary."],
          ["theme-0", "  Rest breaks, in our words.  "],
          ["conflict-0", "Start time."],
          ["suggestion-0", "Route length."],
        ]),
      },
    });
  });

  it.each([
    ["themes", { themes: [] }],
    ["conflicts", { conflicts: ["One.", "Two."] }],
    ["suggestions", { suggestions: [] }],
  ] as const)("F5-04: a wrong item count for %s is CONTENT_INVALID on that section", (section, patch) => {
    expect(applyTextEdits(STRUCTURE, { ...EDITS, ...patch })).toMatchObject({
      ok: false,
      code: "CONTENT_INVALID",
      field: `textEdits.${section}`,
    });
  });

  it("F5-04: blank text names the item", () => {
    expect(applyTextEdits(STRUCTURE, { ...EDITS, conflicts: ["   "] })).toMatchObject({
      ok: false,
      code: "CONTENT_INVALID",
      field: "textEdits.conflicts.0",
    });
    expect(applyTextEdits(STRUCTURE, { ...EDITS, attendanceOverview: " " })).toMatchObject({
      ok: false,
      field: "textEdits.attendanceOverview",
    });
  });

  it("F5-13: a stored reference outside the generation's input is REFERENCE_INVALID, never repaired", () => {
    const corrupt: EditableStructure = {
      ...STRUCTURE,
      items: STRUCTURE.items.map((i) => (i.section === "theme" ? { ...i, sourceIds: ids("F05", "F99") } : i)),
    };
    expect(applyTextEdits(corrupt, { ...EDITS, themes: ["   "] })).toMatchObject({
      ok: false,
      code: "REFERENCE_INVALID",
      field: "textEdits.themes",
    });
  });
});

describe("sameAsSaved (F5: a no-op needs no new revision)", () => {
  const applied = applyTextEdits(STRUCTURE, EDITS);
  if (!applied.ok) throw new Error("fixture edits must apply");
  const saved = { generationId: "g1", ...applied.wording };

  it("is true only for the same generation with identical wording", () => {
    expect(sameAsSaved(saved, "g1", applied.wording)).toBe(true);
    expect(sameAsSaved(null, "g1", applied.wording)).toBe(false);
    expect(sameAsSaved(saved, "g2", applied.wording)).toBe(false);
    const changed = new Map(applied.wording.itemTexts).set("theme-0", "Rest breaks.");
    expect(sameAsSaved(saved, "g1", { ...applied.wording, itemTexts: changed })).toBe(false);
    expect(sameAsSaved(saved, "g1", { ...applied.wording, attendanceOverview: "Other." })).toBe(false);
  });
});
```

Run: `pnpm vitest run --project event-api apps/event-api/src/modules/briefing/domain`
Expected: FAIL, "Cannot find module './apply-text-edits.js'".

- [ ] **Step 2: Implement**

`apps/event-api/src/modules/briefing/domain/apply-text-edits.ts`:

```ts
import {
  type BriefingTextEdits,
  boundedText,
  type EvidenceIssue,
  type FeedbackId,
  type RawEvidenceItem,
  TEXT_LIMITS,
  validateEvidenceSections,
} from "@event-desk/contracts";
import type { ItemSection, NewItem } from "../../generation/domain/generation-items.js";

/** What a stored generation fixes and an edit may not touch: item IDs, order and sources. */
export interface EditableStructure {
  feedbackIds: readonly FeedbackId[];
  items: readonly NewItem[];
}

export interface EditedWording {
  attendanceOverview: string;
  /** briefing_items.id → the text exactly as typed (trimmed only to validate). */
  itemTexts: ReadonlyMap<string, string>;
}

export type TextEditResult =
  | { ok: true; wording: EditedWording }
  | { ok: false; code: "CONTENT_INVALID" | "REFERENCE_INVALID"; field: string; message: string };

type TextSection = Exclude<keyof BriefingTextEdits, "attendanceOverview">;

/** Reading order; each text section edits exactly the stored items of one item section. */
const TEXT_SECTIONS = [
  ["feedbackSummary", "summary"],
  ["themes", "theme"],
  ["conflicts", "conflict"],
  ["suggestions", "suggestion"],
] as const satisfies readonly (readonly [TextSection, ItemSection])[];

const textsOf = (edits: BriefingTextEdits, section: TextSection): readonly string[] =>
  section === "feedbackSummary" ? [edits.feedbackSummary] : edits[section];

const fieldOf = (issue: EvidenceIssue): string =>
  issue.section === "feedbackSummary" || issue.index === null
    ? `textEdits.${issue.section}`
    : `textEdits.${issue.section}.${String(issue.index)}`;

/**
 * D2/F5: a save changes wording only. Each position updates its stored item's text; item count,
 * order and sources come from the stored generation and are re-validated, never taken from the
 * client and never repaired.
 */
export function applyTextEdits(structure: EditableStructure, edits: BriefingTextEdits): TextEditResult {
  const paired = new Map<TextSection, { item: NewItem; text: string }[]>();
  for (const [textSection, itemSection] of TEXT_SECTIONS) {
    const stored = structure.items.filter((item) => item.section === itemSection);
    const texts = textsOf(edits, textSection);
    if (texts.length !== stored.length) {
      return {
        ok: false,
        code: "CONTENT_INVALID",
        field: `textEdits.${textSection}`,
        message: `Expected ${String(stored.length)} items, got ${String(texts.length)}.`,
      };
    }
    paired.set(
      textSection,
      stored.map((item, index) => ({ item, text: texts[index] ?? "" })),
    );
  }

  if (!boundedText(TEXT_LIMITS.attendanceOverview).safeParse(edits.attendanceOverview).success) {
    return {
      ok: false,
      code: "CONTENT_INVALID",
      field: "textEdits.attendanceOverview",
      message: `The attendance overview must be 1-${String(TEXT_LIMITS.attendanceOverview)} characters and not blank.`,
    };
  }

  const raw = (section: TextSection): RawEvidenceItem[] =>
    (paired.get(section) ?? []).map(({ item, text }) => ({ text, sourceIds: item.sourceIds }));
  const [summary] = raw("feedbackSummary");
  if (summary === undefined) {
    // Unreachable after the count check (one summary string ⇔ one stored summary item).
    return { ok: false, code: "REFERENCE_INVALID", field: "textEdits.feedbackSummary", message: "The stored summary item is missing." };
  }
  const validation = validateEvidenceSections(
    { feedbackSummary: summary, themes: raw("themes"), conflicts: raw("conflicts"), suggestions: raw("suggestions") },
    structure.feedbackIds,
  );
  if (!validation.ok) {
    const reference = validation.issues.find((issue) => issue.code !== "TEXT_INVALID");
    if (reference !== undefined) {
      return {
        ok: false,
        code: "REFERENCE_INVALID",
        field: `textEdits.${reference.section}`,
        message: `The stored references for this item are invalid (${reference.message}). The briefing cannot be saved; generate a new one.`,
      };
    }
    const [text] = validation.issues;
    return {
      ok: false,
      code: "CONTENT_INVALID",
      field: text === undefined ? "textEdits" : fieldOf(text),
      message: text?.message ?? "The briefing text is invalid.",
    };
  }

  const itemTexts = new Map<string, string>();
  for (const pairs of paired.values()) for (const { item, text } of pairs) itemTexts.set(item.id, text);
  return { ok: true, wording: { attendanceOverview: edits.attendanceOverview, itemTexts } };
}

/** True when saving `wording` for `generationId` would change nothing (F5: no-op, no new revision). */
export function sameAsSaved(
  saved: { generationId: string; attendanceOverview: string; itemTexts: ReadonlyMap<string, string> } | null,
  generationId: string,
  wording: EditedWording,
): boolean {
  if (saved === null || saved.generationId !== generationId) return false;
  if (saved.attendanceOverview !== wording.attendanceOverview) return false;
  if (saved.itemTexts.size !== wording.itemTexts.size) return false;
  return [...wording.itemTexts].every(([itemId, text]) => saved.itemTexts.get(itemId) === text);
}
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm vitest run --project event-api apps/event-api/src/modules/briefing/domain`
Expected: PASS (7 tests).

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0. dependency-cruiser's `domain-is-pure` allows `/domain/` → `/domain/` and contracts.

```bash
git add apps/event-api/src/modules/briefing/domain
git commit -m "feat(event-api): applyTextEdits — wording-only edits re-validated against stored references" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: TX7 — `PreviewSelectionService` and `POST /briefing-preview/select`

**Files:**
- Create: `apps/event-api/src/modules/briefing/preview-selection-service.ts`, `apps/event-api/src/modules/briefing/briefing-controller.ts`
- Modify: `apps/event-api/src/compose.ts`
- Test: `apps/event-api/src/modules/briefing/briefing-api.int.test.ts`

**Interfaces:**
- Consumes:
  - `UnitOfWork`, with `tx.slots.incoming/selected/clear/putSelected` and `tx.generations.deleteIfUnreferenced` (Task 1);
  - `loadBriefingViews`;
  - `EventChangePublisher.publish`;
  - `Clock`;
  - `SelectPreviewRequestSchema`, `SelectPreviewResponse` (contracts).
- Produces:

```ts
export interface SelectPreviewCommand {
  eventId: EventId;
  generationId: GenerationId;
  expectedSelectedGenerationId: GenerationId | null;
}
export class PreviewSelectionService {
  constructor(deps: { uow: UnitOfWork; clock: Clock; changes: Pick<EventChangePublisher, "publish"> });
  select(command: SelectPreviewCommand): Promise<SelectPreviewResponse>;
}
// briefing-controller.ts
export function briefingRoutes(services: {
  selection: Pick<PreviewSelectionService, "select">;
  save: Pick<BriefingSaveService, "save">; // Task 4 adds the PUT route; Task 3 passes only `selection`
}): Router;
```

In Task 3, `briefingRoutes` takes `{ selection }` only. Task 4 widens the parameter to `{ selection, save }`.

**The TX7 order (T4):**
1. `lockForUpdate`.
2. If `incoming?.generationId !== generationId` → `PREVIEW_CONFLICT`, "This preview is no longer waiting for review. Reload to see the latest briefing."
3. If `(selected?.generationId ?? null) !== expectedSelectedGenerationId` → `PREVIEW_CONFLICT`, "The preview being edited changed in another tab. Reload to see the latest briefing."
4. `clear(incoming)`, then `clear(selected)` if one existed, then `putSelected`.
5. Delete the old selected generation with `deleteIfUnreferenced(old)` if one existed.
6. `afterCommit(publish)`.
7. Load the views and return `{ selectedPreview }`. If it is `null`, that is a store fault: throw `STORE_CORRUPT`.

- [ ] **Step 1: Write the failing integration test**

`apps/event-api/src/modules/briefing/briefing-api.int.test.ts`:

```ts
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
import { DEFAULT_ITEMS, insertGenerationFixture, putPreviewSlot } from "../../testing/sql-fixtures.js";
import { integrationConfig, silentLogger } from "../../testing/test-config.js";

const E101 = SUPPLIED_EVENT.id;
const ORIGIN = "http://localhost:5173";
let dataSource: DataSource;
let redis: Redis;
let api: EventApi;

const generationId = (n: number) => GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-${String(n).padStart(12, "0")}`);
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
  request(api.app).post(`/api/events/${E101}/briefing-preview/select`).set("Origin", ORIGIN).send(body);
const view = async () => EventViewSchema.parse((await request(api.app).get(`/api/events/${E101}`)).body);
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
    expect((await select({ generationId: id, expectedSelectedGenerationId: null, slot: "saved" })).status).toBe(400);
    expect((await select({ generationId: "not-a-uuid", expectedSelectedGenerationId: null })).status).toBe(400);
  });
});
```

Run: `pnpm test:integration`
Expected: FAIL. The route is missing, so the requests answer 404 `NOT_FOUND`.

- [ ] **Step 2: Implement the service**

`apps/event-api/src/modules/briefing/preview-selection-service.ts`:

```ts
import type { EventId, GenerationId, SelectPreviewResponse } from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import { loadBriefingViews } from "./briefing-views.js";

export interface SelectPreviewCommand {
  eventId: EventId;
  generationId: GenerationId;
  expectedSelectedGenerationId: GenerationId | null;
}

export interface PreviewSelectionDeps {
  uow: UnitOfWork;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
}

/**
 * TX7 (F7 "Preview ownership"): the coordinator moves the incoming preview into the editor slot.
 * Both slots are compared with what this tab last saw, inside the event lock, so another tab's
 * selection is never silently replaced.
 */
export class PreviewSelectionService {
  constructor(private readonly deps: PreviewSelectionDeps) {}

  select(command: SelectPreviewCommand): Promise<SelectPreviewResponse> {
    const { eventId, generationId } = command;
    return this.deps.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(eventId);
      const incoming = await tx.slots.incoming(eventId);
      if (incoming?.generationId !== generationId) {
        throw new AppError(
          "PREVIEW_CONFLICT",
          "This preview is no longer waiting for review. Reload to see the latest briefing.",
        );
      }
      const selected = await tx.slots.selected(eventId);
      if ((selected?.generationId ?? null) !== command.expectedSelectedGenerationId) {
        throw new AppError(
          "PREVIEW_CONFLICT",
          "The preview being edited changed in another tab. Reload to see the latest briefing.",
        );
      }

      await tx.slots.clear(eventId, "incoming");
      if (selected !== null) await tx.slots.clear(eventId, "selected");
      await tx.slots.putSelected(eventId, generationId, this.deps.clock.now());
      if (selected !== null) await tx.generations.deleteIfUnreferenced(eventId, selected.generationId);
      tx.afterCommit(() => this.deps.changes.publish(eventId));

      const views = await loadBriefingViews(tx, eventId, aggregate.members, aggregate.feedback);
      if (views.selectedPreview === null) {
        throw new AppError("STORE_CORRUPT", "The selected preview could not be read back. The store needs manual recovery.");
      }
      return { selectedPreview: views.selectedPreview };
    });
  }
}
```

`apps/event-api/src/modules/briefing/briefing-controller.ts`:

```ts
import { SelectPreviewRequestSchema } from "@event-desk/contracts";
import express, { type Router } from "express";
import { parseEventId, validateBody } from "../../http/validate.js";
import type { PreviewSelectionService } from "./preview-selection-service.js";

export interface BriefingRouteServices {
  selection: Pick<PreviewSelectionService, "select">;
}

/** Explicit coordinator actions on the briefing (F5, F7): select a preview; save (Task 4). */
export function briefingRoutes({ selection }: BriefingRouteServices): Router {
  const router = express.Router();
  router.post("/events/:eventId/briefing-preview/select", async (req, res) => {
    const eventId = parseEventId(req.params.eventId);
    const body = validateBody(SelectPreviewRequestSchema, req.body);
    res.json(
      await selection.select({
        eventId,
        generationId: body.generationId,
        expectedSelectedGenerationId: body.expectedSelectedGenerationId,
      }),
    );
  });
  return router;
}
```

`compose.ts`:
- After `const attendance = …`, add `const selection = new PreviewSelectionService({ uow, clock, changes });`.
- Append `briefingRoutes({ selection })` to `routes`.
- Import both.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test:integration`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): TX7 select the incoming preview with expected-slot checks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: TX8 — `BriefingSaveService` and `PUT /briefing`

**Files:**
- Create: `apps/event-api/src/modules/briefing/briefing-save-service.ts`
- Modify: `apps/event-api/src/modules/briefing/briefing-controller.ts`, `apps/event-api/src/compose.ts`
- Test: `apps/event-api/src/modules/briefing/briefing-api.int.test.ts` (append)

**Interfaces:**
- Consumes:
  - Task 1: `tx.savedBriefings.get/replace`, `tx.generations.structure/deleteIfUnreferenced`, `tx.slots.selected/clear`, `tx.events.bumpBriefingRevision`;
  - Task 2: `applyTextEdits`, `sameAsSaved`;
  - `loadBriefingViews`;
  - `SaveBriefingRequestSchema`, `SaveBriefingResponse`.
- Produces:

```ts
export interface SaveBriefingCommand {
  eventId: EventId;
  baseBriefingRevision: number;
  generationId: GenerationId;
  textEdits: BriefingTextEdits;
}
export class BriefingSaveService {
  constructor(deps: { uow: UnitOfWork; clock: Clock; changes: Pick<EventChangePublisher, "publish"> });
  save(command: SaveBriefingCommand): Promise<SaveBriefingResponse>;
}
// briefing-controller.ts: BriefingRouteServices gains `save: Pick<BriefingSaveService, "save">`
```

**The TX8 order (T4 steps 1–5, F5 "API contract"):**
1. `lockForUpdate`.
2. If `aggregate.briefingRevision !== baseBriefingRevision` → `BRIEFING_CONFLICT`, "The briefing was saved elsewhere since you loaded it. Your text is kept; reload to see the saved briefing."
3. Resolve the source:
   - `saved = savedBriefings.get()`, `selected = slots.selected()`.
   - `fromSelected = selected?.generationId === generationId`.
   - If `saved?.generationId !== generationId` and not `fromSelected` → `GENERATION_NOT_AVAILABLE`, "This briefing is no longer available to save. Reload to see the latest briefing."
   - The incoming slot is never consulted.
   - When the ID matches both the saved and the selected slot, the selected slot is the source. TX7 and TX8 never put the saved generation into selected, so this is unreachable. Clearing selected keeps it harmless.
4. `structure = generations.structure(eventId, generationId)`. If it is `null` → `GENERATION_NOT_AVAILABLE`, same message.
5. `applyTextEdits(structure, textEdits)`. On failure → `AppError(result.code, result.message, { field: result.field })`.
6. No-op check: `!fromSelected && sameAsSaved(saved, generationId, wording)` → return the current views with no write, no bump and no publish.
7. Otherwise, in order:
   1. `savedBriefings.replace({ …, savedAt: clock.now() })`.
   2. If `fromSelected`, `slots.clear("selected")`.
   3. If `saved !== null` and `saved.generationId !== generationId`, `deleteIfUnreferenced(saved.generationId)`.
   4. `bumpBriefingRevision`.
   5. `afterCommit(publish)`.
8. Return `{ savedBriefing, briefingRevision: aggregate.briefingRevision (+1 when written), selectedPreview }` from `loadBriefingViews`. A `null` `savedBriefing` there is `STORE_CORRUPT`.

Freshness always comes from `loadBriefingViews` against the saved records. Saving never clears staleness (F5-07, F6-12, F6-17).

- [ ] **Step 1: Write the failing tests (append to `briefing-api.int.test.ts`)**

Add to the imports: `ApiErrorBodySchema`, `SaveBriefingResponseSchema` from contracts; `insertSavedBriefing` from sql-fixtures. Add the helpers:

```ts
const saveBriefing = (body: object) =>
  request(api.app).put(`/api/events/${E101}/briefing`).set("Origin", ORIGIN).send(body);
const EDITS = {
  attendanceOverview: "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
  feedbackSummary: "Feedback describes the walk as enjoyable.",
  themes: ["People asked for longer rest breaks."],
  conflicts: ["Start time: earlier suits some, not others."],
  suggestions: ["Review the route length."],
};
const savedTexts = async () =>
  (await dataSource.query<{ item_id: string; text: string }[]>("SELECT item_id, text FROM saved_briefing_items ORDER BY item_id")).map(
    (row) => `${row.item_id}:${row.text}`,
  );
const briefingRevision = async () => count("SELECT briefing_revision AS n FROM events");
```

Then:

```ts
describe("PUT /api/events/:eventId/briefing (TX8)", () => {
  it("F5-01/F6-01: saves the selected preview's wording with its original references and clears that slot", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    const res = await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: EDITS });
    expect(res.status).toBe(200);
    const body = SaveBriefingResponseSchema.parse(res.body);
    expect(body.briefingRevision).toBe(1);
    expect(body.selectedPreview).toBeNull();
    expect(body.savedBriefing.content.themes).toEqual([{ text: "People asked for longer rest breaks.", sourceIds: ["F05", "F06"] }]);
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
    const res = await saveBriefing({ baseBriefingRevision: 0, generationId: next.id, textEdits: EDITS });
    expect(res.status).toBe(200);
    expect(SaveBriefingResponseSchema.parse(res.body).savedBriefing.provenance.generationId).toBe(next.id);
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
    const res = await saveBriefing({ baseBriefingRevision: 0, generationId: saved.id, textEdits: EDITS });
    expect(res.status).toBe(200);
    expect(SaveBriefingResponseSchema.parse(res.body).selectedPreview?.provenance.generationId).toBe(selected.id);
  });

  it("a no-op save writes nothing and keeps the revision", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    expect((await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: EDITS })).status).toBe(200);
    const again = await saveBriefing({ baseBriefingRevision: 1, generationId: id, textEdits: EDITS });
    expect(again.status).toBe(200);
    expect(SaveBriefingResponseSchema.parse(again.body).briefingRevision).toBe(1);
    expect(await briefingRevision()).toBe(1);
  });

  it("Review Focus 1 / F5-06 / F6-11: a stale revision is rejected and changes nothing", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    expect((await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: EDITS })).status).toBe(200);
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
      { baseBriefingRevision: 0, generationId: id, textEdits: { ...EDITS, themes: [{ text: "x", sourceIds: ["F01"] }] } },
      { baseBriefingRevision: 0, generationId: id, textEdits: { ...EDITS, sourceIds: ["F01"] } },
      { baseBriefingRevision: 0, generationId: id, textEdits: EDITS, provenance: { generatedAt: "2026-10-04T00:00:00.000Z" } },
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
    const extra = await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: { ...EDITS, themes: ["One.", "Two."] } });
    expect(extra.status).toBe(422);
    expect(errorCodeOf(extra)).toBe("CONTENT_INVALID");
    expect(ApiErrorBodySchema.parse(extra.body).error.field).toBe("textEdits.themes");
    const blank = await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: { ...EDITS, conflicts: ["   "] } });
    expect(blank.status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM saved_briefings")).toBe(0);
  });

  it("F5-13: the incoming preview or an unknown generation is GENERATION_NOT_AVAILABLE", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "incoming", id);
    const incoming = await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: EDITS });
    expect(incoming.status).toBe(409);
    expect(errorCodeOf(incoming)).toBe("GENERATION_NOT_AVAILABLE");
    const unknown = await saveBriefing({ baseBriefingRevision: 0, generationId: generationId(42), textEdits: EDITS });
    expect(errorCodeOf(unknown)).toBe("GENERATION_NOT_AVAILABLE");
  });

  it("F5-13: a corrupt stored reference is REFERENCE_INVALID and nothing is saved", async () => {
    const { id } = await insertGeneration(1);
    await putPreviewSlot(dataSource, "selected", id);
    // fk_source_input cascades: the F07 suggestion is left citing no note, which only direct
    // corruption can cause. The save must refuse it, never bind the text to other sources.
    await dataSource.query("DELETE FROM generation_feedback_inputs WHERE generation_id = ? AND feedback_id = 'F07'", [id]);
    const res = await saveBriefing({ baseBriefingRevision: 0, generationId: id, textEdits: EDITS });
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
```

The last test's `provenance.input.counts` are the snapshot's own counts (1 attended, 1 not recorded), not the current ones (F5-08).

Run: `pnpm test:integration`
Expected: FAIL. `PUT /briefing` answers 404.

- [ ] **Step 2: Implement the service**

`apps/event-api/src/modules/briefing/briefing-save-service.ts`:

```ts
import type { BriefingTextEdits, EventId, GenerationId, SaveBriefingResponse } from "@event-desk/contracts";
import type { Clock } from "../../ports/clock.js";
import type { UnitOfWork } from "../../ports/unit-of-work.js";
import { AppError } from "../../shared/app-error.js";
import type { EventChangePublisher } from "../changes/event-change-publisher.js";
import { loadBriefingViews } from "./briefing-views.js";
import { applyTextEdits, sameAsSaved } from "./domain/apply-text-edits.js";

export interface SaveBriefingCommand {
  eventId: EventId;
  baseBriefingRevision: number;
  generationId: GenerationId;
  textEdits: BriefingTextEdits;
}

export interface BriefingSaveDeps {
  uow: UnitOfWork;
  clock: Clock;
  changes: Pick<EventChangePublisher, "publish">;
}

const notAvailable = () =>
  new AppError(
    "GENERATION_NOT_AVAILABLE",
    "This briefing is no longer available to save. Reload to see the latest briefing.",
  );

/**
 * TX8 (F5 "API contract", T4): the only path that writes the saved briefing. Structure,
 * references and provenance come from the stored generation; the client supplies wording only.
 */
export class BriefingSaveService {
  constructor(private readonly deps: BriefingSaveDeps) {}

  save(command: SaveBriefingCommand): Promise<SaveBriefingResponse> {
    const { eventId, generationId } = command;
    return this.deps.uow.run(async (tx) => {
      const aggregate = await tx.events.lockForUpdate(eventId);
      if (aggregate.briefingRevision !== command.baseBriefingRevision) {
        throw new AppError(
          "BRIEFING_CONFLICT",
          "The briefing was saved elsewhere since you loaded it. Your text is kept; reload to see the saved briefing.",
        );
      }
      const saved = await tx.savedBriefings.get(eventId);
      const selected = await tx.slots.selected(eventId);
      const fromSelected = selected?.generationId === generationId;
      // Never the incoming slot: a preview is saved only after the coordinator selected it (F7).
      if (!fromSelected && saved?.generationId !== generationId) throw notAvailable();
      const structure = await tx.generations.structure(eventId, generationId);
      if (structure === null) throw notAvailable();

      const applied = applyTextEdits(structure, command.textEdits);
      if (!applied.ok) throw new AppError(applied.code, applied.message, { field: applied.field });

      let briefingRevision = aggregate.briefingRevision;
      if (fromSelected || !sameAsSaved(saved, generationId, applied.wording)) {
        // T4 TX8 steps 1–5, in an order that keeps every foreign key valid.
        await tx.savedBriefings.replace({ eventId, generationId, ...applied.wording, savedAt: this.deps.clock.now() });
        if (fromSelected) await tx.slots.clear(eventId, "selected");
        if (saved !== null && saved.generationId !== generationId) {
          await tx.generations.deleteIfUnreferenced(eventId, saved.generationId);
        }
        await tx.events.bumpBriefingRevision(eventId);
        briefingRevision += 1;
        tx.afterCommit(() => this.deps.changes.publish(eventId));
      }

      const views = await loadBriefingViews(tx, eventId, aggregate.members, aggregate.feedback);
      if (views.savedBriefing === null) {
        throw new AppError("STORE_CORRUPT", "The saved briefing could not be read back. The store needs manual recovery.");
      }
      return { savedBriefing: views.savedBriefing, briefingRevision, selectedPreview: views.selectedPreview };
    });
  }
}
```

`briefing-controller.ts`: widen `BriefingRouteServices` with `save: Pick<BriefingSaveService, "save">`, and add:

```ts
  router.put("/events/:eventId/briefing", async (req, res) => {
    const eventId = parseEventId(req.params.eventId);
    const body = validateBody(SaveBriefingRequestSchema, req.body);
    res.json(
      await save.save({
        eventId,
        baseBriefingRevision: body.baseBriefingRevision,
        generationId: body.generationId,
        textEdits: body.textEdits,
      }),
    );
  });
```

`compose.ts`: add `const briefingSave = new BriefingSaveService({ uow, clock, changes });` and pass `briefingRoutes({ selection, save: briefingSave })`.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test:integration`
Expected: PASS, including Task 3's tests.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/event-api/src
git commit -m "feat(event-api): TX8 save the briefing — wording only, revision-checked, explicit replacement" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Web data layer — select and save endpoints, mutations, cache merges, fake API

**Files:**
- Modify: `apps/web/src/data/api/event-api.ts`, `apps/web/src/testing/fake-event-api.ts`
- Create: `apps/web/src/data/mutations/briefing-cache.ts`, `apps/web/src/data/mutations/use-select-preview.ts`, `apps/web/src/data/mutations/use-save-briefing.ts`
- Test: `apps/web/src/data/mutations/briefing-cache.test.ts`, `apps/web/src/data/api/event-api.test.ts` (append)

**Interfaces:**
- Consumes: `SelectPreviewRequest/Response`, `SaveBriefingRequest/Response` and their schemas (contracts); `apiClient`, `parseResponse`, `queryKeys`.
- Produces:

```ts
// event-api.ts
export function selectPreview(eventId: EventId, body: SelectPreviewRequest): Promise<SelectPreviewResponse>;
export function saveBriefing(eventId: EventId, body: SaveBriefingRequest): Promise<SaveBriefingResponse>;
// briefing-cache.ts
export function applyPreviewSelected(view: EventView, response: SelectPreviewResponse): EventView;
export function applyBriefingSaved(view: EventView, response: SaveBriefingResponse): EventView;
// use-select-preview.ts — the variable is the incoming generation's ID; the expected selection is
// the selected preview this tab currently shows (the cached view), read when the request starts.
export function useSelectPreview(eventId: EventId): UseMutationResult<SelectPreviewResponse, ApiError, GenerationId>;
// use-save-briefing.ts
export function useSaveBriefing(eventId: EventId): UseMutationResult<SaveBriefingResponse, ApiError, SaveBriefingRequest>;
// fake-event-api.ts (test helper)
//   readonly selectRequests: unknown[]; readonly saveRequests: unknown[];
//   saveBriefingElsewhere(): void   — another tab saved: bumps briefingRevision only
//   putIncoming(preview: BriefingView): void — a result from elsewhere lands in the incoming slot
```

**Cache rules (F6 race 4, "never roll the displayed revision backward"):**
- `applyPreviewSelected` sets `selectedPreview` from the response and `incomingPreview: null`. This holds only when the cached incoming preview is the selected one; otherwise it leaves the incoming slot as cached. Everything else is unchanged.
- `applyBriefingSaved` returns `view` unchanged when `response.briefingRevision < view.briefingRevision`. Otherwise it sets `savedBriefing`, `briefingRevision` and `selectedPreview` from the response.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/data/mutations/briefing-cache.test.ts`:

```ts
import { GenerationIdSchema } from "@event-desk/contracts";
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { applyBriefingSaved, applyPreviewSelected } from "./briefing-cache";

const OTHER = GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000002");

describe("applyPreviewSelected", () => {
  it("moves the selected generation out of the incoming slot", () => {
    const preview = buildBriefingView();
    const next = applyPreviewSelected(buildSeedEventView({ incomingPreview: preview }), { selectedPreview: preview });
    expect(next.selectedPreview).toEqual(preview);
    expect(next.incomingPreview).toBeNull();
  });

  it("keeps a newer incoming preview that arrived meanwhile", () => {
    const selected = buildBriefingView();
    const newer = buildBriefingView({ provenance: { ...selected.provenance, generationId: OTHER } });
    const next = applyPreviewSelected(buildSeedEventView({ incomingPreview: newer }), { selectedPreview: selected });
    expect(next.incomingPreview).toEqual(newer);
  });
});

describe("applyBriefingSaved", () => {
  it("applies the saved briefing, revision and selected slot", () => {
    const saved = buildBriefingView({ savedAt: "2026-10-04T10:00:00.000Z" });
    const view = buildSeedEventView({ selectedPreview: buildBriefingView() });
    const next = applyBriefingSaved(view, { savedBriefing: saved, briefingRevision: 1, selectedPreview: null });
    expect(next).toEqual({ ...view, savedBriefing: saved, briefingRevision: 1, selectedPreview: null });
  });

  it("F6 race 4: an older response never rolls the revision back", () => {
    const view = buildSeedEventView({ briefingRevision: 3 });
    const stale = { savedBriefing: buildBriefingView(), briefingRevision: 2, selectedPreview: null };
    expect(applyBriefingSaved(view, stale)).toBe(view);
  });
});
```

Append to `apps/web/src/data/api/event-api.test.ts`. Add `selectPreview`, `saveBriefing` to the import from `./event-api`, and `buildBriefingView` from `@event-desk/contracts/testing`:

```ts
describe("selectPreview and saveBriefing", () => {
  it("select returns the contract-validated selected preview", async () => {
    const preview = buildBriefingView();
    api.putIncoming(preview);
    const response = await selectPreview(E101, {
      generationId: preview.provenance.generationId,
      expectedSelectedGenerationId: null,
    });
    expect(response.selectedPreview.provenance.generationId).toBe(preview.provenance.generationId);
    expect(api.view.incomingPreview).toBeNull();
  });

  it("save returns the saved briefing and the next revision; a stale revision is BRIEFING_CONFLICT", async () => {
    const preview = buildBriefingView();
    api.view = { ...api.view, selectedPreview: preview };
    const textEdits = {
      attendanceOverview: preview.content.attendanceOverview,
      feedbackSummary: "Edited summary.",
      themes: preview.content.themes.map((item) => item.text),
      conflicts: preview.content.conflicts.map((item) => item.text),
      suggestions: preview.content.suggestions.map((item) => item.text),
    };
    const generationId = preview.provenance.generationId;
    const saved = await saveBriefing(E101, { baseBriefingRevision: 0, generationId, textEdits });
    expect(saved.briefingRevision).toBe(1);
    expect(saved.savedBriefing.content.feedbackSummary).toEqual({
      text: "Edited summary.",
      sourceIds: preview.content.feedbackSummary.sourceIds,
    });
    const error = await failureOf(saveBriefing(E101, { baseBriefingRevision: 0, generationId, textEdits }));
    expect(error).toMatchObject({ kind: "http", status: 409, code: "BRIEFING_CONFLICT" });
  });
});
```

Run: `pnpm vitest run --project web apps/web/src/data`
Expected: FAIL. The modules or exports are missing.

- [ ] **Step 2: Implement**

`event-api.ts`: add the imports and:

```ts
export async function selectPreview(
  eventId: EventId,
  body: SelectPreviewRequest,
): Promise<SelectPreviewResponse> {
  const response = await apiClient.post<unknown>(`${eventPath(eventId)}/briefing-preview/select`, body);
  return parseResponse(SelectPreviewResponseSchema, response.data);
}

export async function saveBriefing(
  eventId: EventId,
  body: SaveBriefingRequest,
): Promise<SaveBriefingResponse> {
  const response = await apiClient.put<unknown>(`${eventPath(eventId)}/briefing`, body);
  return parseResponse(SaveBriefingResponseSchema, response.data);
}
```

`briefing-cache.ts`:

```ts
import type { EventView, SaveBriefingResponse, SelectPreviewResponse } from "@event-desk/contracts";

/** TX7 moved the incoming preview to selected; a newer incoming preview that arrived meanwhile stays. */
export function applyPreviewSelected(view: EventView, response: SelectPreviewResponse): EventView {
  const selectedId = response.selectedPreview.provenance.generationId;
  return {
    ...view,
    selectedPreview: response.selectedPreview,
    incomingPreview:
      view.incomingPreview?.provenance.generationId === selectedId ? null : view.incomingPreview,
  };
}

/** TX8's result; an older response never rolls the displayed revision backward (F6 race 4). */
export function applyBriefingSaved(view: EventView, response: SaveBriefingResponse): EventView {
  if (response.briefingRevision < view.briefingRevision) return view;
  return {
    ...view,
    savedBriefing: response.savedBriefing,
    briefingRevision: response.briefingRevision,
    selectedPreview: response.selectedPreview,
  };
}
```

`use-select-preview.ts`:

```ts
import type { EventId, EventView, GenerationId } from "@event-desk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { selectPreview } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";
import { applyPreviewSelected } from "./briefing-cache";

/**
 * TX7: open the incoming preview for editing. The expected selection is the one this tab shows
 * now, so another tab's selection meanwhile is a conflict, never silently replaced (F6 race 3).
 */
export function useSelectPreview(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (generationId: GenerationId) => {
      const view = queryClient.getQueryData<EventView>(queryKeys.event(eventId));
      return selectPreview(eventId, {
        generationId,
        expectedSelectedGenerationId: view?.selectedPreview?.provenance.generationId ?? null,
      });
    },
    meta: {
      errorToast: "The new preview was not opened",
      unknownOutcomeToast: "Could not confirm opening the preview. Checking the briefing…",
    },
    onSuccess: (response) => {
      queryClient.setQueryData<EventView>(queryKeys.event(eventId), (view) =>
        view === undefined ? view : applyPreviewSelected(view, response),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}
```

`use-save-briefing.ts`:

```ts
import type { EventId, EventView, SaveBriefingRequest } from "@event-desk/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveBriefing } from "../api/event-api";
import { queryKeys } from "../queries/query-keys";
import { applyBriefingSaved } from "./briefing-cache";

/** TX8: wording only (D2). Never retried automatically; a lost response is reconciled by the editor (F5). */
export function useSaveBriefing(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveBriefingRequest) => saveBriefing(eventId, body),
    meta: {
      successToast: "Briefing saved",
      errorToast: "Briefing was not saved",
      unknownOutcomeToast: "Could not confirm the briefing save. Checking the saved briefing…",
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<EventView>(queryKeys.event(eventId), (view) =>
        view === undefined ? view : applyBriefingSaved(view, saved),
      );
    },
    // As for attendance: after an unknown outcome the editor runs its own single re-read (F5).
    onSettled: (_saved, error) =>
      error?.outcomeUnknown === true
        ? undefined
        : queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) }),
  });
}
```

`fake-event-api.ts`. Add the imports (`SaveBriefingRequestSchema`, `SelectPreviewRequestSchema`, `type BriefingContent`, `type EvidenceItem`), the fields `readonly selectRequests: unknown[] = []` and `readonly saveRequests: unknown[] = []`, and these methods:

```ts
  /** Another tab saved the briefing: only the revision is visible to this tab's next save. */
  saveBriefingElsewhere(): void {
    this.view = { ...this.view, briefingRevision: this.view.briefingRevision + 1 };
  }

  /** A result from elsewhere (another tab, or a batch in Plan 5) lands in the incoming slot. */
  putIncoming(preview: BriefingView): void {
    this.view = { ...this.view, incomingPreview: preview };
  }
```

Add these handlers to `handlers()`. They follow the server's order: schema (400), revision (409), source (409), counts (422):

```ts
      http.post("/api/events/:eventId/briefing-preview/select", async ({ request }) => {
        const body: unknown = await request.json();
        this.selectRequests.push(body);
        const parsed = SelectPreviewRequestSchema.safeParse(body);
        if (!parsed.success) return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid select body.");
        const incoming = this.view.incomingPreview;
        const selectedId = this.view.selectedPreview?.provenance.generationId ?? null;
        if (incoming?.provenance.generationId !== parsed.data.generationId || selectedId !== parsed.data.expectedSelectedGenerationId) {
          return apiErrorResponse(409, "PREVIEW_CONFLICT", "This preview is no longer waiting for review. Reload to see the latest briefing.");
        }
        this.view = { ...this.view, selectedPreview: incoming, incomingPreview: null };
        return HttpResponse.json({ selectedPreview: incoming });
      }),
      http.put("/api/events/:eventId/briefing", async ({ request }) => {
        const body: unknown = await request.json();
        this.saveRequests.push(body);
        const parsed = SaveBriefingRequestSchema.safeParse(body);
        if (!parsed.success) return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid briefing body.");
        const { baseBriefingRevision, generationId, textEdits } = parsed.data;
        if (baseBriefingRevision !== this.view.briefingRevision) {
          return apiErrorResponse(409, "BRIEFING_CONFLICT", "The briefing was saved elsewhere since you loaded it. Your text is kept; reload to see the saved briefing.");
        }
        const fromSelected = this.view.selectedPreview?.provenance.generationId === generationId;
        const source = fromSelected ? this.view.selectedPreview : this.view.savedBriefing?.provenance.generationId === generationId ? this.view.savedBriefing : null;
        if (source === null) {
          return apiErrorResponse(409, "GENERATION_NOT_AVAILABLE", "This briefing is no longer available to save. Reload to see the latest briefing.");
        }
        const sections = ["themes", "conflicts", "suggestions"] as const;
        const wrong = sections.find((section) => textEdits[section].length !== source.content[section].length);
        if (wrong !== undefined) {
          return apiErrorResponse(422, "CONTENT_INVALID", `Expected ${String(source.content[wrong].length)} items.`, `textEdits.${wrong}`);
        }
        const retext = (items: readonly EvidenceItem[], texts: readonly string[]) =>
          items.map((item, index) => ({ text: texts[index] ?? item.text, sourceIds: item.sourceIds }));
        const content: BriefingContent = {
          attendanceOverview: textEdits.attendanceOverview,
          feedbackSummary: { text: textEdits.feedbackSummary, sourceIds: source.content.feedbackSummary.sourceIds },
          themes: retext(source.content.themes, textEdits.themes),
          conflicts: retext(source.content.conflicts, textEdits.conflicts),
          suggestions: retext(source.content.suggestions, textEdits.suggestions),
        };
        const savedBriefing: BriefingView = { ...source, content, savedAt: new Date().toISOString() };
        this.view = {
          ...this.view,
          savedBriefing,
          selectedPreview: fromSelected ? null : this.view.selectedPreview,
          briefingRevision: this.view.briefingRevision + 1,
        };
        return HttpResponse.json({
          savedBriefing,
          briefingRevision: this.view.briefingRevision,
          selectedPreview: this.view.selectedPreview,
        });
      }),
```

The fake always bumps the revision. The server's no-op rule is pinned by Task 4's integration tests; the UI never relies on it.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm vitest run --project web apps/web/src/data`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0. `web-data-layer-has-no-ui` holds: no Astryx or feature imports in `data/`.

```bash
git add apps/web/src
git commit -m "feat(web): select and save briefing data layer with revision-safe cache merges" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Shared briefing UI — dirty flag, active briefing, source disclosure, freshness notice, "New since this briefing"

**Files:**
- Modify:
  - `apps/web/src/state/ui-store.ts`, `apps/web/src/testing/setup.ts`;
  - `apps/web/src/features/attendance/attendance-counts.tsx` (export the formatter);
  - `apps/web/src/features/feedback/feedback-panel.tsx`, `apps/web/src/features/event/event-page.tsx`.
- Create:
  - `apps/web/src/features/briefing/active-briefing.ts`, `apps/web/src/features/briefing/freshness-text.ts`;
  - `apps/web/src/features/briefing/freshness-notice.tsx`, `apps/web/src/features/feedback/source-reference.tsx`.
- Test:
  - `apps/web/src/features/briefing/active-briefing.test.ts`, `apps/web/src/features/briefing/freshness-text.test.ts`;
  - `apps/web/src/features/feedback/source-reference.test.tsx`, `apps/web/src/features/feedback/feedback-panel.test.tsx` (append).

**Interfaces:**
- Produces:

```ts
// state/ui-store.ts — UiState gains:
briefingDirty: boolean;
setBriefingDirty: (dirty: boolean) => void;

// features/attendance/attendance-counts.tsx
export function formatAttendanceCounts(c: AttendanceCounts): string; // "4 registered · 1 attended · 2 absent · 1 not recorded"

// features/briefing/active-briefing.ts
export type EditableSlot = "selected" | "saved";
export interface ActiveBriefing { slot: EditableSlot; briefing: BriefingView }
/** What the editor works on: the selected preview, else the saved briefing (F7). */
export function activeBriefing(view: EventView): ActiveBriefing | null;
/** What the page shows: the active briefing, else the unreviewed incoming preview. */
export function displayedBriefing(view: EventView): BriefingView | null;

// features/briefing/freshness-text.ts
export function freshnessTitle(freshness: Freshness): string | null; // null when current
export function attendanceChangeLines(freshness: Freshness, members: readonly Member[]): string[];
export function newNotesLine(freshness: Freshness): string | null;

// features/briefing/freshness-notice.tsx
export function FreshnessNotice(props: { briefing: BriefingView; members: readonly Member[]; counts: AttendanceCounts }): JSX.Element;

// features/feedback/source-reference.tsx
export function SourceReferences(props: { sourceIds: readonly FeedbackId[]; notes: readonly FeedbackNote[] }): JSX.Element;

// features/feedback/feedback-panel.tsx — new optional prop:
newSinceBriefing?: ReadonlySet<FeedbackId>; // notes not in the displayed briefing's input
```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/briefing/active-briefing.test.ts`:

```ts
import { GenerationIdSchema } from "@event-desk/contracts";
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { activeBriefing, displayedBriefing } from "./active-briefing";

const other = (n: number) => {
  const base = buildBriefingView();
  return buildBriefingView({
    provenance: { ...base.provenance, generationId: GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-00000000000${String(n)}`) },
  });
};

describe("activeBriefing / displayedBriefing (F7)", () => {
  it("prefers the selected preview, then the saved briefing; never the incoming one", () => {
    const saved = other(1);
    const selected = other(2);
    const incoming = other(3);
    expect(activeBriefing(buildSeedEventView({ savedBriefing: saved, selectedPreview: selected }))).toEqual({ slot: "selected", briefing: selected });
    expect(activeBriefing(buildSeedEventView({ savedBriefing: saved, incomingPreview: incoming }))).toEqual({ slot: "saved", briefing: saved });
    expect(activeBriefing(buildSeedEventView({ incomingPreview: incoming }))).toBeNull();
    expect(displayedBriefing(buildSeedEventView({ incomingPreview: incoming }))).toEqual(incoming);
    expect(displayedBriefing(buildSeedEventView())).toBeNull();
  });
});
```

`apps/web/src/features/briefing/freshness-text.test.ts`:

```ts
import { FeedbackIdSchema, MemberIdSchema, SUPPLIED_MEMBERS, type Freshness } from "@event-desk/contracts";
import { describe, expect, it } from "vitest";
import { attendanceChangeLines, freshnessTitle, newNotesLine } from "./freshness-text";

const CURRENT: Freshness = { current: true, attendanceChanges: [], newFeedbackIds: [] };
const ATTENDANCE: Freshness = {
  current: false,
  attendanceChanges: [{ memberId: MemberIdSchema.parse("M03"), from: "not_recorded", to: "attended" }],
  newFeedbackIds: [FeedbackIdSchema.parse("F09"), FeedbackIdSchema.parse("F10")],
};
const NOTES_ONLY: Freshness = { current: false, attendanceChanges: [], newFeedbackIds: [FeedbackIdSchema.parse("F09")] };

describe("freshness text (D5, F6)", () => {
  it("titles: attendance first, then notes; nothing when current", () => {
    expect(freshnessTitle(CURRENT)).toBeNull();
    expect(freshnessTitle(ATTENDANCE)).toBe("Out of date — attendance changed since this briefing was generated");
    expect(freshnessTitle(NOTES_ONLY)).toBe("Out of date — new feedback since this briefing was generated");
  });

  it("names members and their change", () => {
    expect(attendanceChangeLines(ATTENDANCE, SUPPLIED_MEMBERS)).toEqual(["Chris: Not recorded → Attended"]);
  });

  it("lists new notes with a correct plural", () => {
    expect(newNotesLine(ATTENDANCE)).toBe("2 new notes since this briefing: F09, F10");
    expect(newNotesLine(NOTES_ONLY)).toBe("1 new note since this briefing: F09");
    expect(newNotesLine(CURRENT)).toBeNull();
  });
});
```

`apps/web/src/features/feedback/source-reference.test.tsx`:

```tsx
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { FeedbackIdSchema, SUPPLIED_FEEDBACK } from "@event-desk/contracts";
import { FIXTURE_TIME } from "@event-desk/contracts/testing";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SourceReferences } from "./source-reference";

const NOTES = SUPPLIED_FEEDBACK.map((note) => ({ ...note, receivedAt: FIXTURE_TIME }));
const ids = (...raw: string[]) => raw.map((id) => FeedbackIdSchema.parse(id));

describe("SourceReferences (F3 inspection)", () => {
  it("Review Focus 5: a keyboard user opens a cited note inline and the toggle states it", async () => {
    const user = userEvent.setup();
    render(
      <Theme theme={neutralTheme}>
        <SourceReferences sourceIds={ids("F05", "F06")} notes={NOTES} />
      </Theme>,
    );
    const toggle = screen.getByRole("button", { name: "Read source F05" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const controlled = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(controlled?.hidden).toBe(false);
    expect(controlled?.textContent).toContain(NOTES[4]?.text);
    expect(document.activeElement).toBe(toggle); // inspection never moves focus
    await user.keyboard("{Enter}");
    expect(controlled?.hidden).toBe(true);
  });

  it("F3: an ID missing from the event's notes is an error, never a note", () => {
    render(
      <Theme theme={neutralTheme}>
        <SourceReferences sourceIds={ids("F99")} notes={NOTES} />
      </Theme>,
    );
    expect(screen.getByText("Source F99 is unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Read source F99" })).toBeNull();
  });
});
```

Append to `apps/web/src/features/feedback/feedback-panel.test.tsx` (add `buildBriefingView` to the testing import):

```tsx
  it("F6-18: notes outside the displayed briefing's input say so", async () => {
    const briefing = buildBriefingView({
      freshness: { current: false, attendanceChanges: [], newFeedbackIds: [FeedbackIdSchema.parse("F08")] },
    });
    api.view = { ...api.view, savedBriefing: briefing };
    renderApp();
    const items = (await panel()).getAllByRole("listitem");
    expect(within(items[7] ?? document.body).getByText("New since this briefing")).toBeTruthy();
    expect(within(items[0] ?? document.body).queryByText("New since this briefing")).toBeNull();
  });
```

Run: `pnpm vitest run --project web apps/web/src/features`
Expected: FAIL. The new modules are missing and the badge is absent.

- [ ] **Step 2: Implement**

`state/ui-store.ts`: add `briefingDirty: false` and `setBriefingDirty: (briefingDirty) => { set({ briefingDirty }); }` beside the attendance pair. `testing/setup.ts`: change the reset to `useUiStore.setState({ attendanceDirty: false, briefingDirty: false });`.

`attendance-counts.tsx`: rename the local `describe` to an exported `formatAttendanceCounts` (same body), and use it in `AttendanceCounts`.

`features/briefing/active-briefing.ts`:

```ts
import type { BriefingView, EventView } from "@event-desk/contracts";

export type EditableSlot = "selected" | "saved";
export interface ActiveBriefing {
  slot: EditableSlot;
  briefing: BriefingView;
}

/** What the editor works on: the selected preview, else the saved briefing (F7). Never incoming. */
export function activeBriefing(view: EventView): ActiveBriefing | null {
  if (view.selectedPreview !== null) return { slot: "selected", briefing: view.selectedPreview };
  if (view.savedBriefing !== null) return { slot: "saved", briefing: view.savedBriefing };
  return null;
}

/** What the page shows: the active briefing, else the unreviewed incoming preview. */
export function displayedBriefing(view: EventView): BriefingView | null {
  return activeBriefing(view)?.briefing ?? view.incomingPreview;
}
```

`features/briefing/freshness-text.ts`:

```ts
import { ATTENDANCE_LABELS, type Freshness, type Member } from "@event-desk/contracts";

/** D5/F6: attendance is named first because it changes the counts the overview states. */
export function freshnessTitle(freshness: Freshness): string | null {
  if (freshness.current) return null;
  return freshness.attendanceChanges.length > 0
    ? "Out of date — attendance changed since this briefing was generated"
    : "Out of date — new feedback since this briefing was generated";
}

export function attendanceChangeLines(freshness: Freshness, members: readonly Member[]): string[] {
  const names = new Map(members.map((member) => [member.id as string, member.name]));
  return freshness.attendanceChanges.map(
    (change) => `${names.get(change.memberId) ?? change.memberId}: ${ATTENDANCE_LABELS[change.from]} → ${ATTENDANCE_LABELS[change.to]}`,
  );
}

export function newNotesLine(freshness: Freshness): string | null {
  const ids = freshness.newFeedbackIds;
  if (ids.length === 0) return null;
  return `${String(ids.length)} new ${ids.length === 1 ? "note" : "notes"} since this briefing: ${ids.join(", ")}`;
}
```

`features/briefing/freshness-notice.tsx`:

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { AttendanceCounts, BriefingView, Member } from "@event-desk/contracts";
import { formatAttendanceCounts } from "../attendance/attendance-counts";
import { attendanceChangeLines, freshnessTitle, newNotesLine } from "./freshness-text";

/** Freshness comes only from the server (D5); this states it in words, with both sets of counts. */
export function FreshnessNotice({
  briefing,
  members,
  counts,
}: {
  briefing: BriefingView;
  members: readonly Member[];
  counts: AttendanceCounts;
}) {
  const title = freshnessTitle(briefing.freshness);
  if (title === null) {
    return <Text type="supporting">Up to date with the saved attendance and feedback.</Text>;
  }
  const notes = newNotesLine(briefing.freshness);
  return (
    <Banner
      status="warning"
      title={title}
      description={
        <VStack gap={1}>
          {attendanceChangeLines(briefing.freshness, members).map((line) => (
            <Text key={line}>{line}</Text>
          ))}
          {notes === null ? null : <Text>{notes}</Text>}
          <Text>Generated from: {formatAttendanceCounts(briefing.provenance.input.counts)}</Text>
          <Text>Saved records now: {formatAttendanceCounts(counts)}</Text>
          <Text type="supporting">Saving edited text keeps this warning; generate again to update it.</Text>
        </VStack>
      }
    />
  );
}
```

`features/feedback/source-reference.tsx`:

```tsx
import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { FeedbackId, FeedbackNote } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { useId, useState } from "react";

const styles = stylex.create({
  list: { listStyle: "none", margin: 0, padding: 0 },
  note: { minWidth: 0, overflowWrap: "anywhere" },
});

function SourceToggle({ note, panelId }: { note: FeedbackNote; panelId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <VStack gap={1}>
      <div>
        <Button
          variant="ghost"
          size="sm"
          label={`Read source ${note.id}`}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => {
            setIsOpen((open) => !open);
          }}
        />
      </div>
      <div id={panelId} hidden={!isOpen}>
        <HStack gap={2}>
          <Badge variant="neutral" label={note.id} />
          <div {...stylex.props(styles.note)}>
            <Text>{note.text}</Text>
          </div>
        </HStack>
      </div>
    </VStack>
  );
}

/**
 * F3 "Reading and inspection flow": each cited ID opens its note inline, as plain text, without
 * moving focus or touching the editor. An ID that is not among the event's notes is an error.
 */
export function SourceReferences({
  sourceIds,
  notes,
}: {
  sourceIds: readonly FeedbackId[];
  notes: readonly FeedbackNote[];
}) {
  const baseId = useId();
  const byId = new Map(notes.map((note) => [note.id as string, note]));
  return (
    <ul aria-label="Sources" {...stylex.props(styles.list)}>
      {sourceIds.map((id) => {
        const note = byId.get(id);
        return (
          <li key={id}>
            {note === undefined ? (
              <Badge variant="error" label={`Source ${id} is unavailable`} />
            ) : (
              <SourceToggle note={note} panelId={`${baseId}-${id}`} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

Astryx `Button` extends `BaseProps<HTMLButtonElement>` (React's HTML attributes), so `aria-expanded` and `aria-controls` reach the element. If the test shows they are dropped, fall back to a native `<button type="button">` with the same attributes. Keep a visible focus style; native buttons have one by default. Record the fallback in the report.

`feedback-panel.tsx`:
- Add the prop `newSinceBriefing?: ReadonlySet<FeedbackId>`, defaulting to an empty set.
- After the note-ID badge in each row, render `{newSinceBriefing.has(note.id) ? <Badge variant="info" label="New since this briefing" /> : null}`.
- Wrap it in `<span {...stylex.props(styles.noteId)}>` so it never shrinks.

`event-page.tsx`: compute `const displayed = displayedBriefing(view);` and pass `newSinceBriefing={new Set(displayed?.freshness.newFeedbackIds ?? [])}` to `FeedbackPanel`.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm vitest run --project web`
Expected: PASS, including every existing web test.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/web/src
git commit -m "feat(web): source disclosure, freshness notice and new-since-briefing notes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: The briefing editor — text-only form, save and replace, discard, conflicts, reconciliation

**Files:**
- Create:
  - `apps/web/src/features/briefing/briefing-copy.ts`, `apps/web/src/features/briefing/briefing-form-model.ts`;
  - `apps/web/src/features/briefing/use-briefing-form.ts`, `apps/web/src/features/briefing/briefing-editor.tsx`.
- Modify:
  - `apps/web/src/features/briefing/briefing-panel.tsx` (the draft base and the editor);
  - `apps/web/src/features/event/event-page.tsx` (pass `refetch`);
  - `apps/web/src/testing/fake-event-api.ts` (`saveDelayMs`).
- Test: `apps/web/src/features/briefing/briefing-form-model.test.ts`, `apps/web/src/features/briefing/briefing-editor.test.tsx`

**Interfaces:**
- Consumes:
  - Task 5: `useSaveBriefing`.
  - Task 6: `ActiveBriefing`, `activeBriefing`, `EditableSlot`, `FreshnessNotice`, `SourceReferences`, `formatAttendanceCounts`, `briefingDirty`.
  - `RefetchEvent` (exported by `features/attendance/use-attendance-form.ts`), `useBeforeUnloadWarning`, `ConfirmDialog`.
- Produces:

```ts
// briefing-copy.ts
export const SECTION_COPY: Record<ListSection, { title: string; itemLabel: string; empty: string }>;
export const EVIDENCE_LIMIT_NOTICE: string;
export function formatTimestamp(iso: string): string;

// briefing-form-model.ts
export const BriefingFormSchema; export type BriefingFormValues; export type BriefingFormOutput;
export type BriefingFieldPath = "attendanceOverview" | "feedbackSummary" | `${ListSection}.${number}.text`;
export function toFormValues(content: BriefingContent): BriefingFormOutput;
export function toSaveRequest(values: BriefingFormOutput, generationId: GenerationId, baseBriefingRevision: number): SaveBriefingRequest;
export function draftMatchesSaved(values: BriefingFormValues, generationId: GenerationId, saved: BriefingView | null): boolean;
export function formFieldForApiField(field: string | undefined): BriefingFieldPath | null;
export interface EditorBase { slot: EditableSlot; briefing: BriefingView; briefingRevision: number }
export function toEditorBase(view: EventView): EditorBase | null;
/** T3 §11: the draft's identity. */
export function editorKey(base: EditorBase | null): string; // "selected:<generationId>:<revision>" | "none"

// use-briefing-form.ts
export type BriefingNotice = …; // see Step 3
export function useBriefingForm(eventId: EventId, base: EditorBase, refetch: RefetchEvent, onSaved: (outcome: { reconciled: boolean }) => void);

// briefing-editor.tsx
export function BriefingEditor(props: {
  eventId: EventId; view: EventView; base: EditorBase; refetch: RefetchEvent;
  onSaved: (outcome: { reconciled: boolean }) => void;
  /** True once after this tab's own save or select: the new editor takes focus on its heading. */
  consumePendingFocus: () => boolean;
}): JSX.Element;

// briefing-panel.tsx — gains a `refetch: RefetchEvent` prop.
```

**How the draft base works (T3 §11, "reset only on explicit select, save or discard"):**
- The panel keeps the editor's base, `{ slot, briefing, briefingRevision }`, in state and renders `<BriefingEditor key={editorKey(base)} …>`.
- **A clean editor follows the server.** While `briefingDirty` is false and `editorKey(toEditorBase(view))` differs, the panel adopts the new base during render. This is React's pattern for adjusting state to props, as `useAttendanceForm` does for its notice.
- **A dirty draft keeps its base.** It survives:
  - another tab's save: its next save is `BRIEFING_CONFLICT` and the text is kept;
  - an attendance save: the freshness updates in place, because the editor reads freshness from the view's copy of the same generation;
  - an incoming preview (F5-14).
- **Save, a confirmed reconciliation, discard and reload** reset the form. It becomes clean, the panel adopts the latest base, and the editor remounts with the saved content. After this tab's save, the new editor focuses its heading, so keyboard focus never falls to `<body>`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/features/briefing/briefing-form-model.test.ts`:

```ts
import { GenerationIdSchema } from "@event-desk/contracts";
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { describe, expect, it } from "vitest";
import { draftMatchesSaved, editorKey, formFieldForApiField, toEditorBase, toFormValues, toSaveRequest } from "./briefing-form-model";

const briefing = buildBriefingView();
const ID = briefing.provenance.generationId;

describe("briefing form model (D2)", () => {
  it("F5-03: the save request carries wording only, one entry per stored item", () => {
    const request = toSaveRequest(toFormValues(briefing.content), ID, 3);
    expect(request).toEqual({
      baseBriefingRevision: 3,
      generationId: ID,
      textEdits: {
        attendanceOverview: briefing.content.attendanceOverview,
        feedbackSummary: briefing.content.feedbackSummary.text,
        themes: ["Requests for more rest-break time."],
        conflicts: briefing.content.conflicts.map((item) => item.text),
        suggestions: briefing.content.suggestions.map((item) => item.text),
      },
    });
    expect(JSON.stringify(request)).not.toContain("sourceIds");
  });

  it("maps API fields to form fields", () => {
    expect(formFieldForApiField("textEdits.conflicts.1")).toBe("conflicts.1.text");
    expect(formFieldForApiField("textEdits.feedbackSummary")).toBe("feedbackSummary");
    expect(formFieldForApiField("textEdits.attendanceOverview")).toBe("attendanceOverview");
    expect(formFieldForApiField("textEdits.themes")).toBeNull();
    expect(formFieldForApiField(undefined)).toBeNull();
  });

  it("F5 lost response: matches only the same generation with identical wording", () => {
    const values = toFormValues(briefing.content);
    const saved = { ...briefing, savedAt: "2026-10-04T10:00:00.000Z" };
    expect(draftMatchesSaved(values, ID, saved)).toBe(true);
    expect(draftMatchesSaved({ ...values, feedbackSummary: "Other." }, ID, saved)).toBe(false);
    expect(draftMatchesSaved(values, GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000009"), saved)).toBe(false);
    expect(draftMatchesSaved(values, ID, null)).toBe(false);
  });

  it("T3 §11: the editor key is slot, generation and revision", () => {
    const base = toEditorBase(buildSeedEventView({ selectedPreview: briefing, briefingRevision: 2 }));
    expect(editorKey(base)).toBe(`selected:${ID}:2`);
    expect(editorKey(toEditorBase(buildSeedEventView()))).toBe("none");
  });
});
```

`apps/web/src/features/briefing/briefing-editor.test.tsx`:

```tsx
import { SaveBriefingRequestSchema } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { apiErrorResponse, FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;
const preview = buildBriefingView();

beforeEach(() => {
  api = new FakeEventApi();
  api.view = { ...api.view, selectedPreview: preview };
  mswServer.use(...api.handlers());
});

const panel = async () => within(await screen.findByRole("region", { name: "Briefing" }));
const field = (region: Awaited<ReturnType<typeof panel>>, label: string) =>
  region.getByLabelText<HTMLTextAreaElement>(label);

describe("briefing editor", () => {
  it("F5-01: edits a selected preview's wording and saves it with the original references", async () => {
    const { user } = renderApp();
    const region = await panel();
    expect(region.getByRole("heading", { name: "Generated preview — not saved as briefing" })).toBeTruthy();
    expect(region.getByText(/References identify the source notes/)).toBeTruthy();
    const theme = field(region, "Theme 1");
    await user.clear(theme);
    await user.type(theme, "People asked for longer rest breaks.");
    expect(region.getByText("Unsaved changes to the briefing text.")).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Save briefing" }));

    expect(await region.findByRole("heading", { name: /^Saved briefing · last saved / })).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("People asked for longer rest breaks.");
    expect(region.getByRole("button", { name: "Read source F05" })).toBeTruthy();
    const sent = SaveBriefingRequestSchema.parse(api.saveRequests[0]);
    expect(sent.textEdits.themes).toEqual(["People asked for longer rest breaks."]);
    expect(api.view.savedBriefing?.content.themes).toEqual([
      { text: "People asked for longer rest breaks.", sourceIds: ["F05", "F06"] },
    ]);
    // The editor took focus on its own heading after the save, not <body>.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toMatch(/^Saved briefing/);
    });
  });

  it("F5-09: with a saved briefing, the preview's action is Save and replace briefing", async () => {
    api.view = { ...api.view, savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME } };
    renderApp();
    expect((await panel()).getByRole("button", { name: "Save and replace briefing" })).toBeTruthy();
  });

  it("Review Focus 5 / F5-05: opening a source with the keyboard keeps the draft", async () => {
    const { user } = renderApp();
    const region = await panel();
    const theme = field(region, "Theme 1");
    await user.type(theme, " Edited.");
    const toggle = region.getAllByRole("button", { name: "Read source F05" })[1];
    if (toggle === undefined) throw new Error("theme source toggle missing");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Edited.");
  });

  it("Review Focus 1 / F5-06: a save after another tab saved is a conflict that keeps the draft", async () => {
    const { user } = renderApp();
    const region = await panel();
    api.saveBriefingElsewhere();
    await user.type(field(region, "Theme 1"), " Mine.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("The briefing changed elsewhere")).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Mine.");
    expect(api.view.savedBriefing).toBeNull();
  });

  it("F5-04: a blank item is caught before sending, on that field", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.clear(field(region, "Disagreement 2"));
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Must not be blank")).toBeTruthy();
    expect(api.saveRequests).toHaveLength(0);
  });

  it("F5-04: a server field error lands on its field and keeps every draft", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/briefing", () =>
        apiErrorResponse(422, "CONTENT_INVALID", "Text must be 1-1000 characters and not blank", "textEdits.conflicts.0"),
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.type(field(region, "Theme 1"), " Kept.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Text must be 1-1000 characters and not blank")).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Kept.");
  });

  it("F5-10: Discard edits asks first; Cancel keeps the draft, Discard restores the text", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.type(field(region, "Theme 1"), " Draft.");
    await user.click(region.getByRole("button", { name: "Discard edits" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Draft.");
    await user.click(region.getByRole("button", { name: "Discard edits" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => {
      expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time.");
    });
  });

  it("F5 saving state: fields are locked while the save is in flight", async () => {
    api.saveDelayMs = 150;
    const { user } = renderApp();
    const region = await panel();
    await user.type(field(region, "Theme 1"), " Locked.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Saving briefing…")).toBeTruthy();
    expect(field(region, "Theme 1").disabled || field(region, "Theme 1").getAttribute("aria-disabled") === "true").toBe(true);
    expect(await region.findByRole("heading", { name: /^Saved briefing/ })).toBeTruthy();
  });

  it("F5 lost response: one re-read confirms the save before reporting it", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/briefing", async ({ request }) => {
        const { textEdits } = SaveBriefingRequestSchema.parse(await request.json());
        api.view = {
          ...api.view,
          selectedPreview: null,
          briefingRevision: 1,
          savedBriefing: {
            ...preview,
            savedAt: FIXTURE_TIME,
            content: {
              ...preview.content,
              themes: preview.content.themes.map((item, index) => ({ ...item, text: textEdits.themes[index] ?? item.text })),
            },
          },
        };
        return HttpResponse.error();
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.type(field(region, "Theme 1"), " Landed.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Your briefing changes were saved.")).toBeTruthy();
    expect(region.getByRole("heading", { name: /^Saved briefing/ })).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Landed.");
  });
});
```

Run: `pnpm vitest run --project web apps/web/src/features/briefing`
Expected: FAIL. The modules are missing and no editor is rendered.

- [ ] **Step 2: Implement the copy and the form model**

`apps/web/src/features/briefing/briefing-copy.ts`:

```ts
import type { ListSection } from "@event-desk/contracts";

/** The brief's four questions (docs/specs/README.md); "What happened" is overview + summary. */
export const SECTION_COPY = {
  themes: { title: "Which themes recur", itemLabel: "Theme", empty: "No recurring themes identified." },
  conflicts: { title: "Where people disagree", itemLabel: "Disagreement", empty: "No conflicting views identified." },
  suggestions: { title: "What might be worth following up", itemLabel: "Follow-up", empty: "No follow-ups suggested." },
} as const satisfies Record<ListSection, { title: string; itemLabel: string; empty: string }>;

/** F3 "Evidence limits", shown near every briefing. */
export const EVIDENCE_LIMIT_NOTICE =
  "References identify the source notes; they do not automatically prove that the wording is supported. Review the notes before saving.";

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatTimestamp = (iso: string): string => timeFormat.format(new Date(iso));
```

`apps/web/src/features/briefing/briefing-form-model.ts`:

```ts
import {
  boundedText,
  type BriefingContent,
  type BriefingView,
  type EventView,
  type GenerationId,
  LIST_SECTIONS,
  type ListSection,
  type SaveBriefingRequest,
  TEXT_LIMITS,
} from "@event-desk/contracts";
import { z } from "zod";
import { activeBriefing, type EditableSlot } from "./active-briefing";

const itemText = z.object({ text: boundedText(TEXT_LIMITS.item) });

/** Wording only (D2): one field per stored item; there is nothing to add, remove or reorder. */
export const BriefingFormSchema = z.object({
  attendanceOverview: boundedText(TEXT_LIMITS.attendanceOverview),
  feedbackSummary: boundedText(TEXT_LIMITS.feedbackSummary),
  themes: z.array(itemText),
  conflicts: z.array(itemText),
  suggestions: z.array(itemText),
});
export type BriefingFormValues = z.input<typeof BriefingFormSchema>;
export type BriefingFormOutput = z.output<typeof BriefingFormSchema>;
export type BriefingFieldPath = "attendanceOverview" | "feedbackSummary" | `${ListSection}.${number}.text`;

export function toFormValues(content: BriefingContent): BriefingFormOutput {
  const texts = (section: ListSection) => content[section].map((item) => ({ text: item.text }));
  return {
    attendanceOverview: content.attendanceOverview,
    feedbackSummary: content.feedbackSummary.text,
    themes: texts("themes"),
    conflicts: texts("conflicts"),
    suggestions: texts("suggestions"),
  };
}

export function toSaveRequest(
  values: BriefingFormOutput,
  generationId: GenerationId,
  baseBriefingRevision: number,
): SaveBriefingRequest {
  const texts = (section: ListSection) => values[section].map((item) => item.text);
  return {
    baseBriefingRevision,
    generationId,
    textEdits: {
      attendanceOverview: values.attendanceOverview,
      feedbackSummary: values.feedbackSummary,
      themes: texts("themes"),
      conflicts: texts("conflicts"),
      suggestions: texts("suggestions"),
    },
  };
}

/** After a lost response: does the saved briefing now hold exactly this draft for this generation? */
export function draftMatchesSaved(
  values: BriefingFormValues,
  generationId: GenerationId,
  saved: BriefingView | null,
): boolean {
  if (saved === null || saved.provenance.generationId !== generationId) return false;
  const content = saved.content;
  return (
    content.attendanceOverview === values.attendanceOverview &&
    content.feedbackSummary.text === values.feedbackSummary &&
    LIST_SECTIONS.every(
      (section) =>
        content[section].length === values[section].length &&
        content[section].every((item, index) => item.text === values[section][index]?.text),
    )
  );
}

const ITEM_FIELD = /^textEdits\.(themes|conflicts|suggestions)\.(\d+)$/;

/** "textEdits.conflicts.0" → "conflicts.0.text"; a section-level field has no single input. */
export function formFieldForApiField(field: string | undefined): BriefingFieldPath | null {
  if (field === "textEdits.attendanceOverview") return "attendanceOverview";
  if (field === "textEdits.feedbackSummary") return "feedbackSummary";
  const match = field === undefined ? null : ITEM_FIELD.exec(field);
  const section = LIST_SECTIONS.find((name) => name === match?.[1]);
  return section === undefined || match?.[2] === undefined ? null : `${section}.${Number(match[2])}.text`;
}

export interface EditorBase {
  slot: EditableSlot;
  briefing: BriefingView;
  briefingRevision: number;
}

export function toEditorBase(view: EventView): EditorBase | null {
  const active = activeBriefing(view);
  return active === null ? null : { ...active, briefingRevision: view.briefingRevision };
}

/** T3 §11: a draft belongs to one slot, generation and briefing revision. */
export function editorKey(base: EditorBase | null): string {
  return base === null
    ? "none"
    : `${base.slot}:${base.briefing.provenance.generationId}:${String(base.briefingRevision)}`;
}
```

In `fake-event-api.ts`, add the field `saveDelayMs = 0`. In the PUT `/briefing` handler, right after `this.saveRequests.push(body)`, add `if (this.saveDelayMs > 0) await delay(this.saveDelayMs);`.

- [ ] **Step 3: Implement the form hook**

`apps/web/src/features/briefing/use-briefing-form.ts`:

```ts
import { zodResolver } from "@hookform/resolvers/zod";
import type { EventId } from "@event-desk/contracts";
import { type BaseSyntheticEvent, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { useSaveBriefing } from "../../data/mutations/use-save-briefing";
import { useBeforeUnloadWarning } from "../../shared/hooks/use-before-unload-warning";
import { useUiStore } from "../../state/ui-store";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import {
  BriefingFormSchema,
  type BriefingFormOutput,
  type BriefingFormValues,
  draftMatchesSaved,
  type EditorBase,
  formFieldForApiField,
  toFormValues,
  toSaveRequest,
} from "./briefing-form-model";

export type BriefingNotice =
  | { kind: "conflict"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "unconfirmed" }
  | { kind: "check-failed"; message: string };

/**
 * The briefing text draft (F5). It is created from its base once; the panel remounts it (by
 * editorKey) only after an explicit select, save or discard, or while it is clean (T3 §11).
 */
export function useBriefingForm(
  eventId: EventId,
  base: EditorBase,
  refetch: RefetchEvent,
  onSaved: (outcome: { reconciled: boolean }) => void,
) {
  const form = useForm<BriefingFormValues, unknown, BriefingFormOutput>({
    resolver: zodResolver(BriefingFormSchema),
    defaultValues: toFormValues(base.briefing.content),
  });
  const { isDirty } = form.formState;
  // Synchronous double-submit guard: React state (isPending) lags a fast second click.
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<BriefingNotice | null>(null);
  const [checking, setChecking] = useState(false);
  const save = useSaveBriefing(eventId);
  const setBriefingDirty = useUiStore((state) => state.setBriefingDirty);
  const generationId = base.briefing.provenance.generationId;

  useEffect(() => {
    setBriefingDirty(isDirty);
  }, [isDirty, setBriefingDirty]);
  useEffect(
    () => () => {
      setBriefingDirty(false);
    },
    [setBriefingDirty],
  );
  useBeforeUnloadWarning(isDirty);

  const showFailure = (error: unknown) => {
    const message = describeApiError(error);
    const code = error instanceof ApiError ? error.code : undefined;
    if (code === "BRIEFING_CONFLICT" || code === "PREVIEW_CONFLICT") {
      setNotice({ kind: "conflict", message });
    } else if (code === "GENERATION_NOT_AVAILABLE") {
      setNotice({ kind: "unavailable", message });
    } else if (code === "CONTENT_INVALID" || code === "VALIDATION_FAILED" || code === "REFERENCE_INVALID") {
      const path = code === "REFERENCE_INVALID" ? null : formFieldForApiField(error instanceof ApiError ? error.field : undefined);
      if (path === null) setNotice({ kind: "invalid", message });
      else form.setError(path, { type: "server", message }, { shouldFocus: true });
    } else {
      setNotice({ kind: "failed", message });
    }
  };

  // Lost response: one re-read decides whether exactly the submitted text was saved (F5).
  const reconcile = async (submitted: BriefingFormOutput) => {
    setChecking(true);
    try {
      const result = await refetch();
      if (result.isError || result.data === undefined) {
        setNotice({ kind: "check-failed", message: describeApiError(result.error) });
      } else if (draftMatchesSaved(submitted, generationId, result.data.savedBriefing)) {
        form.reset(submitted);
        onSaved({ reconciled: true });
      } else {
        setNotice({ kind: "unconfirmed" });
      }
    } finally {
      setChecking(false);
    }
  };

  const saveDraft = async (values: BriefingFormOutput) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice(null);
    try {
      // The draft's own base revision, never a refreshed one: a save elsewhere is a conflict (F5-06).
      await save.mutateAsync(toSaveRequest(values, generationId, base.briefingRevision));
      form.reset(values);
      onSaved({ reconciled: false });
    } catch (error) {
      if (error instanceof ApiError && error.outcomeUnknown) {
        await reconcile(values);
        return;
      }
      showFailure(error);
    } finally {
      inFlight.current = false;
    }
  };

  const submit = (event?: BaseSyntheticEvent) => form.handleSubmit(saveDraft)(event);

  const discard = () => {
    form.reset();
    setNotice(null);
  };

  /** After a conflict: load the latest briefing, then drop the draft. Resolves true if it did. */
  const reloadLatest = async (): Promise<boolean> => {
    setChecking(true);
    try {
      const result = await refetch();
      if (result.isError || result.data === undefined) {
        const reason = describeApiError(result.error);
        setNotice((current) =>
          current?.kind === "conflict" || current?.kind === "unavailable"
            ? { ...current, message: `${current.message} The latest briefing could not be loaded, so your text is kept: ${reason}` }
            : current,
        );
        return false;
      }
      form.reset();
      setNotice(null);
      return true;
    } finally {
      setChecking(false);
    }
  };

  const isSaving = save.isPending || checking;
  return { form, isDirty, isSaving, isBusy: isSaving, notice, submit, discard, reloadLatest };
}
```

`form.reset()` with no argument restores the `defaultValues`, which are the base content. The form becomes clean and the panel then adopts the latest base.

- [ ] **Step 4: Implement the editor**

`apps/web/src/features/briefing/briefing-editor.tsx`:

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { assertNever, type EventId, type EventView, LIST_SECTIONS } from "@event-desk/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { type Control, Controller } from "react-hook-form";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { formatAttendanceCounts } from "../attendance/attendance-counts";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import { SourceReferences } from "../feedback/source-reference";
import { EVIDENCE_LIMIT_NOTICE, formatTimestamp, SECTION_COPY } from "./briefing-copy";
import type { BriefingFieldPath, BriefingFormOutput, BriefingFormValues, EditorBase } from "./briefing-form-model";
import { FreshnessNotice } from "./freshness-notice";
import { type BriefingNotice, useBriefingForm } from "./use-briefing-form";

function TextField({
  control,
  name,
  label,
  isDisabled,
}: {
  control: Control<BriefingFormValues, unknown, BriefingFormOutput>;
  name: BriefingFieldPath;
  label: string;
  isDisabled: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextArea
          ref={field.ref}
          label={label}
          value={field.value}
          rows={3}
          isDisabled={isDisabled}
          onChange={(value) => {
            field.onChange(value);
          }}
          onBlur={field.onBlur}
          {...(fieldState.error?.message === undefined
            ? {}
            : { status: { type: "error" as const, message: fieldState.error.message } })}
        />
      )}
    />
  );
}

function NoticeBanner({ notice, isBusy, onReload }: { notice: BriefingNotice; isBusy: boolean; onReload: () => void }) {
  const reload = <Button label="Reload saved briefing" variant="secondary" isDisabled={isBusy} onClick={onReload} />;
  switch (notice.kind) {
    case "conflict":
      return <Banner status="warning" title="The briefing changed elsewhere" description={`${notice.message} Your text is kept until you choose to reload.`} endContent={reload} />;
    case "unavailable":
      return <Banner status="warning" title="This briefing can no longer be saved" description={`${notice.message} Your text is kept until you choose to reload.`} endContent={reload} />;
    case "invalid":
      return <Banner status="error" title="The briefing was not saved" description={notice.message} />;
    case "failed":
      return <Banner status="error" title="Briefing was not saved" description={`${notice.message} Your text is kept; press Save to try again.`} />;
    case "unconfirmed":
      return <Banner status="warning" title="Could not confirm the save" description="The saved briefing does not match your text. It is kept; check it and save again." />;
    case "check-failed":
      return <Banner status="warning" title="Could not check the saved briefing" description={`It is not known whether your text was saved. It is kept; try again. ${notice.message}`} />;
    default:
      return assertNever(notice, "briefing notice");
  }
}

/** F5: edit the wording of one briefing; structure, references and provenance stay fixed. */
export function BriefingEditor({
  eventId,
  view,
  base,
  refetch,
  onSaved,
  consumePendingFocus,
}: {
  eventId: EventId;
  view: EventView;
  base: EditorBase;
  refetch: RefetchEvent;
  onSaved: (outcome: { reconciled: boolean }) => void;
  consumePendingFocus: () => boolean;
}) {
  const editor = useBriefingForm(eventId, base, refetch, onSaved);
  const [confirming, setConfirming] = useState<"discard" | "reload" | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const focusHeading = () => {
    headingRef.current?.focus();
  };
  useEffect(() => {
    if (consumePendingFocus()) headingRef.current?.focus();
  }, [consumePendingFocus]);

  const { briefing } = base;
  const content = briefing.content;
  // Freshness follows the saved records even while the draft keeps its base (F5-12).
  const live =
    [view.selectedPreview, view.savedBriefing].find(
      (candidate) => candidate?.provenance.generationId === briefing.provenance.generationId,
    ) ?? briefing;
  const title =
    base.slot === "selected"
      ? "Generated preview — not saved as briefing"
      : briefing.savedAt === undefined
        ? "Saved briefing"
        : `Saved briefing · last saved ${formatTimestamp(briefing.savedAt)}`;
  const saveLabel = base.slot === "selected" && view.savedBriefing !== null ? "Save and replace briefing" : "Save briefing";
  const canSave = base.slot === "selected" || editor.isDirty;
  const control = editor.form.control;

  return (
    <article aria-labelledby={headingId}>
      <VStack gap={3}>
        <Heading level={3} id={headingId} ref={headingRef} tabIndex={-1}>
          {title}
        </Heading>
        <Text type="supporting">
          Generated {formatTimestamp(briefing.provenance.generatedAt)} · {briefing.provenance.model} ·{" "}
          {briefing.trigger === "manual" ? "requested by you" : "automatic"}
        </Text>
        <FreshnessNotice briefing={live} members={view.members} counts={view.counts} />
        <Text type="supporting">{EVIDENCE_LIMIT_NOTICE}</Text>
        <form
          noValidate
          onSubmit={(event) => {
            void editor.submit(event);
          }}
        >
          <VStack gap={4}>
            <VStack gap={2}>
              <Heading level={4}>What happened</Heading>
              <TextField control={control} name="attendanceOverview" label="Attendance overview" isDisabled={editor.isBusy} />
              <VStack gap={0}>
                <Text type="supporting">Check edited wording against the counts.</Text>
                <Text type="supporting">Generated from: {formatAttendanceCounts(briefing.provenance.input.counts)}</Text>
                <Text type="supporting">Saved records now: {formatAttendanceCounts(view.counts)}</Text>
              </VStack>
              <TextField control={control} name="feedbackSummary" label="Feedback summary" isDisabled={editor.isBusy} />
              <SourceReferences sourceIds={content.feedbackSummary.sourceIds} notes={view.feedback} />
            </VStack>
            {LIST_SECTIONS.map((section) => (
              <VStack key={section} gap={2}>
                <Heading level={4}>{SECTION_COPY[section].title}</Heading>
                {content[section].length === 0 ? (
                  <Text type="supporting">{SECTION_COPY[section].empty}</Text>
                ) : (
                  <ol>
                    {content[section].map((item, index) => (
                      <li key={`${section}-${String(index)}`}>
                        <VStack gap={1}>
                          <TextField
                            control={control}
                            name={`${section}.${index}.text`}
                            label={`${SECTION_COPY[section].itemLabel} ${String(index + 1)}`}
                            isDisabled={editor.isBusy}
                          />
                          <SourceReferences sourceIds={item.sourceIds} notes={view.feedback} />
                        </VStack>
                      </li>
                    ))}
                  </ol>
                )}
              </VStack>
            ))}
            <div role="status" aria-live="polite">
              {editor.isSaving ? <Text>Saving briefing…</Text> : editor.isDirty ? <Text>Unsaved changes to the briefing text.</Text> : null}
            </div>
            {editor.notice === null ? null : (
              <NoticeBanner
                notice={editor.notice}
                isBusy={editor.isBusy}
                onReload={() => {
                  setConfirming("reload");
                }}
              />
            )}
            <HStack gap={2}>
              <Button type="submit" variant="primary" label={saveLabel} isDisabled={!canSave || editor.isBusy} isLoading={editor.isSaving} />
              {editor.isDirty ? (
                <Button
                  variant="secondary"
                  label="Discard edits"
                  isDisabled={editor.isBusy}
                  onClick={() => {
                    setConfirming("discard");
                  }}
                />
              ) : null}
            </HStack>
          </VStack>
        </form>
      </VStack>
      <ConfirmDialog
        isOpen={confirming === "discard"}
        title="Discard your edits?"
        description="Your unsaved wording will be lost. The saved briefing does not change."
        actionLabel="Discard"
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setConfirming(null);
          editor.discard();
          focusHeading();
        }}
      />
      <ConfirmDialog
        isOpen={confirming === "reload"}
        title="Reload the saved briefing?"
        description="Your unsaved wording will be discarded and replaced by the latest briefing."
        actionLabel="Discard and reload"
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => {
          setConfirming(null);
          void editor.reloadLatest();
        }}
      />
    </article>
  );
}
```

`Controller`'s `field.value` for a `BriefingFieldPath` is `string`. If TypeScript widens it, narrow it with `String(field.value)` rather than a cast.

- [ ] **Step 5: Wire the panel and the page**

In `apps/web/src/features/briefing/briefing-panel.tsx`:
- Add the prop `refetch: RefetchEvent`.
- Keep the Generate control and the incoming preview or empty state. Task 8 reorganises them.
- Add the draft base:

```tsx
  const briefingDirty = useUiStore((state) => state.briefingDirty);
  const latest = toEditorBase(view);
  const [base, setBase] = useState<EditorBase | null>(latest);
  // A clean editor follows the saved records; a dirty draft keeps its base until save, discard or
  // explicit select (T3 §11). Adjusted during render, React's pattern for state derived from props.
  if (!briefingDirty && editorKey(base) !== editorKey(latest)) setBase(latest);
  // "Your briefing changes were saved." stays until the next edit starts. The dirty flag lags the
  // form by one effect, so clear on the clean→dirty transition, not on "dirty" itself.
  const [reconciled, setReconciled] = useState(false);
  const [wasDirty, setWasDirty] = useState(briefingDirty);
  if (briefingDirty !== wasDirty) {
    setWasDirty(briefingDirty);
    if (briefingDirty) setReconciled(false);
  }
  const pendingFocus = useRef(false);
  const consumePendingFocus = useCallback(() => {
    const pending = pendingFocus.current;
    pendingFocus.current = false;
    return pending;
  }, []);
  const onSaved = useCallback(({ reconciled: wasReconciled }: { reconciled: boolean }) => {
    pendingFocus.current = true;
    setReconciled(wasReconciled);
  }, []);
```

Render this before the incoming preview:

```tsx
        {reconciled ? <Banner status="success" title="Your briefing changes were saved." /> : null}
        {base === null ? null : (
          <BriefingEditor
            key={editorKey(base)}
            eventId={eventId}
            view={view}
            base={base}
            refetch={refetch}
            onSaved={onSaved}
            consumePendingFocus={consumePendingFocus}
          />
        )}
```

Show the empty state only when `base === null && view.incomingPreview === null`.

`event-page.tsx`: render `<BriefingPanel eventId={eventId} view={view} refetch={query.refetch} />`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run --project web`
Expected: PASS, including the Plan 3B panel tests, which only render the incoming preview.

- [ ] **Step 7: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0. React-hooks v7: no ref is read during render. `pendingFocus` is read only in the effect-called callback and written only in an event callback.

```bash
git add apps/web/src
git commit -m "feat(web): briefing editor — text-only drafts, save and replace, discard, conflict and lost-response handling" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: Panel orchestration — "Review new preview", auto-select after Generate, read-only incoming preview

**Files:**
- Create: `apps/web/src/features/briefing/incoming-preview-notice.tsx`
- Modify:
  - `apps/web/src/features/briefing/briefing-panel.tsx`, `apps/web/src/features/briefing/generate-briefing-control.tsx`;
  - `apps/web/src/features/briefing/briefing-preview.tsx`.
- Test: `apps/web/src/features/briefing/briefing-panel.test.tsx` (update and append)

**Interfaces:**
- Consumes:
  - Task 5: `useSelectPreview`.
  - Task 6: `SourceReferences`, `FreshnessNotice`.
  - Task 7: `BriefingEditor`, `EditorBase`, `editorKey`, `toEditorBase`, `SECTION_COPY`, `EVIDENCE_LIMIT_NOTICE`, `formatTimestamp`.
- Produces:

```ts
// generate-briefing-control.tsx — new optional prop
onGenerated?: (preview: BriefingView) => void; // after THIS tab's Generate succeeds
// incoming-preview-notice.tsx
export function IncomingPreviewNotice(props: {
  preview: BriefingView; isDirty: boolean; isOpening: boolean; onReview: () => void;
}): JSX.Element;
// briefing-preview.tsx — props become { title: string; briefing: BriefingView; view: EventView }
```

**Rules (F4 step 7, F6 table, F7 "Preview ownership"):**
- **Auto-select.** After this tab's Generate succeeds, select the new preview at once if `useUiStore.getState().briefingDirty` is false. The flag is read when the result arrives, not when Generate was pressed. Auto-select never moves focus: it stays on the Generate button.
- **The notice.** Any incoming preview that is not auto-selected shows **"New briefing ready to review"** with **"Review new preview"**:
  - a result from another tab or from a batch;
  - a result that arrived while the editor was dirty.
- **Reviewing while dirty** first asks "Discard your edits and review the new preview?". The action is "Discard and review"; Cancel keeps editing. The draft is replaced only when the select succeeds. A failed select (for example `PREVIEW_CONFLICT`) leaves the draft and the notice as they were. The hook's toast explains the failure.
- **After this tab's explicit review**, the panel adopts the new selected base at once, even over a dirty draft the coordinator chose to discard, and focuses the editor heading.
- **With no active briefing**, the incoming preview is shown read-only under the notice: the provenance line, the freshness notice, the evidence-limit notice, and source toggles for each item.
- **The read-only preview** uses headings, not one `region` landmark per question (carried in from the Plan 3B review).

- [ ] **Step 1: Update and write the failing tests**

In `apps/web/src/features/briefing/briefing-panel.test.tsx`:
- In "F4-01: generates from the saved baseline …":
  - Rename it to "F4-01 / F4 step 7: generates from the saved baseline and opens the clean editor on the new preview".
  - Expect the heading `"Generated preview — not saved as briefing"` instead of `"New preview (not yet reviewed)"`.
  - Keep the four `getByRole("heading", { name: question })` checks and delete the four `getByRole("region", { name: question })` checks.
  - Replace the `(Sources: F05, F06)` assertion with `expect(region.getAllByRole("button", { name: "Read source F05" }).length).toBeGreaterThan(0);`.
  - Add `expect(api.selectRequests).toEqual([{ generationId: buildBriefingView().provenance.generationId, expectedSelectedGenerationId: null }]);`.
  - Add `expect(region.queryByText("New briefing ready to review")).toBeNull();`.
- In "keeps keyboard focus on the button while generating …", expect the heading `"Generated preview — not saved as briefing"`. The existing `document.activeElement` check stays: auto-select does not move focus.

Append:

```tsx
  it("Review Focus 3 / F6-09 / F5-14: a new preview never replaces a dirty editor", async () => {
    const first = buildBriefingView();
    const second = buildBriefingView({
      provenance: { ...first.provenance, generationId: GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000002"), runId: RunIdSchema.parse("manual:second") },
      content: { ...first.content, themes: [{ text: "Second preview theme.", sourceIds: first.content.themes[0]?.sourceIds ?? [] }] },
    });
    api.view = { ...api.view, selectedPreview: first };
    api.generationReplies.push({ kind: "preview", preview: second });
    const { user } = renderApp();
    const region = await panel();
    const theme = region.getByLabelText<HTMLTextAreaElement>("Theme 1");
    await user.type(theme, " My draft.");
    await user.click(generateButton(region));

    expect(await region.findByText("New briefing ready to review")).toBeTruthy();
    expect(api.selectRequests).toHaveLength(0);
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe("Requests for more rest-break time. My draft.");

    await user.click(region.getByRole("button", { name: "Review new preview" }));
    expect(await screen.findByText("Discard your edits and review the new preview?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe("Requests for more rest-break time. My draft.");

    await user.click(region.getByRole("button", { name: "Review new preview" }));
    await user.click(await screen.findByRole("button", { name: "Discard and review" }));
    await waitFor(() => {
      expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe("Second preview theme.");
    });
    expect(api.selectRequests).toEqual([{ generationId: second.provenance.generationId, expectedSelectedGenerationId: first.provenance.generationId }]);
    expect(region.queryByText("New briefing ready to review")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Generated preview — not saved as briefing");
    });
  });

  it("F7: a result from elsewhere is offered, not opened, and the saved briefing stays in the editor", async () => {
    api.view = {
      ...api.view,
      savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME },
      incomingPreview: buildBriefingView({ trigger: "feedback_batch", provenance: { ...buildBriefingView().provenance, generationId: GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000003"), runId: RunIdSchema.parse("batch:1") } }),
    };
    renderApp();
    const region = await panel();
    expect(await region.findByText("New briefing ready to review")).toBeTruthy();
    expect(region.getByRole("heading", { name: /^Saved briefing · last saved / })).toBeTruthy();
    expect(api.selectRequests).toHaveLength(0);
  });

  it("shows an unreviewed incoming preview read-only, with sources and no per-question landmarks", async () => {
    api.view = { ...api.view, incomingPreview: buildBriefingView() };
    const { user } = renderApp();
    const region = await panel();
    expect(await region.findByRole("heading", { name: "New preview (not yet reviewed)" })).toBeTruthy();
    expect(region.queryAllByRole("textbox")).toHaveLength(0);
    expect(region.queryAllByRole("region")).toHaveLength(0);
    expect(region.getByText(/References identify the source notes/)).toBeTruthy();
    const [toggle] = region.getAllByRole("button", { name: "Read source F05" });
    if (toggle === undefined) throw new Error("source toggle missing");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(region.getByRole("button", { name: "Review new preview" }));
    expect(await region.findByRole("heading", { name: "Generated preview — not saved as briefing" })).toBeTruthy();
  });
```

Add `GenerationIdSchema`, `RunIdSchema` and `FIXTURE_TIME` to the imports where they are missing.

Run: `pnpm vitest run --project web apps/web/src/features/briefing`
Expected: FAIL. There is no auto-select, no notice, and the preview has no source toggles.

- [ ] **Step 2: Implement**

`generate-briefing-control.tsx`:
- Add the optional prop `onGenerated?: (preview: BriefingView) => void`.
- Change `start` to:

```tsx
  const start = () => {
    generation.mutate(
      { baseAttendanceRevision: view.attendanceRevision },
      { onSuccess: (response) => onGenerated?.(response.incomingPreview) },
    );
  };
```

`apps/web/src/features/briefing/incoming-preview-notice.tsx`:

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import type { BriefingView } from "@event-desk/contracts";
import { useState } from "react";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { formatTimestamp } from "./briefing-copy";

/**
 * F7: a ready candidate is announced, never forced into the editor. Reviewing it while the editor
 * has unsaved text asks first (F6 table, "Selected preview has unsaved text").
 */
export function IncomingPreviewNotice({
  preview,
  isDirty,
  isOpening,
  onReview,
}: {
  preview: BriefingView;
  isDirty: boolean;
  isOpening: boolean;
  onReview: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const origin = preview.trigger === "manual" ? "Generated on request" : "Generated automatically from new feedback";
  const stale = preview.freshness.current ? "" : " It is already out of date.";
  const kept = isDirty ? " Your unsaved edits stay until you choose." : "";
  return (
    <>
      <Banner
        status="info"
        title="New briefing ready to review"
        description={`${origin} at ${formatTimestamp(preview.provenance.generatedAt)}.${stale}${kept}`}
        endContent={
          <Button
            label="Review new preview"
            variant="secondary"
            isLoading={isOpening}
            isDisabled={isOpening}
            onClick={() => {
              if (isDirty) setConfirming(true);
              else onReview();
            }}
          />
        }
      />
      <ConfirmDialog
        isOpen={confirming}
        title="Discard your edits and review the new preview?"
        description="Your unsaved wording will be lost. Cancel to keep editing; you can save it first."
        actionLabel="Discard and review"
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          onReview();
        }}
      />
    </>
  );
}
```

`briefing-preview.tsx`: replace the body.

```tsx
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { type BriefingView, type EventView, type EvidenceItem, LIST_SECTIONS } from "@event-desk/contracts";
import { SourceReferences } from "../feedback/source-reference";
import { EVIDENCE_LIMIT_NOTICE, formatTimestamp, SECTION_COPY } from "./briefing-copy";
import { FreshnessNotice } from "./freshness-notice";

function EvidenceText({ item, view }: { item: EvidenceItem; view: EventView }) {
  return (
    <VStack gap={1}>
      <Text>{item.text}</Text>
      <SourceReferences sourceIds={item.sourceIds} notes={view.feedback} />
    </VStack>
  );
}

/**
 * A read-only briefing (F4): code-built overview, cited model text, rendered as plain text (S1).
 * Headings are the brief's four questions; they are headings, not landmarks.
 */
export function BriefingPreview({ title, briefing, view }: { title: string; briefing: BriefingView; view: EventView }) {
  const { content, provenance } = briefing;
  return (
    <article aria-label={title}>
      <VStack gap={3}>
        <Heading level={3}>{title}</Heading>
        <Text type="supporting">
          Generated {formatTimestamp(provenance.generatedAt)} · {provenance.model} ·{" "}
          {briefing.trigger === "manual" ? "requested by you" : "automatic"}
        </Text>
        <FreshnessNotice briefing={briefing} members={view.members} counts={view.counts} />
        <Text type="supporting">{EVIDENCE_LIMIT_NOTICE}</Text>
        <VStack gap={1}>
          <Heading level={4}>What happened</Heading>
          <Text>{content.attendanceOverview}</Text>
          <EvidenceText item={content.feedbackSummary} view={view} />
        </VStack>
        {LIST_SECTIONS.map((section) => (
          <VStack key={section} gap={1}>
            <Heading level={4}>{SECTION_COPY[section].title}</Heading>
            {content[section].length === 0 ? (
              <Text type="supporting">{SECTION_COPY[section].empty}</Text>
            ) : (
              <ul>
                {content[section].map((item, index) => (
                  <li key={`${section}-${String(index)}`}>
                    <EvidenceText item={item} view={view} />
                  </li>
                ))}
              </ul>
            )}
          </VStack>
        ))}
      </VStack>
    </article>
  );
}
```

`briefing-panel.tsx`: replace the file with the final orchestration. It keeps Task 7's base, reconciliation and focus logic verbatim.

```tsx
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading } from "@astryxdesign/core/Text";
import type { BriefingView, EventId, EventView, GenerationId } from "@event-desk/contracts";
import { useCallback, useRef, useState } from "react";
import { useSelectPreview } from "../../data/mutations/use-select-preview";
import { useUiStore } from "../../state/ui-store";
import type { RefetchEvent } from "../attendance/use-attendance-form";
import { BriefingEditor } from "./briefing-editor";
import { type EditorBase, editorKey, toEditorBase } from "./briefing-form-model";
import { BriefingPreview } from "./briefing-preview";
import { GenerateBriefingControl } from "./generate-briefing-control";
import { IncomingPreviewNotice } from "./incoming-preview-notice";

/**
 * The briefing workspace (F4–F7): Generate, the incoming candidate, and one editor for the
 * selected preview or the saved briefing. Nothing replaces unsaved text without an explicit choice.
 */
export function BriefingPanel({ eventId, view, refetch }: { eventId: EventId; view: EventView; refetch: RefetchEvent }) {
  const briefingDirty = useUiStore((state) => state.briefingDirty);
  const latest = toEditorBase(view);
  const [base, setBase] = useState<EditorBase | null>(latest);
  // A clean editor follows the saved records; a dirty draft keeps its base until save, discard or
  // explicit select (T3 §11). Adjusted during render, React's pattern for state derived from props.
  if (!briefingDirty && editorKey(base) !== editorKey(latest)) setBase(latest);
  // "Your briefing changes were saved." stays until the next edit starts. The dirty flag lags the
  // form by one effect, so clear on the clean→dirty transition, not on "dirty" itself.
  const [reconciled, setReconciled] = useState(false);
  const [wasDirty, setWasDirty] = useState(briefingDirty);
  if (briefingDirty !== wasDirty) {
    setWasDirty(briefingDirty);
    if (briefingDirty) setReconciled(false);
  }
  const pendingFocus = useRef(false);
  const consumePendingFocus = useCallback(() => {
    const pending = pendingFocus.current;
    pendingFocus.current = false;
    return pending;
  }, []);
  const onSaved = useCallback(({ reconciled: wasReconciled }: { reconciled: boolean }) => {
    pendingFocus.current = true;
    setReconciled(wasReconciled);
  }, []);

  const select = useSelectPreview(eventId);
  const openPreview = (generationId: GenerationId, moveFocus: boolean) => {
    select.mutate(generationId, {
      onSuccess: (response) => {
        // Explicit select: the new preview replaces the draft the coordinator chose to discard.
        pendingFocus.current = moveFocus;
        setBase({ slot: "selected", briefing: response.selectedPreview, briefingRevision: view.briefingRevision });
      },
    });
  };
  // F4 step 7: only a clean editor follows this tab's own result; the flag is read on arrival.
  const autoSelect = (preview: BriefingView) => {
    if (!useUiStore.getState().briefingDirty) openPreview(preview.provenance.generationId, false);
  };

  const incoming = view.incomingPreview;
  return (
    <section aria-label="Briefing">
      <VStack gap={3}>
        <Heading level={2}>Briefing</Heading>
        <GenerateBriefingControl eventId={eventId} view={view} onGenerated={autoSelect} />
        {incoming === null ? null : (
          <IncomingPreviewNotice
            preview={incoming}
            isDirty={briefingDirty}
            isOpening={select.isPending}
            onReview={() => {
              openPreview(incoming.provenance.generationId, true);
            }}
          />
        )}
        {reconciled ? <Banner status="success" title="Your briefing changes were saved." /> : null}
        {base !== null ? (
          <BriefingEditor
            key={editorKey(base)}
            eventId={eventId}
            view={view}
            base={base}
            refetch={refetch}
            onSaved={onSaved}
            consumePendingFocus={consumePendingFocus}
          />
        ) : incoming !== null ? (
          <BriefingPreview title="New preview (not yet reviewed)" briefing={incoming} view={view} />
        ) : (
          <EmptyState
            isCompact
            headingLevel={3}
            title="No briefing yet"
            description="Press Generate briefing to create one from the saved records."
          />
        )}
      </VStack>
    </section>
  );
}
```

`setBase` inside `onSuccess` uses `view.briefingRevision` from the render that started the select. If another tab saved meanwhile, the editor's next save conflicts and keeps its text. Once that editor is clean, the panel adopts the latest base by itself.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm vitest run --project web`
Expected: PASS.

- [ ] **Step 4: Verify and commit**

Run: `pnpm format && pnpm verify`
Expected: exit 0.

```bash
git add apps/web/src
git commit -m "feat(web): review new preview, auto-select after Generate, read-only incoming preview with sources" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: End to end — the F6 walkthrough in Chromium, with a scripted Gateway

**Files:**
- Create:
  - `e2e/package.json`, `e2e/tsconfig.json`, `e2e/e2e-env.ts`, `e2e/reset.ts`;
  - `e2e/fake-gateway.ts`, `e2e/playwright.config.ts`, `e2e/tests/f6-walkthrough.spec.ts`.
- Modify:
  - `pnpm-workspace.yaml` (`e2e`), root `package.json` (`e2e` script; `typecheck` gains `tsc -p e2e`);
  - `apps/web/vite.config.ts` (`EVENT_API_URL`), `.github/workflows/ci.yml` (e2e job), `AGENTS.md` (command table);
  - `pnpm-lock.yaml`.

**Interfaces:**
- Consumes:
  - `createRpcServer`, `RpcMessage` (`@event-desk/tcp-rpc`), run from source through `tsx --conditions=@event-desk/source`;
  - the event API's `db:reset` script; the web app's Vite dev server.
- Produces: `pnpm e2e`.
  1. It resets `event_desk_test` and the `event-desk:*` / `bull:briefing-batch:*` keys in Redis DB 2, with the E2E event API stopped.
  2. It then runs Playwright, which starts the fake Gateway on 4199, the event API on 4010 and the web app on 5183, and never reuses an existing server.

**Dependencies:** the `e2e` package's devDependencies are exactly `@playwright/test` 1.63.0 (approved by this plan) and `tsx` 4.23.15. The workspace already pins that `tsx` version at the root. Chromium is installed with `pnpm --filter @event-desk/e2e exec playwright install chromium`. The tests hard-code the two note texts they read: Playwright's loader does not apply the `@event-desk/source` condition, so the specs do not import contracts.

- [ ] **Step 1: Scaffold the package**

`pnpm-workspace.yaml`: add `- "e2e"` under `packages`.

`e2e/package.json`:

```json
{
  "name": "@event-desk/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "e2e": "tsx reset.ts && playwright test",
    "fake-gateway": "tsx --conditions=@event-desk/source fake-gateway.ts"
  },
  "dependencies": {
    "@event-desk/tcp-rpc": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "tsx": "4.23.15"
  }
}
```

`e2e/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["*.ts", "tests/**/*.ts"]
}
```

Root `package.json`:
- Add `"e2e": "pnpm --filter @event-desk/e2e e2e"`.
- Change `typecheck` to `"tsc -b && tsc -p apps/web && tsc -p e2e"`.

Run: `pnpm install`, then `pnpm --filter @event-desk/e2e exec playwright install chromium`.
Expected: the lockfile updates and Chromium downloads. If `minimumReleaseAge` refuses 1.63.0, stop and report it; do not add an exclusion.

- [ ] **Step 2: The shared E2E environment, the reset and the fake Gateway**

`e2e/e2e-env.ts`:

```ts
/**
 * One isolated stack for the walkthrough: its own ports, the test database and Redis DB 2, so it
 * never touches `pnpm dev` (4000/4100/5173) or the integration tests (Redis DB 1).
 * The secret is a local-only test value shared by the fake Gateway and the event API.
 */
export const E2E_PORTS = { gateway: 4199, eventApi: 4010, web: 5183 } as const;
export const E2E_GATEWAY_SECRET = "e2e-only-gateway-secret-0123456789abcdef";

export const E2E_EVENT_API_ENV: Record<string, string> = {
  HOST: "127.0.0.1",
  PORT: String(E2E_PORTS.eventApi),
  MYSQL_URL: process.env.TEST_MYSQL_URL ?? "mysql://event_desk:event_desk_local@127.0.0.1:3306/event_desk_test",
  REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://127.0.0.1:6379/2",
  ALLOWED_ORIGINS: `http://localhost:${String(E2E_PORTS.web)}`,
  ALLOWED_HOSTS: "localhost,127.0.0.1,[::1]",
  GATEWAY_HOST: "127.0.0.1",
  GATEWAY_PORT: String(E2E_PORTS.gateway),
  GATEWAY_SERVICE_SECRET: E2E_GATEWAY_SECRET,
  LOG_LEVEL: "warn",
};
```

`e2e/reset.ts`:

```ts
import { spawnSync } from "node:child_process";
import { E2E_EVENT_API_ENV } from "./e2e-env.js";

// F1's explicit reset, aimed at the E2E stores. It refuses while anything answers on the E2E API port.
const result = spawnSync("pnpm", ["--filter", "@event-desk/event-api", "db:reset"], {
  stdio: "inherit",
  env: { ...process.env, ...E2E_EVENT_API_ENV },
});
process.exit(result.status ?? 1);
```

`e2e/fake-gateway.ts`:

```ts
import { createRpcServer, type RpcMessage } from "@event-desk/tcp-rpc";
import { E2E_GATEWAY_SECRET, E2E_PORTS } from "./e2e-env.js";

let calls = 0;

/** Deterministic sections for the supplied notes; each call's theme wording is distinct. */
function sections(call: number): unknown {
  return {
    feedbackSummary: {
      text: "Feedback describes the walk as enjoyable, with comments mostly about logistics.",
      sourceIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"],
    },
    themes: [{ text: `Requests for more rest-break time (run ${String(call)}).`, sourceIds: ["F05", "F06"] }],
    conflicts: [
      { text: "One note found the meeting point hard to find; another had no trouble.", sourceIds: ["F01", "F02"] },
      { text: "One note asks for an earlier start; another says it would be difficult.", sourceIds: ["F03", "F04"] },
    ],
    suggestions: [{ text: "Consider reviewing the route length.", sourceIds: ["F07"] }],
  };
}

const correlation = (request: RpcMessage) => ({
  requestId: request.requestId ?? null,
  runId: request.runId ?? null,
  attemptId: request.attemptId ?? null,
});

const server = createRpcServer({
  secret: E2E_GATEWAY_SECRET,
  idleTimeoutMs: 2_000,
  handle(request) {
    calls += 1;
    return Promise.resolve({
      v: 1,
      ok: true,
      ...correlation(request),
      result: {
        sections: sections(calls),
        model: "e2e-fake-model",
        promptVersion: "e2e.v1",
        providerRequestId: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });
  },
  reject: (rejection) => ({
    v: 1,
    ok: false,
    requestId: null,
    runId: null,
    attemptId: null,
    error: { code: "GATEWAY_AUTH_FAILED", message: `E2E gateway refused: ${rejection.reason}.`, notSent: true },
  }),
});

await server.listen("127.0.0.1", E2E_PORTS.gateway);
process.stdout.write(`e2e fake gateway listening on 127.0.0.1:${String(E2E_PORTS.gateway)}\n`);
const stop = () => {
  void server.close().then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
```

`handle` returns `Promise<RpcMessage>` and `reject` is required (`packages/tcp-rpc/src/rpc-server.ts`). `apps/event-api/src/testing/fake-gateway.ts` is the integration-test counterpart.

`apps/web/vite.config.ts`: the proxy target becomes `process.env.EVENT_API_URL ?? "http://127.0.0.1:4000"`. Add the comment `// EVENT_API_URL: the E2E stack's event API (e2e/playwright.config.ts); pnpm dev uses 4000.` The port stays 5173 in the config. Playwright passes `--port`.

- [ ] **Step 3: The Playwright config**

`e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
import { E2E_EVENT_API_ENV, E2E_PORTS } from "./e2e-env.js";

const webUrl = `http://localhost:${String(E2E_PORTS.web)}`;

/** Chromium only (T3 §12). One worker: the walkthrough owns the single E101 event. */
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: process.env.CI !== undefined,
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: webUrl, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm run fake-gateway",
      port: E2E_PORTS.gateway,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "pnpm --filter @event-desk/event-api exec tsx --conditions=@event-desk/source src/main.ts",
      url: `http://127.0.0.1:${String(E2E_PORTS.eventApi)}/api/health`,
      env: E2E_EVENT_API_ENV,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @event-desk/web exec vite --port ${String(E2E_PORTS.web)} --strictPort`,
      url: webUrl,
      env: { EVENT_API_URL: `http://127.0.0.1:${String(E2E_PORTS.eventApi)}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
```

- [ ] **Step 4: Write the walkthrough**

`e2e/tests/f6-walkthrough.spec.ts`:

```ts
import { expect, type Locator, type Page, test } from "@playwright/test";

// The supplied notes (packages/contracts/src/supplied-records.ts), hard-coded: Playwright does not
// load workspace sources.
const F05 = "A longer rest break halfway would help.";
const F06 = "The rest stop felt rushed; a few more minutes would be good.";

const regions = (page: Page) => ({
  attendance: page.getByRole("region", { name: "Attendance" }),
  briefing: page.getByRole("region", { name: "Briefing" }),
});
// `has` is matched inside each list item, so the inner locator starts from the page, not the region.
const themeItem = (page: Page, briefing: Locator) =>
  briefing.getByRole("listitem").filter({ has: page.getByLabel("Theme 1") });

test("F6 example / F6-15: edit, save, change attendance, regenerate, replace", async ({ page }) => {
  await page.goto("/events/E101");
  const { attendance, briefing } = regions(page);

  // 1. Generate from the saved seed counts; this tab's result opens in the clean editor (F4 step 7).
  await expect(attendance.getByText("Saved counts: 4 registered · 1 attended · 2 absent · 1 not recorded")).toBeVisible();
  await briefing.getByRole("button", { name: "Generate briefing" }).click();
  await expect(briefing.getByRole("heading", { name: "Generated preview — not saved as briefing" })).toBeVisible();
  await expect(briefing.getByText(/References identify the source notes/)).toBeVisible();

  // 2. Review Focus 5: inspect F05/F06 by keyboard while editing; the draft survives; save.
  const theme = briefing.getByLabel("Theme 1");
  await theme.fill("People asked for longer rest breaks.");
  const readF05 = themeItem(page, briefing).getByRole("button", { name: "Read source F05" });
  await readF05.focus();
  await page.keyboard.press("Enter");
  await expect(readF05).toHaveAttribute("aria-expanded", "true");
  await expect(themeItem(page, briefing).getByText(F05)).toBeVisible();
  await themeItem(page, briefing).getByRole("button", { name: "Read source F06" }).press("Enter");
  await expect(themeItem(page, briefing).getByText(F06)).toBeVisible();
  await expect(theme).toHaveValue("People asked for longer rest breaks.");
  await briefing.getByRole("button", { name: "Save briefing" }).click();
  await expect(briefing.getByRole("heading", { name: /^Saved briefing · last saved / })).toBeVisible();

  await page.reload(); // F5-02: the wording and its references survive a reload
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("People asked for longer rest breaks.");
  await expect(themeItem(page, briefing).getByRole("button", { name: "Read source F05" })).toBeVisible();
  await expect(themeItem(page, briefing).getByRole("button", { name: "Read source F06" })).toBeVisible();

  // 3. An unsaved attendance change shows unsaved counts and does not touch the briefing.
  await attendance.getByLabel("Chris").selectOption("attended");
  await expect(attendance.getByText("Unsaved counts: 4 registered · 2 attended · 2 absent · 0 not recorded")).toBeVisible();
  await expect(briefing.getByText("Up to date with the saved attendance and feedback.")).toBeVisible();

  // 4. Saving attendance marks the saved briefing out of date; wording and references stay.
  await attendance.getByRole("button", { name: "Save attendance" }).click();
  await expect(attendance.getByText("Saved counts: 4 registered · 2 attended · 2 absent · 0 not recorded")).toBeVisible();
  await expect(briefing.getByText("Out of date — attendance changed since this briefing was generated")).toBeVisible();
  await expect(briefing.getByText("Chris: Not recorded → Attended")).toBeVisible();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("People asked for longer rest breaks.");

  // 5. F6-12: saving edited wording keeps the stale flag.
  await briefing.getByLabel("Theme 1").fill("Several people asked for longer rest breaks.");
  await briefing.getByRole("button", { name: "Save briefing" }).click();
  await expect(briefing.getByText("Unsaved changes to the briefing text.")).toHaveCount(0);
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("Several people asked for longer rest breaks.");
  await expect(briefing.getByText("Out of date — attendance changed since this briefing was generated")).toBeVisible();

  // 6. F6-09: Generate with unsaved text; the result waits as incoming and the draft is untouched.
  await briefing.getByLabel("Theme 1").fill("Draft that must survive generation.");
  await briefing.getByRole("button", { name: "Generate briefing" }).click();
  await expect(briefing.getByText("New briefing ready to review")).toBeVisible();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("Draft that must survive generation.");

  // 7. Review it (explicitly discarding the draft), inspect its sources, then Save and replace.
  await briefing.getByRole("button", { name: "Review new preview" }).click();
  await page.getByRole("button", { name: "Discard and review" }).click();
  await expect(briefing.getByRole("heading", { name: "Generated preview — not saved as briefing" })).toBeVisible();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("Requests for more rest-break time (run 2).");
  await themeItem(page, briefing).getByRole("button", { name: "Read source F05" }).click();
  await expect(themeItem(page, briefing).getByText(F05)).toBeVisible();
  await briefing.getByRole("button", { name: "Save and replace briefing" }).click();
  await expect(briefing.getByRole("heading", { name: /^Saved briefing · last saved / })).toBeVisible();
  await expect(briefing.getByText("Up to date with the saved attendance and feedback.")).toBeVisible();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("Requests for more rest-break time (run 2).");
});
```

Run: `pnpm e2e` (with `pnpm infra:up`, and with `pnpm dev` and the integration tests not running).
Expected: 1 passed. If a selector misses, fix the test or the UI; never weaken an assertion of spec text. A real UI defect found here is fixed in the owning component with a unit test first (AGENTS.md "Every bug fix starts with a failing test").

- [ ] **Step 5: CI and docs**

`.github/workflows/ci.yml`: add a job after `integration`:

```yaml
  e2e:
    name: end-to-end (Chromium, F6 walkthrough)
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.4
        env:
          MYSQL_ROOT_PASSWORD: event_desk_root
          MYSQL_DATABASE: event_desk_test
          MYSQL_USER: event_desk
          MYSQL_PASSWORD: event_desk_local
        ports:
          - 3306:3306
        options: >-
          --health-cmd "mysqladmin ping -h 127.0.0.1 -uroot -pevent_desk_root --silent"
          --health-interval 5s --health-timeout 5s --health-retries 30
      redis:
        image: redis:8
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s --health-timeout 3s --health-retries 20
    env:
      TEST_MYSQL_URL: mysql://event_desk:event_desk_local@127.0.0.1:3306/event_desk_test
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @event-desk/e2e exec playwright install --with-deps chromium
      - run: pnpm e2e
```

`AGENTS.md`: add this row to the command table after `pnpm test:integration`:

`| \`pnpm e2e\` | Resets \`event_desk_test\` and Redis DB 2, then runs the Playwright F6 walkthrough on its own ports (Gateway 4199, API 4010, web 5183). Needs \`pnpm infra:up\` and Chromium (\`pnpm --filter @event-desk/e2e exec playwright install chromium\`); do not run it alongside the integration tests |`

- [ ] **Step 6: Verify and commit**

Run: `pnpm format && pnpm verify && pnpm test:integration && pnpm e2e`
Expected: all exit 0.

```bash
git add e2e pnpm-workspace.yaml package.json pnpm-lock.yaml apps/web/vite.config.ts .github/workflows/ci.yml AGENTS.md
git commit -m "test(e2e): Playwright F6 walkthrough against the real stack with a scripted Gateway" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
