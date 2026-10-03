import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { type EventId, EventIdSchema } from "@event-desk/contracts";
import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import { ApiError, describeApiError } from "../../data/http/api-error";
import { useSubmitFeedback } from "../../data/mutations/use-submit-feedback";
import { NotFoundPage } from "../../shared/ui/not-found-page";
import {
  DRAFT_PROBLEM_TEXT,
  type FeedbackDraftProblem,
  feedbackDraftProblem,
} from "./feedback-form-model";

const styles = stylex.create({ page: { maxWidth: 640, marginInline: "auto", padding: "1.5rem" } });

type Notice = { kind: "sent" } | { kind: "unconfirmed" } | { kind: "failed"; message: string };

export function FeedbackFormPage() {
  const { eventId = "" } = useParams();
  const parsed = EventIdSchema.safeParse(eventId);
  if (!parsed.success) return <NotFoundPage title="Event not found" />;
  return <FeedbackForm eventId={parsed.data} />;
}

/** A send that was not confirmed as stored: resending the same text must reuse its ID (F3-11). */
interface UnsettledAttempt {
  submissionId: string;
  text: string;
}

function FeedbackForm({ eventId }: { eventId: EventId }) {
  const submit = useSubmitFeedback(eventId);
  const [text, setText] = useState("");
  const [lastAttempt, setLastAttempt] = useState<UnsettledAttempt | null>(null);
  const [problem, setProblem] = useState<FeedbackDraftProblem>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [eventMissing, setEventMissing] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    if (submit.isPending) return;
    const found = feedbackDraftProblem(text);
    setProblem(found);
    if (found !== null) return;
    setNotice(null);
    // The ID is reused only for the very text it was sent with: an edited note is a new
    // submission, which the server would otherwise answer with the earlier note and drop.
    const submissionId =
      lastAttempt !== null && lastAttempt.text === text
        ? lastAttempt.submissionId
        : crypto.randomUUID();
    submit.mutate(
      { submissionId, text },
      {
        onSuccess: () => {
          setText("");
          setLastAttempt(null);
          setNotice({ kind: "sent" });
        },
        onError: (error) => {
          setLastAttempt({ submissionId, text });
          if (error instanceof ApiError && error.code === "EVENT_NOT_FOUND") {
            setEventMissing(true);
            return;
          }
          setNotice(
            error instanceof ApiError && error.outcomeUnknown
              ? { kind: "unconfirmed" }
              : { kind: "failed", message: describeApiError(error) },
          );
        },
        // The submit button was disabled while sending: keep keyboard focus off <body> (P20).
        onSettled: () => {
          field.current?.focus();
        },
      },
    );
  };

  if (eventMissing) return <NotFoundPage title="Event not found" />;

  return (
    <main {...stylex.props(styles.page)}>
      <VStack gap={4}>
        <Heading level={1}>Event feedback</Heading>
        <Text>Your feedback is anonymous: it is not linked to your name or to attendance.</Text>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <VStack gap={3}>
            <TextArea
              ref={field}
              label="Your feedback"
              description="Up to 1,000 characters."
              value={text}
              rows={6}
              // Read-only, not disabled, while sending: it stays focusable for the return of focus.
              isReadOnly={submit.isPending}
              onChange={(value) => {
                setText(value);
                if (problem !== null) setProblem(null);
              }}
              {...(problem === null
                ? {}
                : { status: { type: "error" as const, message: DRAFT_PROBLEM_TEXT[problem] } })}
            />
            {notice?.kind === "sent" ? (
              <Banner status="success" title="Thank you — your feedback was received." />
            ) : null}
            {notice?.kind === "unconfirmed" ? (
              <Banner
                status="warning"
                title="We could not confirm your feedback was received. Submit again — it will not be duplicated."
              />
            ) : null}
            {notice?.kind === "failed" ? (
              <Banner
                status="error"
                title="Feedback was not submitted"
                description={notice.message}
              />
            ) : null}
            <div>
              <Button
                type="submit"
                variant="primary"
                label="Submit feedback"
                isLoading={submit.isPending}
                isDisabled={submit.isPending}
              />
            </div>
          </VStack>
        </form>
      </VStack>
    </main>
  );
}
