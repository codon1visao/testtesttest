import { FeedbackIdSchema, GenerationIdSchema, RunIdSchema } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { startEditing } from "../../testing/briefing-queries";
import { FakeEventApi } from "../../testing/fake-event-api";
import { FakeEventSource } from "../../testing/fake-event-source";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;
beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
  window.sessionStorage.clear();
});
const panel = async () => within(await screen.findByRole("region", { name: "Briefing" }));
const pushChange = async () => {
  await waitFor(() => {
    expect(FakeEventSource.instances.length).toBeGreaterThan(0);
  });
  FakeEventSource.instances[0]?.emit("changed", '{"version":1}');
};
/** Astryx's live region is document-wide and outlives a test, so it is not evidence of this test's toast. */
const toastsWithText = (text: string) => {
  const briefing = screen.queryByRole("region", { name: "Briefing" });
  return screen
    .queryAllByText(text)
    .filter((el) => !el.hasAttribute("data-astryx-live-region") && briefing?.contains(el) !== true);
};
const batchPreview = (n: number) =>
  buildBriefingView({
    trigger: "feedback_batch",
    provenance: {
      ...buildBriefingView().provenance,
      generationId: GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-00000000000${String(n)}`),
    },
  });
/** A change any later read carries: once it shows, that read has been rendered. */
const addNote = (text: string) => {
  api.view = {
    ...api.view,
    feedback: [
      ...api.view.feedback,
      {
        id: FeedbackIdSchema.parse(`F${String(api.view.feedback.length + 50)}`),
        text,
        receivedAt: FIXTURE_TIME,
      },
    ],
  };
};
const feedbackShows = async (text: string) => {
  expect(
    await within(screen.getByRole("region", { name: "Feedback" })).findByText(text),
  ).toBeTruthy();
};
const generation = (overrides: Partial<typeof api.view.generation>) => ({
  ...api.view.generation,
  ...overrides,
});

describe("batch status (F7 'Generation state in the UI')", () => {
  it("shows a collecting window with its note count", async () => {
    api.view = {
      ...api.view,
      generation: generation({
        batch: {
          state: "collecting",
          jobId: RunIdSchema.parse("batch_a"),
          closesAt: "2026-10-04T14:02:03.000Z",
          maxAttempts: 3,
          newNoteIds: [FeedbackIdSchema.parse("F09"), FeedbackIdSchema.parse("F10")],
        },
      }),
    };
    renderApp();
    expect(
      await (
        await panel()
      ).findByText(/^New feedback received \(2 notes\)\. Preparing an automatic briefing at /),
    ).toBeTruthy();
  });

  it("M3/P12: shows nothing for a collecting window whose notes a previous job captured", async () => {
    api.view = {
      ...api.view,
      generation: generation({
        batch: {
          state: "collecting",
          jobId: RunIdSchema.parse("batch_a"),
          closesAt: "2026-10-04T14:02:03.000Z",
          maxAttempts: 3,
          newNoteIds: [],
        },
      }),
    };
    renderApp();
    const region = await panel();
    await region.findByRole("button", { name: "Generate" });
    expect(region.queryByText(/New feedback received/)).toBeNull();
  });

  it("F7 Failed: explains a failed batch, keeps saved work, and offers Generate now", async () => {
    api.view = {
      ...api.view,
      generation: generation({
        lastOutcome: {
          runId: RunIdSchema.parse("batch_a"),
          trigger: "feedback_batch",
          status: "failed",
          code: "GATEWAY_UNAVAILABLE",
          finishedAt: FIXTURE_TIME,
        },
      }),
    };
    const { user } = renderApp();
    const region = await panel();
    expect(
      await region.findByText(
        "Automatic briefing failed: AI service unavailable. Your saved briefing is unchanged.",
      ),
    ).toBeTruthy();
    // The banner's own button, named apart from the header's Generate.
    await user.click(region.getByRole("button", { name: "Generate now" }));
    await waitFor(() => {
      expect(api.generationRequests).toHaveLength(1);
    });
  });

  it("Generate now is unavailable while a generated preview is shown, and back on the saved briefing", async () => {
    api.view = {
      ...api.view,
      selectedPreview: buildBriefingView(),
      savedBriefing: { ...batchPreview(7), savedAt: FIXTURE_TIME },
      briefingRevision: 1,
      generation: generation({
        lastOutcome: {
          runId: RunIdSchema.parse("batch_a"),
          trigger: "feedback_batch",
          status: "failed",
          code: "GATEWAY_UNAVAILABLE",
          finishedAt: FIXTURE_TIME,
        },
      }),
    };
    const { user } = renderApp();
    const region = await panel();
    const generateNow = () =>
      region.getByRole<HTMLButtonElement>("button", { name: "Generate now" });
    expect(
      (await region.findByRole<HTMLButtonElement>("button", { name: "Generate now" })).disabled,
    ).toBe(true);
    await user.click(generateNow());
    expect(api.generationRequests).toHaveLength(0);
    await user.click(
      within(region.getByRole("radiogroup", { name: "Briefing to show" })).getByRole("radio", {
        name: "Saved briefing",
      }),
    );
    await waitFor(() => {
      expect(generateNow().disabled).toBe(false);
    });
  });

  it("F6: Generate now is unavailable while the briefing is being edited", async () => {
    api.view = {
      ...api.view,
      savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME },
      briefingRevision: 1,
      generation: generation({
        lastOutcome: {
          runId: RunIdSchema.parse("batch_a"),
          trigger: "feedback_batch",
          status: "failed",
          code: "GATEWAY_UNAVAILABLE",
          finishedAt: FIXTURE_TIME,
        },
      }),
    };
    const { user } = renderApp();
    const region = await panel();
    const generateNow = () =>
      region.getByRole<HTMLButtonElement>("button", { name: "Generate now" });
    expect(generateNow().disabled).toBe(false);
    await startEditing(user, region);
    expect(generateNow().disabled).toBe(true);
    await user.click(generateNow());
    expect(api.generationRequests).toHaveLength(0);
    await user.click(region.getByRole("button", { name: "Cancel" }));
    expect(generateNow().disabled).toBe(false);
  });

  it("F8: during a provider cooldown Generate waits and says until when", async () => {
    api.view = {
      ...api.view,
      generation: generation({ cooldownUntil: new Date(Date.now() + 60_000).toISOString() }),
    };
    renderApp();
    const region = await panel();
    expect(
      await region.findByText(
        /^The AI provider is limiting requests\. Generate is available again at /,
      ),
    ).toBeTruthy();
    expect(region.getByRole<HTMLButtonElement>("button", { name: "Generate" }).disabled).toBe(true);
  });

  it("F7-14: an automatic result is announced once as ready, by its own title", async () => {
    renderApp();
    await panel();
    api.view = {
      ...api.view,
      incomingPreview: buildBriefingView({ trigger: "feedback_batch" }),
      generation: generation({
        lastOutcome: {
          runId: RunIdSchema.parse("batch_b"),
          trigger: "feedback_batch",
          status: "succeeded",
          finishedAt: FIXTURE_TIME,
        },
      }),
    };
    await pushChange();
    expect(await screen.findAllByText("New automatic briefing ready to review.")).not.toHaveLength(
      0,
    );
  });

  it("announces an automatic result that arrives while open, but not the one present on load", async () => {
    api.view = {
      ...api.view,
      generation: generation({
        lastOutcome: {
          runId: RunIdSchema.parse("batch_c"),
          trigger: "feedback_batch",
          status: "succeeded",
          finishedAt: FIXTURE_TIME,
        },
      }),
    };
    renderApp();
    await panel();
    expect(toastsWithText("New automatic briefing ready to review.")).toHaveLength(0);
    api.view = {
      ...api.view,
      generation: generation({
        lastOutcome: {
          runId: RunIdSchema.parse("batch_d"),
          trigger: "feedback_batch",
          status: "succeeded",
          finishedAt: FIXTURE_TIME,
        },
      }),
    };
    await pushChange(); // no incoming preview here: only the announcement can show the text
    await waitFor(() => {
      expect(toastsWithText("New automatic briefing ready to review.")).not.toHaveLength(0);
    });
  });

  it("announces a failed automatic run that finishes while open", async () => {
    renderApp();
    await panel();
    api.view = {
      ...api.view,
      generation: generation({
        lastOutcome: {
          runId: RunIdSchema.parse("batch_e"),
          trigger: "feedback_batch",
          status: "failed",
          code: "DAILY_LIMIT_REACHED",
          finishedAt: FIXTURE_TIME,
        },
      }),
    };
    await pushChange();
    const text =
      "Automatic briefing failed: today's automatic generation limit is reached. Your saved briefing is unchanged.";
    // The banner shows it inside the panel; the toast adds it outside.
    await waitFor(() => {
      expect(toastsWithText(text)).not.toHaveLength(0);
    });
  });

  it("keeps the Retry banner while the incoming preview it failed beside is unchanged", async () => {
    api.view = { ...api.view, incomingPreview: buildBriefingView({ trigger: "feedback_batch" }) };
    api.generationReplies.push({
      kind: "error",
      status: 503,
      code: "GATEWAY_UNAVAILABLE",
      message: "The AI service is not reachable.",
    });
    const { user } = renderApp();
    const region = await panel();
    await user.click(region.getByRole("button", { name: "Generate" }));
    expect(await region.findByRole("button", { name: "Retry" })).toBeTruthy();
    addNote("Read after the failure.");
    await pushChange(); // the same incoming preview comes back
    await feedbackShows("Read after the failure.");
    expect(region.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(region.getByText("Briefing was not generated")).toBeTruthy();
  });

  it("keeps a failure that lands after a batch preview arrived mid-call, and clears it on a later preview", async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<undefined>();
    api.generationReplies.push({
      kind: "error",
      status: 503,
      code: "GATEWAY_UNAVAILABLE",
      message: "The AI service is not reachable.",
      gate,
    });
    const { user } = renderApp();
    const region = await panel();
    await user.click(region.getByRole("button", { name: "Generate" }));
    await waitFor(() => {
      expect(api.generationRequests).toHaveLength(1);
    });
    api.view = { ...api.view, incomingPreview: batchPreview(3) };
    addNote("Read while generating.");
    await pushChange(); // a batch committed while the manual call is in flight
    await feedbackShows("Read while generating.");
    release(undefined);
    expect(await region.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(region.getByText("Briefing was not generated")).toBeTruthy();

    api.view = { ...api.view, incomingPreview: batchPreview(4) };
    await pushChange();
    await waitFor(() => {
      expect(region.queryByRole("button", { name: "Retry" })).toBeNull();
    });
    expect(region.queryByText("Briefing was not generated")).toBeNull();
  });

  it("Plan 3B carry-forward: a stale Retry banner clears when a new incoming preview arrives", async () => {
    api.generationReplies.push({
      kind: "error",
      status: 503,
      code: "GATEWAY_UNAVAILABLE",
      message: "The AI service is not reachable.",
    });
    const { user } = renderApp();
    const region = await panel();
    await user.click(region.getByRole("button", { name: "Generate" }));
    expect(await region.findByRole("button", { name: "Retry" })).toBeTruthy();
    api.view = { ...api.view, incomingPreview: buildBriefingView({ trigger: "feedback_batch" }) };
    await pushChange();
    await waitFor(() => {
      expect(region.queryByRole("button", { name: "Retry" })).toBeNull();
    });
    expect(region.queryByText("Briefing was not generated")).toBeNull();
  });
});
