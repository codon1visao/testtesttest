import { GenerationIdSchema, RunIdSchema, SaveBriefingRequestSchema } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeEventApi } from "../../testing/fake-event-api";
import { FakeEventSource } from "../../testing/fake-event-source";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";
import { chooseOption } from "../../testing/selector";

let api: FakeEventApi;

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

/** A window refocus refetches the event view, as another tab's change would reach this one. */
const refocus = () => {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
};
/** A preview distinct from the default fixture: its own generation, run and Theme 1 text. */
const otherPreview = (n: number, theme: string) => {
  const base = buildBriefingView();
  return buildBriefingView({
    provenance: {
      ...base.provenance,
      generationId: GenerationIdSchema.parse(`0199a4e8-7c1a-7cc2-9d6e-00000000000${String(n)}`),
      runId: RunIdSchema.parse(`manual:other-${String(n)}`),
    },
    content: {
      ...base.content,
      themes: [{ text: theme, sourceIds: base.content.themes[0]?.sourceIds ?? [] }],
    },
  });
};

/** Disabled natively or through aria-disabled. */
const isLocked = (element: HTMLElement) =>
  (element instanceof HTMLTextAreaElement && element.disabled) ||
  element.getAttribute("aria-disabled") === "true";

const panel = async () => within(await screen.findByRole("region", { name: "Briefing" }));
const generateButton = (region: Awaited<ReturnType<typeof panel>>) =>
  region.getByRole<HTMLButtonElement>("button", {
    name: /Generate briefing|Retry|Generating briefing/,
  });

