import {
  type AttendanceStatus,
  SUPPLIED_EVENT,
  SUPPLIED_FEEDBACK,
  SUPPLIED_FEEDBACK_DIGEST,
  SUPPLIED_MEMBERS,
} from "@event-desk/contracts";
import type { DataSource } from "typeorm";

export const FIXTURE_TIME = new Date("2026-10-03T09:00:00.000Z");
export const GENERATION_FIXTURE_ID = "0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e7f";
export const OTHER_GENERATION_FIXTURE_ID = "0199a4e8-7c1a-7cc2-9d6e-2f3b4c5d6e80";

/** Raw-SQL E101 with the supplied roster and notes; independent of the seeder under test. */
export async function insertEventFixture(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    "INSERT INTO events (id, name, club_name, status, next_feedback_number) VALUES (?, ?, ?, 'ended', 9)",
    [SUPPLIED_EVENT.id, SUPPLIED_EVENT.name, SUPPLIED_EVENT.clubName],
  );
  for (const [index, member] of SUPPLIED_MEMBERS.entries()) {
    await dataSource.query(
      "INSERT INTO members (event_id, id, name, attendance, display_order) VALUES (?, ?, ?, ?, ?)",
      [SUPPLIED_EVENT.id, member.id, member.name, member.attendance, index + 1],
    );
  }
  for (const [index, note] of SUPPLIED_FEEDBACK.entries()) {
    await dataSource.query(
      "INSERT INTO feedback_notes (event_id, id, text, origin, received_at, display_order) VALUES (?, ?, ?, 'seed', ?, ?)",
      [SUPPLIED_EVENT.id, note.id, note.text, FIXTURE_TIME, index + 1],
    );
  }
}

export interface ItemFixture {
  id: string;
  section: "summary" | "theme" | "conflict" | "suggestion";
  position: number;
  text: string;
  sourceIds: string[];
}

export interface GenerationFixture {
  id?: string;
  runId?: string;
  trigger?: "manual" | "feedback_batch";
  attendance?: { memberId: string; attendance: AttendanceStatus }[];
  feedbackIds?: string[];
  feedbackDigest?: string;
  items?: ItemFixture[];
}

export const DEFAULT_ITEMS: ItemFixture[] = [
  {
    id: "0199a4e8-0000-7000-8000-000000000001",
    section: "summary",
    position: 0,
    text: "Feedback describes the walk as enjoyable, with comments mostly about logistics.",
    sourceIds: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"],
  },
  {
    id: "0199a4e8-0000-7000-8000-000000000002",
    section: "theme",
    position: 0,
    text: "Requests for more rest-break time.",
    sourceIds: ["F05", "F06"],
  },
  {
    id: "0199a4e8-0000-7000-8000-000000000003",
    section: "conflict",
    position: 0,
    text: "One note asks for an earlier start; another says it would be difficult.",
    sourceIds: ["F03", "F04"],
  },
  {
    id: "0199a4e8-0000-7000-8000-000000000004",
    section: "suggestion",
    position: 0,
    text: "Consider reviewing the route length.",
    sourceIds: ["F07"],
  },
];

/**
 * Writes one immutable generation (row, inputs, items, sources) as Plan 3's commit will.
 * Defaults: captured from the supplied seed records with the real digest, so it is current.
 */
