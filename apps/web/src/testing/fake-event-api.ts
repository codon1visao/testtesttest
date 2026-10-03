import {
  type AttendanceStatus,
  type BriefingContent,
  type BriefingView,
  deriveAttendanceCounts,
  GenerateBriefingRequestSchema,
  type HttpErrorCode,
  type EventView,
  type FeedbackNote,
  FeedbackIdSchema,
  type EvidenceItem,
  type MemberId,
  SaveAttendanceRequestSchema,
  type SaveAttendanceResponse,
  SaveBriefingRequestSchema,
  SelectPreviewRequestSchema,
  SubmitFeedbackRequestSchema,
} from "@event-desk/contracts";
import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { delay, http, HttpResponse } from "msw";

export function apiErrorResponse(
  status: number,
  code: HttpErrorCode,
  message: string,
  field?: string,
) {
  return HttpResponse.json(
    { error: { code, message, ...(field === undefined ? {} : { field }) } },
    { status },
  );
}

export type GenerationReply =
  | { kind: "preview"; preview?: BriefingView; delayMs?: number }
  | {
      kind: "error";
      status: number;
      code: HttpErrorCode;
      message: string;
      retryAfterMs?: number;
      /** Holds the error reply until this settles, to act while the call is in flight. */
      gate?: Promise<void>;
    };

/**
 * An in-memory stand-in for the Plan 2 API with the same contract and rules, in the service's order:
 * full-roster check (400, field "members"), then revision check (409), revision bump only on a real
 * change.
 */
export class FakeEventApi {
  view: EventView = buildSeedEventView();
  readonly attendanceRequests: unknown[] = [];
  readonly generationRequests: unknown[] = [];
  readonly selectRequests: unknown[] = [];
  readonly saveRequests: unknown[] = [];
  readonly feedbackRequests: unknown[] = [];
  /** Replies for upcoming feedback submissions, consumed in order; "lost" drops the response. */
  readonly feedbackReplies: ("lost" | { status: number; code: HttpErrorCode; message: string })[] =
    [];
  private readonly submissions = new Map<string, FeedbackNote>();
  /** Holds each briefing save this long before replying, to observe the saving state. */
  saveDelayMs = 0;
  /** Holds each preview select this long before replying, to act while it is in flight. */
  selectDelayMs = 0;
  /** Replies for upcoming generation calls, consumed in order; an empty queue yields a manual preview. */
  readonly generationReplies: GenerationReply[] = [];

  /** Simulates another tab saving: changes one member and bumps the revision. */
  saveElsewhere(memberId: MemberId, attendance: AttendanceStatus): void {
    const members = this.view.members.map((m) => (m.id === memberId ? { ...m, attendance } : m));
    this.view = {
      ...this.view,
      members,
      counts: deriveAttendanceCounts(members),
      attendanceRevision: this.view.attendanceRevision + 1,
    };
  }

  /** Another tab saved the briefing: only the revision is visible to this tab's next save. */
  saveBriefingElsewhere(): void {
    this.view = { ...this.view, briefingRevision: this.view.briefingRevision + 1 };
  }

  /** A result from elsewhere (another tab, or a batch in Plan 5) lands in the incoming slot. */
  putIncoming(preview: BriefingView): void {
    this.view = { ...this.view, incomingPreview: preview };
  }