describe("briefing panel", () => {
  it("puts Generate briefing in the section header, beside the heading", async () => {
    renderApp();
    const region = await panel();
    const heading = region.getByRole("heading", { level: 2, name: "Briefing" });
    expect(heading.parentElement?.contains(generateButton(region))).toBe(true);
    // The header row holds only the heading and the button, not the rest of the panel.
    expect(heading.parentElement?.contains(region.getByText("No briefing yet"))).toBe(false);
  });

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
    expect(region.getByRole("button", { name: "Sources (8)" })).toBeTruthy();
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
    await chooseOption(user, attendance, "Chris", "Attended");
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

  it("F4 step 7: the fields are locked while the automatic select is in flight, so no draft is typed on a base it replaces", async () => {
    const second = otherPreview(4, "Second preview theme.");
    api.view = { ...api.view, selectedPreview: buildBriefingView() };
    api.generationReplies.push({ kind: "preview", preview: second });
    api.selectDelayMs = 300;
    const { user } = renderApp();
    const region = await panel();
    expect(isLocked(region.getByLabelText("Theme 1"))).toBe(false);
    await user.click(generateButton(region));
    await waitFor(() => {
      expect(api.selectRequests).toHaveLength(1);
    });
    expect(isLocked(region.getByLabelText("Theme 1"))).toBe(true);
    expect(isLocked(region.getByLabelText("Attendance overview"))).toBe(true);
    await waitFor(() => {
      expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
        "Second preview theme.",
      );
    });
    expect(isLocked(region.getByLabelText("Theme 1"))).toBe(false);
    expect(region.queryByText("New briefing ready to review")).toBeNull();
  });

  it("F4 step 7: an automatic select whose late response the view moved past unlocks the editor", async () => {
    const second = otherPreview(4, "Second preview theme.");
    const elsewhere = otherPreview(7, "Selected in another tab.");
    api.generationReplies.push({ kind: "preview", preview: second });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mswServer.use(
      http.post("/api/events/:eventId/briefing-preview/select", async () => {
        // The select lands, then another tab selects a newer preview before this response arrives.
        api.view = { ...api.view, selectedPreview: elsewhere, incomingPreview: null };
        await held;
        return HttpResponse.json({ selectedPreview: second });
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    refocus();
    expect(await region.findByText("Selected in another tab.", { exact: false })).toBeTruthy();
    release();
    await waitFor(() => {
      expect(isLocked(region.getByLabelText("Theme 1"))).toBe(false);
    });
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Selected in another tab.",
    );
  });

  it("F6-09: a preview another tab selected under a dirty draft is announced; reviewing it only switches the editor", async () => {
    const first = buildBriefingView();
    const second = otherPreview(4, "Second preview theme.");
    api.view = { ...api.view, selectedPreview: first };
    const { user } = renderApp();
    const region = await panel();
    await user.type(region.getByLabelText<HTMLTextAreaElement>("Theme 1"), " Late draft.");
    api.view = { ...api.view, selectedPreview: second, incomingPreview: null };
    refocus();
    expect(await region.findByText("New briefing ready to review")).toBeTruthy();
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Requests for more rest-break time. Late draft.",
    );

    await user.click(region.getByRole("button", { name: "Review new preview" }));
    await user.click(await screen.findByRole("button", { name: "Discard and review" }));
    await waitFor(() => {
      expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
        "Second preview theme.",
      );
    });
    // Already selected on the server: reviewing it makes no select request.
    expect(api.selectRequests).toHaveLength(0);
    expect(region.queryByText("New briefing ready to review")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Generated preview — not saved as briefing");
    });
  });

  it("F6 race 3: Review sends the selection this editor works on; a newer one from another tab is a conflict that keeps the draft", async () => {
    const first = buildBriefingView();
    const elsewhere = otherPreview(5, "Selected in another tab.");
    const incoming = otherPreview(6, "Newest preview theme.");
    api.view = { ...api.view, selectedPreview: first };
    const { user } = renderApp();
    const region = await panel();
    await user.type(region.getByLabelText<HTMLTextAreaElement>("Theme 1"), " My draft.");
    // Another tab selected a preview, and a newer one is waiting; this tab's draft keeps its base.
    api.view = { ...api.view, selectedPreview: elsewhere, incomingPreview: incoming };
    refocus();
    expect(await region.findByText("New briefing ready to review")).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Review new preview" }));
    await user.click(await screen.findByRole("button", { name: "Discard and review" }));
    await waitFor(() => {
      expect(api.selectRequests).toEqual([
        {
          generationId: incoming.provenance.generationId,
          expectedSelectedGenerationId: first.provenance.generationId,
        },
      ]);
    });
    expect(
      (await screen.findAllByText(/^The new preview was not opened: /)).length,
    ).toBeGreaterThan(0);
    expect(api.view.selectedPreview).toEqual(elsewhere);
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Requests for more rest-break time. My draft.",
    );
  });

  it("F4 step 7: a clean automatic select does not announce the preview it is opening", async () => {
    api.selectDelayMs = 300;
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    await waitFor(() => {
      expect(api.selectRequests).toHaveLength(1);
    });
    expect(region.queryByText("New briefing ready to review")).toBeNull();
    expect(
      await region.findByRole("heading", { name: "Generated preview — not saved as briefing" }),
    ).toBeTruthy();
    expect(region.queryByText("New briefing ready to review")).toBeNull();
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
    expect(await region.findByText("New automatic briefing ready to review.")).toBeTruthy();
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
    const toggle = region.getByRole("button", { name: "Sources (8)" });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(region.getByRole("button", { name: "Review new preview" }));
    expect(
      await region.findByRole("heading", { name: "Generated preview — not saved as briefing" }),
    ).toBeTruthy();
  });

  it("Plan 4 review: after saving the saved briefing while another tab selected a preview, the editor stays on the saved briefing", async () => {
    api.view = { ...api.view, savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME } };
    const { user } = renderApp();
    const region = await panel();
    await user.type(region.getByLabelText<HTMLTextAreaElement>("Theme 1"), " Edited.");
    const other = buildBriefingView({
      provenance: {
        ...buildBriefingView().provenance,
        generationId: GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000005"),
        runId: RunIdSchema.parse("manual:other-tab"),
      },
    });
    api.view = { ...api.view, selectedPreview: other };
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(0);
    });
    FakeEventSource.instances[0]?.emit("changed", '{"version":2}');
    await region.findByText(/ready to review/);
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(
      await region.findByRole("heading", { name: /^Saved briefing · last saved / }),
    ).toBeTruthy();
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Requests for more rest-break time. Edited.",
    );
  });

  it("P22: discarding the saved briefing's edits while another tab selected a preview keeps the saved briefing", async () => {
    api.view = { ...api.view, savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME } };
    const { user } = renderApp();
    const region = await panel();
    await user.type(region.getByLabelText<HTMLTextAreaElement>("Theme 1"), " Edited.");
    api.view = { ...api.view, selectedPreview: otherPreview(5, "Selected in another tab.") };
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(0);
    });
    FakeEventSource.instances[0]?.emit("changed", '{"version":2}');
    await region.findByText(/ready to review/);
    await user.click(region.getByRole("button", { name: "Discard edits" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => {
      expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
        "Requests for more rest-break time.",
      );
    });
    expect(region.getByRole("heading", { name: /^Saved briefing · last saved / })).toBeTruthy();
    // The other tab's preview is still there to switch to; the editor did not jump to it.
    expect(region.getByRole("radiogroup", { name: "Briefing to show" })).toBeTruthy();
  });

  it("shows a visible caption above the preview/saved switch", async () => {
    api.view = {
      ...api.view,
      savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME },
      selectedPreview: buildBriefingView({
        provenance: {
          ...buildBriefingView().provenance,
          generationId: GenerationIdSchema.parse("0199a4e8-7c1a-7cc2-9d6e-000000000006"),
          runId: RunIdSchema.parse("manual:sel"),
        },
      }),
    };
    renderApp();
    const caption = await (await panel()).findByText("Briefing to show");
    // The switch already has this accessible name: the visible caption is not read twice (P22).
    expect(caption.closest("[aria-hidden='true']")).not.toBeNull();
  });
});