export async function insertGenerationFixture(
  dataSource: DataSource,
  spec: GenerationFixture = {},
): Promise<string> {
  const id = spec.id ?? GENERATION_FIXTURE_ID;
  const eventId = SUPPLIED_EVENT.id;
  const attendance =
    spec.attendance ?? SUPPLIED_MEMBERS.map((m) => ({ memberId: m.id, attendance: m.attendance }));
  const feedbackIds = spec.feedbackIds ?? SUPPLIED_FEEDBACK.map((n) => n.id);
  await dataSource.query(
    `INSERT INTO briefing_generations (id, event_id, run_id, trigger_type, model, prompt_version,
       attendance_overview, feedback_digest, input_captured_at, generated_at)
     VALUES (?, ?, ?, ?, 'fixture-model', 'briefing-v1', ?, ?, ?, ?)`,
    [
      id,
      eventId,
      spec.runId ?? `manual:${id}`,
      spec.trigger ?? "manual",
      "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      spec.feedbackDigest ?? SUPPLIED_FEEDBACK_DIGEST,
      FIXTURE_TIME,
      FIXTURE_TIME,
    ],
  );
  for (const input of attendance) {
    await dataSource.query(
      "INSERT INTO generation_attendance_inputs (generation_id, event_id, member_id, attendance) VALUES (?, ?, ?, ?)",
      [id, eventId, input.memberId, input.attendance],
    );
  }
  for (const feedbackId of feedbackIds) {
    await dataSource.query(
      "INSERT INTO generation_feedback_inputs (generation_id, event_id, feedback_id) VALUES (?, ?, ?)",
      [id, eventId, feedbackId],
    );
  }
  for (const item of spec.items ?? DEFAULT_ITEMS) {
    await dataSource.query(
      "INSERT INTO briefing_items (id, generation_id, section, position, text) VALUES (?, ?, ?, ?, ?)",
      [item.id, id, item.section, item.position, item.text],
    );
    for (const [position, feedbackId] of item.sourceIds.entries()) {
      await dataSource.query(
        "INSERT INTO briefing_item_sources (item_id, generation_id, feedback_id, position) VALUES (?, ?, ?, ?)",
        [item.id, id, feedbackId, position],
      );
    }
  }
  return id;
}

export async function putPreviewSlot(
  dataSource: DataSource,
  slot: "selected" | "incoming",
  generationId: string,
): Promise<void> {
  await dataSource.query(
    "INSERT INTO preview_slots (event_id, slot, generation_id, updated_at) VALUES (?, ?, ?, ?)",
    [SUPPLIED_EVENT.id, slot, generationId, FIXTURE_TIME],
  );
}

export interface SavedBriefingFixture {
  generationId: string;
  attendanceOverview: string;
  itemTexts: Record<string, string>;
}

export async function insertSavedBriefing(
  dataSource: DataSource,
  spec: SavedBriefingFixture,
): Promise<void> {
  await dataSource.query(
    "INSERT INTO saved_briefings (event_id, generation_id, attendance_overview, saved_at) VALUES (?, ?, ?, ?)",
    [SUPPLIED_EVENT.id, spec.generationId, spec.attendanceOverview, FIXTURE_TIME],
  );
  for (const [itemId, text] of Object.entries(spec.itemTexts)) {
    await dataSource.query(
      "INSERT INTO saved_briefing_items (event_id, generation_id, item_id, text) VALUES (?, ?, ?, ?)",
      [SUPPLIED_EVENT.id, spec.generationId, itemId, text],
    );
  }
}

export interface OutcomeFixture {
  runId: string;
  trigger: "manual" | "feedback_batch";
  status: "succeeded" | "failed" | "skipped" | "superseded" | "superseded_by_manual";
  errorCode?: string;
  finishedAt: Date;
}

export async function insertOutcome(dataSource: DataSource, spec: OutcomeFixture): Promise<void> {
  await dataSource.query(
    "INSERT INTO generation_outcomes (run_id, event_id, trigger_type, status, error_code, finished_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      spec.runId,
      SUPPLIED_EVENT.id,
      spec.trigger,
      spec.status,
      spec.errorCode ?? null,
      spec.finishedAt,
    ],
  );
}

/** A note submitted through the feedback form (F3), with the event's next number moved past it. */
export async function insertSubmittedNote(
  dataSource: DataSource,
  spec: { id: string; text: string; receivedAt?: Date },
): Promise<void> {
  const number = Number.parseInt(spec.id.slice(1), 10);
  await dataSource.query(
    `INSERT INTO feedback_notes (event_id, id, text, origin, submission_id, received_at, display_order)
     VALUES (?, ?, ?, 'submitted', UUID(), ?, ?)`,
    [SUPPLIED_EVENT.id, spec.id, spec.text, spec.receivedAt ?? FIXTURE_TIME, number],
  );
  await dataSource.query(
    "UPDATE events SET next_feedback_number = GREATEST(next_feedback_number, ?)",
    [number + 1],
  );
}

export async function setFeedbackPending(dataSource: DataSource, at: Date | null): Promise<void> {
  await dataSource.query("UPDATE events SET feedback_pending_since = ?", [at]);
}
