import { GenerationIdSchema, RunIdSchema } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

const panel = async () => within(await screen.findByRole("region", { name: "Briefing" }));
const generateButton = (region: Awaited<ReturnType<typeof panel>>) =>
  region.getByRole<HTMLButtonElement>("button", {
    name: /Generate briefing|Retry|Generating briefing/,
  });

describe("briefing panel", () => {
  it("shows the empty state before any briefing exists", async () => {
    renderApp();
    const region = await panel();
    expect(region.getByText("No briefing yet")).toBeTruthy();
    expect(
      region.getByText("Press Generate briefing to create one from the saved records."),
    ).toBeTruthy();
  });

  it("F4-01 / F4 step 7: generates from the saved baseline and opens the clean editor on the new preview", async () => {
    api.generationReplies.push({ kind: "preview", delayMs: 150 });
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    expect(
      await region.findByText("Generating briefing… This can take up to a minute."),
    ).toBeTruthy();
    expect(generateButton(region).getAttribute("aria-disabled")).toBe("true");

    expect(
      await region.findByRole("heading", { name: "Generated preview — not saved as briefing" }),
    ).toBeTruthy();
    // The four questions of the brief (docs/specs/README.md).
    for (const question of [
      "What happened",
      "Which themes recur",
      "Where people disagree",
      "What might be worth following up",
    ]) {
      expect(region.getByRole("heading", { name: question })).toBeTruthy();
    }
    expect(
      region.getByText(
        "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      ),
    ).toBeTruthy();
    expect(region.getByText(/Requests for more rest-break time\./)).toBeTruthy();
    expect(region.getAllByRole("button", { name: "Read source F05" }).length).toBeGreaterThan(0);
    expect(region.getByText(/fixture-model · requested by you/)).toBeTruthy();
    expect(api.generationRequests).toEqual([{ baseAttendanceRevision: 0 }]);
    expect((await screen.findAllByText("Briefing generated")).length).toBeGreaterThan(0);
    expect(api.selectRequests).toEqual([
      {
        generationId: buildBriefingView().provenance.generationId,
        expectedSelectedGenerationId: null,
      },
    ]);
    expect(region.queryByText("New briefing ready to review")).toBeNull();
  });

  it("keeps keyboard focus on the button while generating and ignores a second activation", async () => {
    api.generationReplies.push({ kind: "preview", delayMs: 300 });
    const { user } = renderApp();
    const region = await panel();
    const button = generateButton(region);
    button.focus();
    await user.keyboard("{Enter}");
    expect(
      await region.findByText("Generating briefing… This can take up to a minute."),
    ).toBeTruthy();
    expect(document.activeElement).toBe(generateButton(region));
    // Natively disabled buttons lose focus in browsers (jsdom keeps it): busy must use aria-disabled.
    expect(generateButton(region).disabled).toBe(false);
    expect(generateButton(region).getAttribute("aria-disabled")).toBe("true");

    await user.keyboard("{Enter}");
    await user.click(generateButton(region));
    expect(
      await region.findByRole("heading", { name: "Generated preview — not saved as briefing" }),
    ).toBeTruthy();
    expect(api.generationRequests).toHaveLength(1);
    expect(document.activeElement).toBe(generateButton(region));
  });

  it("F4 step 1: is disabled while attendance has unsaved changes, and says why", async () => {
    const { user } = renderApp();
    const attendance = within(await screen.findByRole("region", { name: "Attendance" }));
    await user.selectOptions(attendance.getByRole("combobox", { name: "Chris" }), "attended");
    const region = await panel();
    expect(generateButton(region).disabled).toBe(true);
    expect(
      region.getByText("Save or discard your attendance changes before generating."),
    ).toBeTruthy();
  });

  it("F4-06: explains a failure and retries straight away when the outcome is known", async () => {
    api.generationReplies.push({
      kind: "error",
      status: 503,
      code: "GATEWAY_UNAVAILABLE",
      message: "The AI service is not reachable. Your saved work is unchanged; try again shortly.",
    });
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    expect(
      await region.findByText(
        "The AI service is not reachable. Your saved work is unchanged; try again shortly.",
      ),
    ).toBeTruthy();
    expect(region.getByText("Briefing was not generated")).toBeTruthy();
    expect(region.queryByText("Could not confirm the generation")).toBeNull();
    await user.click(region.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(api.generationRequests).toHaveLength(2);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Review Focus 5: Retry after an unknown outcome asks first, because it may be charged again", async () => {
    api.generationReplies.push({
      kind: "error",
      status: 504,
      code: "AI_OUTCOME_UNKNOWN",
      message:
        "The AI service did not confirm the result (the connection was lost or no answer arrived in time); the attempt may have been charged. Your saved work is unchanged.",
    });
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    await user.click(await region.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Generate again?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.generationRequests).toHaveLength(1);

    await user.click(region.getByRole("button", { name: "Retry" }));
    await user.click(await screen.findByRole("button", { name: "Generate again" }));
    await waitFor(() => {
      expect(api.generationRequests).toHaveLength(2);
    });
  });

  it("F8: Retry after a DEADLINE_EXCEEDED 504 asks first too", async () => {
    api.generationReplies.push({
      kind: "error",
      status: 504,
      code: "DEADLINE_EXCEEDED",
      message:
        "The AI model did not finish in time; the attempt may have been charged. Your saved work is unchanged.",
    });
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    await user.click(await region.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Generate again?")).toBeTruthy();
    expect(api.generationRequests).toHaveLength(1);
  });

  it("titles a lost response as unconfirmed, not as a failure", async () => {
    mswServer.use(
      http.post("/api/events/:eventId/briefing-generations", () => HttpResponse.error()),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    expect(await region.findByText("Could not confirm the generation")).toBeTruthy();
    expect(region.queryByText("Briefing was not generated")).toBeNull();
    await user.click(region.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Generate again?")).toBeTruthy();
  });

  it("shows a generation running in another tab and blocks a second one", async () => {
    api.view = {
      ...api.view,
      generation: {
        ...api.view.generation,
        manual: {
          runId: RunIdSchema.parse("manual:other-tab"),
          startedAt: "2026-10-04T10:00:00.000Z",
        },
      },
    };
    const { user } = renderApp();
    const region = await panel();
    expect(await region.findByText("A briefing is being generated in another tab…")).toBeTruthy();
    expect(generateButton(region).getAttribute("aria-disabled")).toBe("true");
    await user.click(generateButton(region));
    expect(api.generationRequests).toHaveLength(0);
  });

  it("S1-03: renders model text inertly and says when no themes were found", async () => {
    const preview = buildBriefingView();
    api.view = {
      ...api.view,
      incomingPreview: {
        ...preview,
        content: {
          ...preview.content,
          themes: [],
          suggestions: [
            {
              text: '<img src=x onerror="alert(1)"> **Check** the route.',
              sourceIds: preview.content.suggestions[1]?.sourceIds ?? [],
            },
          ],
        },
      },
    };
    renderApp();
    const region = await panel();
    expect(await region.findByText("No recurring themes identified.")).toBeTruthy();
    expect(
      region.getByText(/<img src=x onerror="alert\(1\)"> \*\*Check\*\* the route\./),
    ).toBeTruthy();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("Review Focus 3 / F6-09 / F5-14: a new preview never replaces a dirty editor", async () => {
    const first = buildBriefingView();
    const second = buildBriefingView({
      provenance: {
        ...first.provenance,
        generationId: GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000002"),
        runId: RunIdSchema.parse("manual:second"),
      },
      content: {
        ...first.content,
        themes: [
          { text: "Second preview theme.", sourceIds: first.content.themes[0]?.sourceIds ?? [] },
        ],
      },
    });
    api.view = { ...api.view, selectedPreview: first };
    api.generationReplies.push({ kind: "preview", preview: second });
    const { user } = renderApp();
    const region = await panel();
    const theme = region.getByLabelText<HTMLTextAreaElement>("Theme 1");
    await user.type(theme, " My draft.");
    await user.click(generateButton(region));

    expect(await region.findByText("New briefing ready to review")).toBeTruthy();
    expect(api.selectRequests).toHaveLength(0);
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Requests for more rest-break time. My draft.",
    );

    await user.click(region.getByRole("button", { name: "Review new preview" }));
    expect(await screen.findByText("Discard your edits and review the new preview?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Requests for more rest-break time. My draft.",
    );

    await user.click(region.getByRole("button", { name: "Review new preview" }));
    await user.click(await screen.findByRole("button", { name: "Discard and review" }));
    await waitFor(() => {
      expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
        "Second preview theme.",
      );
    });
    expect(api.selectRequests).toEqual([
      {
        generationId: second.provenance.generationId,
        expectedSelectedGenerationId: first.provenance.generationId,
      },
    ]);
    expect(region.queryByText("New briefing ready to review")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Generated preview — not saved as briefing");
    });
  });

  it("F4 step 7: text typed while the automatic select is in flight is never replaced", async () => {
    const first = buildBriefingView();
    const second = buildBriefingView({
      provenance: {
        ...first.provenance,
        generationId: GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000004"),
        runId: RunIdSchema.parse("manual:late-typing"),
      },
      content: {
        ...first.content,
        themes: [
          { text: "Second preview theme.", sourceIds: first.content.themes[0]?.sourceIds ?? [] },
        ],
      },
    });
    api.view = { ...api.view, selectedPreview: first };
    api.generationReplies.push({ kind: "preview", preview: second });
    api.selectDelayMs = 300;
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    await waitFor(() => {
      expect(api.selectRequests).toHaveLength(1);
    });
    await user.type(region.getByLabelText<HTMLTextAreaElement>("Theme 1"), " Late draft.");
    await waitFor(() => {
      expect(api.view.selectedPreview?.provenance.generationId).toBe(
        second.provenance.generationId,
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Requests for more rest-break time. Late draft.",
    );
  });

  it("F7: a result from elsewhere is offered, not opened, and the saved briefing stays in the editor", async () => {
    api.view = {
      ...api.view,
      savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME },
      incomingPreview: buildBriefingView({
        trigger: "feedback_batch",
        provenance: {
          ...buildBriefingView().provenance,
          generationId: GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000003"),
          runId: RunIdSchema.parse("batch:1"),
        },
      }),
    };
    renderApp();
    const region = await panel();
    expect(await region.findByText("New briefing ready to review")).toBeTruthy();
    expect(region.getByRole("heading", { name: /^Saved briefing · last saved / })).toBeTruthy();
    expect(api.selectRequests).toHaveLength(0);
  });

  it("shows an unreviewed incoming preview read-only, with sources and no per-question landmarks", async () => {
    api.view = { ...api.view, incomingPreview: buildBriefingView() };
    const { user } = renderApp();
    const region = await panel();
    expect(
      await region.findByRole("heading", { name: "New preview (not yet reviewed)" }),
    ).toBeTruthy();
    expect(region.queryAllByRole("textbox")).toHaveLength(0);
    expect(region.queryAllByRole("region")).toHaveLength(0);
    expect(region.getByText(/References identify the source notes/)).toBeTruthy();
    const [toggle] = region.getAllByRole("button", { name: "Read source F05" });
    if (toggle === undefined) throw new Error("source toggle missing");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(region.getByRole("button", { name: "Review new preview" }));
    expect(
      await region.findByRole("heading", { name: "Generated preview — not saved as briefing" }),
    ).toBeTruthy();
  });
});
