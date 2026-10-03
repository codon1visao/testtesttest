import type {
  AttendanceChange,
  BriefingContent,
  ErrorCode,
  EventId,
  EventSummary,
  FeedbackId,
  FeedbackNote,
  GenerationId,
  GenerationProvenance,
  GenerationStatusView,
  GenerationTrigger,
  Member,
  MemberAttendance,
  RUN_OUTCOME_STATUSES,
  RunId,
} from "@event-desk/contracts";
import type { NewItem } from "../modules/generation/domain/generation-items.js";
import type { InputSnapshot } from "../modules/generation/domain/same-input.js";

/** The event row with its roster and notes, as one consistent read. */
export interface EventAggregate {
  event: EventSummary;
  attendanceRevision: number;
  briefingRevision: number;
  members: Member[];
  feedback: FeedbackNote[];
}

export interface EventReadRepository {
  findAggregate(eventId: EventId): Promise<EventAggregate | null>;
  /** Events whose notes were saved but not yet captured by a batch (F7 Durability). */
  pendingFeedbackEventIds(): Promise<EventId[]>;
}

export interface EventWriteRepository extends EventReadRepository {
  /** `SELECT … FOR UPDATE` on the event row: the single serialisation point for writers. */
  lockForUpdate(eventId: EventId): Promise<EventAggregate>;
  /** Updates the changed members only and bumps attendance_revision by one. */
  applyAttendanceChanges(eventId: EventId, changes: readonly AttendanceChange[]): Promise<void>;
  /** Bumps briefing_revision by one: the saved briefing changed (T4 TX8). */
  bumpBriefingRevision(eventId: EventId): Promise<void>;
  /** Read under the event lock. */
  feedbackState(
    eventId: EventId,
  ): Promise<{ nextFeedbackNumber: number; pendingSince: Date | null }>;
  /** next_feedback_number + 1; feedback_pending_since = COALESCE(feedback_pending_since, at) (T4 TX9). */
  recordFeedbackReceived(eventId: EventId, at: Date): Promise<void>;
  /** feedback_pending_since = NULL: a batch captured the event's notes (T4 TX10). */
  clearFeedbackPending(eventId: EventId): Promise<void>;
}

export interface NewFeedbackNote {
  eventId: EventId;
  id: FeedbackId;
  text: string;
  submissionId: string;
  receivedAt: Date;
  displayOrder: number;
}

export interface FeedbackWriteRepository {
  findBySubmissionId(eventId: EventId, submissionId: string): Promise<FeedbackNote | null>;
  insert(note: NewFeedbackNote): Promise<void>;
}

/** A briefing as stored: generated structure and references, with saved wording when it is the saved one. */
export interface StoredBriefing {
  provenance: GenerationProvenance;
  trigger: GenerationTrigger;
  content: BriefingContent;
  savedAt?: string;
}

export interface BriefingSlots {
  saved: StoredBriefing | null;
  selected: StoredBriefing | null;
  incoming: StoredBriefing | null;
}

export interface BriefingReadRepository {
  loadSlots(eventId: EventId): Promise<BriefingSlots>;
}

export type LastOutcome = NonNullable<GenerationStatusView["lastOutcome"]>;

export interface OutcomeReadRepository {
  latest(eventId: EventId): Promise<LastOutcome | null>;
  /** The run's recorded outcome status, or null while it has none (it has not finished). */
  statusOf(runId: RunId): Promise<RunOutcomeStatus | null>;
}

export type RunOutcomeStatus = (typeof RUN_OUTCOME_STATUSES)[number];

/** A failed run always carries its code, any other outcome none (T4 ck_outcome_error). */
export type OutcomeResult =
  | { status: "failed"; errorCode: ErrorCode }
  | { status: Exclude<RunOutcomeStatus, "failed">; errorCode: null };

export type NewOutcome = OutcomeResult & {
  runId: RunId;
  eventId: EventId;
  trigger: GenerationTrigger;
  generationId: GenerationId | null;
  finishedAt: Date;
};

export interface OutcomeWriteRepository extends OutcomeReadRepository {
  /** Records the run's outcome (a repeated runId is a no-op) and keeps the event's latest 20. */
  record(outcome: NewOutcome): Promise<void>;
}

export interface NewGeneration {
  id: GenerationId;
  eventId: EventId;
  runId: RunId;
  trigger: GenerationTrigger;
  model: string;
  promptVersion: string;
  attendanceOverview: string;
  feedbackDigest: string;
  inputCapturedAt: Date;
  generatedAt: Date;
  attendance: readonly MemberAttendance[];
  feedbackIds: readonly FeedbackId[];
  items: readonly NewItem[];
}

/** A stored generation's fixed structure: what TX8 edits text against (D2). */
export interface GenerationStructure {
  attendanceOverview: string;
  feedbackIds: FeedbackId[];
  /** Reading order: summary, themes, conflicts, suggestions; by position; sources in citation order. */
  items: NewItem[];
}

export interface GenerationWriteRepository {
  /** Inserts the immutable generation with its inputs, items and sources (T4 §2). */
  insert(generation: NewGeneration): Promise<void>;
  /** The generation a run already committed, if any: a run commits at most once (T4-05). */
  findIdByRunId(runId: RunId): Promise<GenerationId | null>;
  /** Deletes it with its children unless a slot or the saved briefing still references it (T4 §5). */
  deleteIfUnreferenced(eventId: EventId, generationId: GenerationId): Promise<boolean>;
  /** The generation's fixed structure, or null when the event has no such generation. */
  structure(eventId: EventId, generationId: GenerationId): Promise<GenerationStructure | null>;
  /** The input of the event's newest generation (by input_captured_at, then id), if any (F7 rule 6). */
  latestInput(eventId: EventId): Promise<InputSnapshot | null>;
}

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
  /** Upserts preview_slots('incoming'). */
  putIncoming(eventId: EventId, generationId: GenerationId, now: Date): Promise<void>;
  /**
   * Upserts preview_slots('selected'). A generation may sit in only one slot (uq_slot_generation):
   * callers move it by clearing its old slot first.
   */
  putSelected(eventId: EventId, generationId: GenerationId, now: Date): Promise<void>;
  clear(eventId: EventId, slot: "selected" | "incoming"): Promise<void>;
}

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

export interface ReadScope {
  events: EventReadRepository;
  briefings: BriefingReadRepository;
  outcomes: OutcomeReadRepository;
}

export interface TransactionScope extends ReadScope {
  /**
   * `lockForUpdate` must be the first read in a transaction: the REPEATABLE READ snapshot is
   * fixed by the first consistent read, so a plain read before the lock would see rows from
   * before the lock was granted.
   */
  events: EventWriteRepository;
  generations: GenerationWriteRepository;
  slots: PreviewSlotRepository;
  savedBriefings: SavedBriefingWriteRepository;
  feedback: FeedbackWriteRepository;
  /** Narrows ReadScope.outcomes: a transaction may also record outcomes (TX5/TX6). */
  outcomes: OutcomeWriteRepository;
  /** Runs only after COMMIT succeeds (cache flush, change notification). */
  afterCommit(effect: () => Promise<void>): void;
}

export interface UnitOfWork {
  /** BEGIN … COMMIT on one connection; retries nothing. */
  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T>;
  /** START TRANSACTION READ ONLY: a consistent snapshot without locks. */
  readSnapshot<T>(work: (scope: ReadScope) => Promise<T>): Promise<T>;
}
