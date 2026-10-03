import type {
  AttendanceChange,
  BriefingContent,
  EventId,
  EventSummary,
  FeedbackNote,
  GenerationProvenance,
  GenerationStatusView,
  GenerationTrigger,
  Member,
} from "@event-desk/contracts";

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
  /** Runs only after COMMIT succeeds (cache flush, change notification). */
  afterCommit(effect: () => Promise<void>): void;
}

export interface UnitOfWork {
  /** BEGIN … COMMIT on one connection; retries nothing. */
  run<T>(work: (tx: TransactionScope) => Promise<T>): Promise<T>;
  /** START TRANSACTION READ ONLY: a consistent snapshot without locks. */
  readSnapshot<T>(work: (scope: ReadScope) => Promise<T>): Promise<T>;
}
