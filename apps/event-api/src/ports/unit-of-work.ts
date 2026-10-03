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
}

export interface EventWriteRepository extends EventReadRepository {
  /** `SELECT … FOR UPDATE` on the event row: the single serialisation point for writers. */
  lockForUpdate(eventId: EventId): Promise<EventAggregate>;
  /** Updates the changed members only and bumps attendance_revision by one. */
  applyAttendanceChanges(eventId: EventId, changes: readonly AttendanceChange[]): Promise<void>;
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
}

export type RunOutcomeStatus = (typeof RUN_OUTCOME_STATUSES)[number];

export interface NewOutcome {
  runId: RunId;
  eventId: EventId;
  trigger: GenerationTrigger;
  status: RunOutcomeStatus;
  /** Required when status is "failed" (T4 ck_outcome_error), otherwise null. */
  errorCode: ErrorCode | null;
  generationId: GenerationId | null;
  finishedAt: Date;
}

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

export interface GenerationWriteRepository {
  /** Inserts the immutable generation with its inputs, items and sources (T4 §2). */
  insert(generation: NewGeneration): Promise<void>;
  /** The generation a run already committed, if any: a run commits at most once (T4-05). */
  findIdByRunId(runId: RunId): Promise<GenerationId | null>;
  /** Deletes it with its children unless a slot or the saved briefing still references it (T4 §5). */
  deleteIfUnreferenced(eventId: EventId, generationId: GenerationId): Promise<boolean>;
}

export interface IncomingSlot {
  generationId: GenerationId;
  trigger: GenerationTrigger;
  inputCapturedAt: Date;
}

export interface PreviewSlotRepository {
  incoming(eventId: EventId): Promise<IncomingSlot | null>;
  /** Upserts preview_slots('incoming'). */
  putIncoming(eventId: EventId, generationId: GenerationId, now: Date): Promise<void>;
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
