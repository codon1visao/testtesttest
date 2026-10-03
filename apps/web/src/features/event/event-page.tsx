import { Banner } from "@astryxdesign/core/Banner";
import { VStack } from "@astryxdesign/core/Layout";
import { type EventId, EventIdSchema } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { useParams } from "react-router";
import { describeApiError } from "../../data/http/api-error";
import { useEventChanges } from "../../data/queries/use-event-changes";
import { useEventQuery } from "../../data/queries/use-event-query";
import { useRefetchAt } from "../../data/queries/use-refetch-at";
import { NotFoundPage } from "../../shared/ui/not-found-page";
import { LoadErrorState, LoadingState } from "../../shared/ui/page-states";
import { PanelErrorBoundary } from "../../shared/ui/panel-error-boundary";
import { useUiStore } from "../../state/ui-store";
import { AttendancePanel } from "../attendance/attendance-panel";
import { displayedBriefing } from "../briefing/active-briefing";
import { BriefingPanel } from "../briefing/briefing-panel";
import { FeedbackPanel } from "../feedback/feedback-panel";
import { EventHeader } from "./event-header";

const styles = stylex.create({
  page: { maxWidth: 960, marginInline: "auto", padding: "1.5rem" },
});

export function EventPage() {
  const { eventId = "" } = useParams();
  const parsed = EventIdSchema.safeParse(eventId);
  if (!parsed.success) return <NotFoundPage title="Event not found" />;
  return <EventScreen eventId={parsed.data} />;
}

export function EventScreen({ eventId }: { eventId: EventId }) {
  const { live } = useEventChanges(eventId);
  const query = useEventQuery(eventId, { live });
  const generation = query.data?.generation;
  // Cooldown end and batch cutoff/next attempt are moments no server push announces.
  useRefetchAt(
    eventId,
    generation === undefined
      ? []
      : [generation.cooldownUntil, generation.batch?.closesAt, generation.batch?.nextAttemptAt],
  );
  const activeView = useUiStore((state) => state.activeView);

  if (query.isPending) {
    return (
      <main {...stylex.props(styles.page)}>
        <LoadingState label="Loading event…" />
      </main>
    );
  }
  if (query.isLoadingError) {
    if (query.error.code === "EVENT_NOT_FOUND") return <NotFoundPage title="Event not found" />;
    return (
      <main {...stylex.props(styles.page)}>
        <LoadErrorState
          title="The event could not be loaded"
          reason={describeApiError(query.error)}
          onRetry={() => void query.refetch()}
        />
      </main>
    );
  }

  const view = query.data;
  const displayed = displayedBriefing(view, activeView);
  return (
    <main {...stylex.props(styles.page)}>
      <VStack gap={6}>
        <EventHeader event={view.event} />
        {query.isRefetchError ? (
          <Banner
            status="warning"
            title="Showing the last loaded data"
            description={`It could not be refreshed: ${describeApiError(query.error)}`}
          />
        ) : null}
        <PanelErrorBoundary name="Attendance">
          <AttendancePanel eventId={eventId} view={view} refetch={query.refetch} />
        </PanelErrorBoundary>
        <PanelErrorBoundary name="Feedback">
          <FeedbackPanel
            notes={view.feedback}
            newSinceBriefing={new Set(displayed?.freshness.newFeedbackIds ?? [])}
          />
        </PanelErrorBoundary>
        <PanelErrorBoundary name="Briefing">
          <BriefingPanel eventId={eventId} view={view} refetch={query.refetch} />
        </PanelErrorBoundary>
      </VStack>
    </main>
  );
}
