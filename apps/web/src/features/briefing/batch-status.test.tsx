import { FeedbackIdSchema, RunIdSchema } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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

  it("F7 Failed: explains a failed batch, keeps saved work, and offers Generate briefing", async () => {
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
    const target = region.getAllByRole("button", { name: "Generate briefing" }).at(-1); // the banner's button
    if (target === undefined) throw new Error("no Generate briefing button");
    await user.click(target);
    await waitFor(() => {
      expect(api.generationRequests).toHaveLength(1);
    });
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
    expect(
      region.getByRole<HTMLButtonElement>("button", { name: "Generate briefing" }).disabled,
    ).toBe(true);
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
    await user.click(region.getByRole("button", { name: "Generate briefing" }));
    expect(await region.findByRole("button", { name: "Retry" })).toBeTruthy();
    await pushChange(); // the same incoming preview comes back
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(region.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(region.getByText("Briefing was not generated")).toBeTruthy();
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
    await user.click(region.getByRole("button", { name: "Generate briefing" }));
    expect(await region.findByRole("button", { name: "Retry" })).toBeTruthy();
    api.view = { ...api.view, incomingPreview: buildBriefingView({ trigger: "feedback_batch" }) };
    await pushChange();
    await waitFor(() => {
      expect(region.queryByRole("button", { name: "Retry" })).toBeNull();
    });
    expect(region.queryByText("Briefing was not generated")).toBeNull();
  });
});
