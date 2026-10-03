import type {
  AttendanceChange,
  EventId,
  EventSummary,
  FeedbackNote,
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

export interface ReadScope {
  events: EventReadRepository;
}

export interface TransactionScope extends ReadScope {
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
