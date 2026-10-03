import { SubmitFeedbackRequestSchema } from "@event-desk/contracts";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;
beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

const field = () => screen.getByLabelText<HTMLTextAreaElement>("Your feedback");
const sent = () => api.feedbackRequests.map((body) => SubmitFeedbackRequestSchema.parse(body));

describe("feedback form page (F3 test channel)", () => {
  it("F3-10: submits anonymous text and thanks the writer; the next note gets a new submissionId", async () => {
    const { user } = renderApp("/events/E101/feedback");
    expect(await screen.findByRole("heading", { name: "Event feedback" })).toBeTruthy();
    expect(screen.queryByLabelText(/name|email|member/i)).toBeNull();
    await user.type(field(), "Loved the route.");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    expect(await screen.findByText("Thank you — your feedback was received.")).toBeTruthy();
    expect(field().value).toBe("");
    await user.type(field(), "And the coffee.");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await waitFor(() => {
      expect(sent()).toHaveLength(2);
    });
    expect(sent()[0]?.text).toBe("Loved the route.");
    expect(sent()[0]?.submissionId).not.toBe(sent()[1]?.submissionId);
    expect(api.view.feedback.map((note) => note.id)).toEqual(
      expect.arrayContaining(["F09", "F10"]),
    );
  });

  it("F3-12: blank text is caught before sending", async () => {
    const { user } = renderApp("/events/E101/feedback");
    await screen.findByRole("heading", { name: "Event feedback" });
    await user.type(field(), "   ");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    expect(await screen.findByText("Write some feedback before submitting.")).toBeTruthy();
    expect(api.feedbackRequests).toHaveLength(0);
  });

  it("F3-11: after a lost response the resend reuses the same submissionId and keeps the text", async () => {
    api.feedbackReplies.push("lost");
    const { user } = renderApp("/events/E101/feedback");
    await screen.findByRole("heading", { name: "Event feedback" });
    await user.type(field(), "Was this received?");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    expect(
      await screen.findByText(
        "We could not confirm your feedback was received. Submit again — it will not be duplicated.",
      ),
    ).toBeTruthy();
    expect(field().value).toBe("Was this received?");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await waitFor(() => {
      expect(sent()).toHaveLength(2);
    });
    expect(sent()[1]?.submissionId).toBe(sent()[0]?.submissionId);
  });

  it("F3 (P19): an edit after an unconfirmed send is a new submission, never dropped", async () => {
    api.feedbackReplies.push("lost");
    const { user } = renderApp("/events/E101/feedback");
    await screen.findByRole("heading", { name: "Event feedback" });
    await user.type(field(), "Was this received?");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await screen.findByText(
      "We could not confirm your feedback was received. Submit again — it will not be duplicated.",
    );
    await user.type(field(), " Also: more shade.");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await waitFor(() => {
      expect(sent()).toHaveLength(2);
    });
    expect(sent()[1]?.text).toBe("Was this received? Also: more shade.");
    expect(sent()[1]?.submissionId).not.toBe(sent()[0]?.submissionId);
  });

  it("F3 (P19): an edit after a failed send is a new submission; unchanged text keeps its ID", async () => {
    api.feedbackReplies.push(
      { status: 503, code: "STORE_UNAVAILABLE", message: "Try again." },
      { status: 503, code: "STORE_UNAVAILABLE", message: "Try again." },
    );
    const { user } = renderApp("/events/E101/feedback");
    await screen.findByRole("heading", { name: "Event feedback" });
    await user.type(field(), "First.");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await screen.findByText("Feedback was not submitted");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await waitFor(() => {
      expect(sent()).toHaveLength(2);
    });
    await user.type(field(), " Edited.");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await waitFor(() => {
      expect(sent()).toHaveLength(3);
    });
    expect(sent()[1]?.submissionId).toBe(sent()[0]?.submissionId);
    expect(sent()[2]?.submissionId).not.toBe(sent()[1]?.submissionId);
    expect(sent()[2]?.text).toBe("First. Edited.");
  });

  it("P20: keyboard focus returns to the text area once a send settles", async () => {
    api.feedbackReplies.push("lost");
    const { user } = renderApp("/events/E101/feedback");
    await screen.findByRole("heading", { name: "Event feedback" });
    await user.type(field(), "Focus check.");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await screen.findByText(
      "We could not confirm your feedback was received. Submit again — it will not be duplicated.",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    await screen.findByText("Thank you — your feedback was received.");
    await waitFor(() => {
      expect(document.activeElement).toBe(field());
    });
  });

  it("P21: an unknown event answers with the not-found page", async () => {
    api.feedbackReplies.push({
      status: 404,
      code: "EVENT_NOT_FOUND",
      message: "Event E999 was not found.",
    });
    const { user } = renderApp("/events/E999/feedback");
    await screen.findByRole("heading", { name: "Event feedback" });
    await user.type(field(), "Hello?");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    expect(await screen.findByRole("heading", { name: "Event not found" })).toBeTruthy();
  });

  it("F3-13: the limit error is shown and the text kept", async () => {
    api.feedbackReplies.push({
      status: 422,
      code: "FEEDBACK_LIMIT_REACHED",
      message: "This event already has the maximum of 100 feedback notes.",
    });
    const { user } = renderApp("/events/E101/feedback");
    await screen.findByRole("heading", { name: "Event feedback" });
    await user.type(field(), "One too many.");
    await user.click(screen.getByRole("button", { name: "Submit feedback" }));
    expect(
      await screen.findByText("This event already has the maximum of 100 feedback notes."),
    ).toBeTruthy();
    expect(field().value).toBe("One too many.");
  });
});