  handlers() {
    return [
      http.get("/api/events/:eventId", ({ params }) =>
        params.eventId === this.view.event.id
          ? HttpResponse.json(this.view)
          : apiErrorResponse(
              404,
              "EVENT_NOT_FOUND",
              `Event ${String(params.eventId)} was not found.`,
            ),
      ),
      http.put("/api/events/:eventId/attendance", async ({ request }) => {
        const body: unknown = await request.json();
        this.attendanceRequests.push(body);
        const parsed = SaveAttendanceRequestSchema.safeParse(body);
        if (!parsed.success)
          return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid attendance body.");
        const requested = new Map(parsed.data.members.map((m) => [m.id, m.attendance]));
        if (
          requested.size !== this.view.members.length ||
          this.view.members.some((m) => !requested.has(m.id))
        ) {
          return apiErrorResponse(
            400,
            "VALIDATION_FAILED",
            "members must list each registered member exactly once.",
            "members",
          );
        }
        if (parsed.data.baseAttendanceRevision !== this.view.attendanceRevision) {
          return apiErrorResponse(
            409,
            "ATTENDANCE_CONFLICT",
            "Attendance was saved elsewhere since you loaded it. Reload to see the latest records.",
          );
        }
        const members = this.view.members.map((m) => ({
          ...m,
          attendance: requested.get(m.id) ?? m.attendance,
        }));
        const changed = members.some((m, i) => m.attendance !== this.view.members[i]?.attendance);
        this.view = {
          ...this.view,
          members,
          counts: deriveAttendanceCounts(members),
          attendanceRevision: this.view.attendanceRevision + (changed ? 1 : 0),
        };
        const response: SaveAttendanceResponse = {
          members: this.view.members,
          counts: this.view.counts,
          attendanceRevision: this.view.attendanceRevision,
          freshness: { savedBriefing: null, selectedPreview: null, incomingPreview: null },
        };
        return HttpResponse.json(response);
      }),
      http.post("/api/events/:eventId/briefing-generations", async ({ request }) => {
        const body: unknown = await request.json();
        this.generationRequests.push(body);
        const parsed = GenerateBriefingRequestSchema.safeParse(body);
        if (!parsed.success)
          return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid generation body.");
        if (parsed.data.baseAttendanceRevision !== this.view.attendanceRevision) {
          return apiErrorResponse(
            409,
            "ATTENDANCE_CONFLICT",
            "Attendance was saved elsewhere since you loaded it. Reload, then generate again.",
          );
        }
        const reply = this.generationReplies.shift() ?? { kind: "preview" };
        if (reply.kind === "error") {
          if (reply.gate !== undefined) await reply.gate;
          return HttpResponse.json(
            {
              error: {
                code: reply.code,
                message: reply.message,
                ...(reply.retryAfterMs === undefined ? {} : { retryAfterMs: reply.retryAfterMs }),
              },
            },
            { status: reply.status },
          );
        }
        if (reply.delayMs !== undefined) await delay(reply.delayMs);
        const incomingPreview = reply.preview ?? buildBriefingView();
        this.view = { ...this.view, incomingPreview };
        return HttpResponse.json({ incomingPreview }, { status: 201 });
      }),
      http.post("/api/events/:eventId/briefing-preview/select", async ({ request }) => {
        const body: unknown = await request.json();
        this.selectRequests.push(body);
        if (this.selectDelayMs > 0) await delay(this.selectDelayMs);
        const parsed = SelectPreviewRequestSchema.safeParse(body);
        if (!parsed.success)
          return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid select body.");
        const incoming = this.view.incomingPreview;
        const selectedId = this.view.selectedPreview?.provenance.generationId ?? null;
        if (
          incoming?.provenance.generationId !== parsed.data.generationId ||
          selectedId !== parsed.data.expectedSelectedGenerationId
        ) {
          return apiErrorResponse(
            409,
            "PREVIEW_CONFLICT",
            "This preview is no longer waiting for review. Reload to see the latest briefing.",
          );
        }
        this.view = { ...this.view, selectedPreview: incoming, incomingPreview: null };
        return HttpResponse.json({ selectedPreview: incoming });
      }),
      http.put("/api/events/:eventId/briefing", async ({ request }) => {
        const body: unknown = await request.json();
        this.saveRequests.push(body);
        if (this.saveDelayMs > 0) await delay(this.saveDelayMs);
        const parsed = SaveBriefingRequestSchema.safeParse(body);
        if (!parsed.success)
          return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid briefing body.");
        const { baseBriefingRevision, generationId, textEdits } = parsed.data;
        if (baseBriefingRevision !== this.view.briefingRevision) {
          return apiErrorResponse(
            409,
            "BRIEFING_CONFLICT",
            "The briefing was saved elsewhere since you loaded it. Your text is kept; reload to see the saved briefing.",
          );
        }
        const fromSelected = this.view.selectedPreview?.provenance.generationId === generationId;
        const source = fromSelected
          ? this.view.selectedPreview
          : this.view.savedBriefing?.provenance.generationId === generationId
            ? this.view.savedBriefing
            : null;
        if (source === null) {
          return apiErrorResponse(
            409,
            "GENERATION_NOT_AVAILABLE",
            "This briefing is no longer available to save. Reload to see the latest briefing.",
          );
        }
        const sections = ["themes", "conflicts", "suggestions"] as const;
        const wrong = sections.find(
          (section) => textEdits[section].length !== source.content[section].length,
        );
        if (wrong !== undefined) {
          return apiErrorResponse(
            422,
            "CONTENT_INVALID",
            `Expected ${String(source.content[wrong].length)} items.`,
            `textEdits.${wrong}`,
          );
        }
        const retext = (items: readonly EvidenceItem[], texts: readonly string[]) =>
          items.map((item, index) => ({
            text: texts[index] ?? item.text,
            sourceIds: item.sourceIds,
          }));
        const content: BriefingContent = {
          attendanceOverview: textEdits.attendanceOverview,
          feedbackSummary: {
            text: textEdits.feedbackSummary,
            sourceIds: source.content.feedbackSummary.sourceIds,
          },
          themes: retext(source.content.themes, textEdits.themes),
          conflicts: retext(source.content.conflicts, textEdits.conflicts),
          suggestions: retext(source.content.suggestions, textEdits.suggestions),
        };
        const savedBriefing: BriefingView = {
          ...source,
          content,
          savedAt: new Date().toISOString(),
        };
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
      http.post("/api/events/:eventId/feedback", async ({ request }) => {
        const body: unknown = await request.json();
        this.feedbackRequests.push(body);
        const reply = this.feedbackReplies.shift();
        if (reply === "lost") return HttpResponse.error();
        if (reply !== undefined) return apiErrorResponse(reply.status, reply.code, reply.message);
        const parsed = SubmitFeedbackRequestSchema.safeParse(body);
        if (!parsed.success)
          return apiErrorResponse(400, "VALIDATION_FAILED", "Invalid feedback body.");
        const existing = this.submissions.get(parsed.data.submissionId);
        if (existing !== undefined) {
          return HttpResponse.json(
            { note: existing, automaticBriefing: "scheduled" },
            { status: 200 },
          );
        }
        const note = {
          id: FeedbackIdSchema.parse(`F${String(this.view.feedback.length + 1).padStart(2, "0")}`),
          text: parsed.data.text,
          receivedAt: new Date().toISOString(),
        };
        this.submissions.set(parsed.data.submissionId, note);
        this.view = { ...this.view, feedback: [...this.view.feedback, note] };
        return HttpResponse.json({ note, automaticBriefing: "scheduled" }, { status: 201 });
      }),
    ];
  }
}