describe("preview and saved briefing (spec 05 'saved briefing stays available', T3 §11 active view)", () => {
  const preview = buildBriefingView();
  const saved = { ...otherPreview(8, "Saved theme wording."), savedAt: FIXTURE_TIME };
  const PREVIEW_TITLE = "Generated preview — not saved as briefing";
  const switchGroup = (region: Awaited<ReturnType<typeof panel>>) =>
    region.getByRole("radiogroup", { name: "Briefing to show" });
  const option = (region: Awaited<ReturnType<typeof panel>>, name: string) =>
    within(switchGroup(region)).getByRole("radio", { name });
  const theme = (region: Awaited<ReturnType<typeof panel>>) =>
    region.getByLabelText<HTMLTextAreaElement>("Theme 1");
  const expectHeadingFocused = async (title: RegExp) => {
    await waitFor(() => {
      const active = document.activeElement;
      expect(active?.tagName).toBe("H3");
      expect(active?.isConnected).toBe(true);
      expect(active?.textContent).toMatch(title);
    });
  };

  beforeEach(() => {
    api.view = { ...api.view, selectedPreview: preview, savedBriefing: saved, briefingRevision: 1 };
  });

  it("switches the editor between the generated preview and the saved briefing", async () => {
    const { user } = renderApp();
    const region = await panel();
    expect(await region.findByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
    expect(option(region, "Generated preview").getAttribute("aria-checked")).toBe("true");
    expect(theme(region).value).toBe("Requests for more rest-break time.");
    expect(region.getByRole("button", { name: "Save and replace briefing" })).toBeTruthy();

    await user.click(option(region, "Saved briefing"));
    expect(
      await region.findByRole("heading", { name: /^Saved briefing · last saved / }),
    ).toBeTruthy();
    expect(theme(region).value).toBe("Saved theme wording.");
    expect(option(region, "Saved briefing").getAttribute("aria-checked")).toBe("true");
    await expectHeadingFocused(/^Saved briefing/);

    await user.click(option(region, "Generated preview"));
    expect(await region.findByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
    expect(theme(region).value).toBe("Requests for more rest-break time.");
    await expectHeadingFocused(/^Generated preview/);
  });

  it("F5-10: switching while dirty asks first; Cancel keeps the draft, confirming switches and focuses the heading", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.type(theme(region), " My draft.");
    await user.click(option(region, "Saved briefing"));
    expect(await screen.findByText("Discard your edits and switch?")).toBeTruthy();
    expect(
      screen.getByText(
        "Your unsaved wording will be lost. Cancel to keep editing; you can save it first.",
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(theme(region).value).toBe("Requests for more rest-break time. My draft.");
    expect(region.getByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
    expect(option(region, "Generated preview").getAttribute("aria-checked")).toBe("true");

    await user.click(option(region, "Saved briefing"));
    await user.click(await screen.findByRole("button", { name: "Discard and switch" }));
    await waitFor(() => {
      expect(theme(region).value).toBe("Saved theme wording.");
    });
    expect(region.queryByText("Unsaved changes to the briefing text.")).toBeNull();
    await expectHeadingFocused(/^Saved briefing/);
    expect(api.saveRequests).toHaveLength(0);
  });

  it("F5 API contract: editing the saved briefing while a preview exists saves it and keeps the preview", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.click(option(region, "Saved briefing"));
    await waitFor(() => {
      expect(theme(region).value).toBe("Saved theme wording.");
    });
    await user.clear(theme(region));
    await user.type(theme(region), "Edited saved wording.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    await waitFor(() => {
      expect(api.view.briefingRevision).toBe(2);
    });
    const sent = SaveBriefingRequestSchema.parse(api.saveRequests[0]);
    expect(sent.generationId).toBe(saved.provenance.generationId);
    expect(sent.baseBriefingRevision).toBe(1);
    expect(api.view.selectedPreview).toEqual(preview);
    expect(
      await region.findByRole("heading", { name: /^Saved briefing · last saved / }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(theme(region).value).toBe("Edited saved wording.");
    });
    // The preview is still there to switch back to.
    await user.click(option(region, "Generated preview"));
    expect(await region.findByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
  });

  it("T3 §11: a source opened before a save stays open after the editor remounts", async () => {
    api.view = { ...api.view, savedBriefing: null, briefingRevision: 0 };
    const { user } = renderApp();
    const region = await panel();
    const themeToggle = () => {
      const [toggle] = region.getAllByRole("button", { name: "Sources (2)" });
      if (toggle === undefined) throw new Error("theme source toggle missing");
      return toggle;
    };
    await user.click(themeToggle());
    expect(themeToggle().getAttribute("aria-expanded")).toBe("true");
    await user.type(theme(region), " Saved.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(
      await region.findByRole("heading", { name: /^Saved briefing · last saved / }),
    ).toBeTruthy();
    expect(themeToggle().getAttribute("aria-expanded")).toBe("true");
    const summaryToggle = region.getByRole("button", { name: "Sources (8)" });
    expect(summaryToggle.getAttribute("aria-expanded")).toBe("false");
  });
});
