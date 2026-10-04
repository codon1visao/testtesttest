import { GenerationIdSchema, RunIdSchema, SaveBriefingRequestSchema } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmDialog,
  disclosedBy,
  expectReadItem,
  sectionItem,
  startEditing,
} from "../../testing/briefing-queries";
import { FakeEventApi } from "../../testing/fake-event-api";
import { FakeEventSource } from "../../testing/fake-event-source";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";
import { chooseOption } from "../../testing/selector";
import { EVIDENCE_NOTE } from "../feedback/source-disclosure";

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
  (element instanceof HTMLButtonElement && element.disabled) ||
  element.getAttribute("aria-disabled") === "true";

const panel = async () => within(await screen.findByRole("region", { name: "Briefing" }));
const generateButton = (region: Awaited<ReturnType<typeof panel>>) =>
  region.getByRole<HTMLButtonElement>("button", { name: /^(Generate|Retry|Generating…)$/ });
const queryGenerate = (region: Awaited<ReturnType<typeof panel>>) =>
  region.queryByRole("button", { name: /^(Generate|Retry|Generating…)$/ });

describe("briefing panel", () => {
  it("puts Generate in the section header, beside the heading", async () => {
    renderApp();
    const region = await panel();
    const heading = region.getByRole("heading", { level: 2, name: "Briefing" });
    expect(heading.parentElement?.contains(generateButton(region))).toBe(true);
    // The header row holds only the heading and its actions, not the rest of the panel.
    expect(heading.parentElement?.contains(region.getByText("No briefing yet"))).toBe(false);
  });

  it("shows the empty state before any briefing exists", async () => {
    renderApp();
    const region = await panel();
    expect(region.getByText("No briefing yet")).toBeTruthy();
    expect(region.getByText("Press Generate to create one from the saved records.")).toBeTruthy();
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
    // The four questions of the brief (docs/specs/README.md), under short section names.
    for (const question of ["Summary", "Themes", "Disagreements", "Suggestions for you"]) {
      expect(region.getByRole("heading", { name: question })).toBeTruthy();
    }
    expect(region.getByText(/Requests for more rest-break time\./)).toBeTruthy();
    // Each item row opens its sources; the summary shows none (spec 03, amended 2026-10-04).
    expect(
      within(sectionItem(region, "Themes")).getByRole("button", {
        name: "Requests for more rest-break time.",
      }),
    ).toBeTruthy();
    expect(region.queryByRole("button", { name: /^Sources/ })).toBeNull();
    // Spec 05 (amended 2026-10-04): neither the overview nor the provenance line is shown.
    expect(
      region.queryByText(
        "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      ),
    ).toBeNull();
    expect(region.queryByText(/fixture-model/)).toBeNull();
    expect(region.getByText("Unsaved preview")).toBeTruthy();
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
    // The opened preview offers Accept preview instead of Generate (amended 2026-10-04): the
    // button that had focus is gone, so focus moves to the new editor's heading, never <body>.
    expect(queryGenerate(region)).toBeNull();
    await waitFor(() => {
      expect(document.activeElement?.tagName).toBe("H3");
    });
    expect(document.activeElement?.textContent).toBe("Generated preview — not saved as briefing");
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
    await user.click(attendance.getByRole("button", { name: "Discard" }));
    expect(generateButton(region).disabled).toBe(false);
    expect(
      region.queryByText("Save or discard your attendance changes before generating."),
    ).toBeNull();
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
    await user.click((await confirmDialog()).getByRole("button", { name: "Cancel" }));
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

  it("header actions: Edit then Generate in the read view; Cancel then Save while editing, without Generate", async () => {
    // The saved briefing: a generated preview offers Accept preview instead (tested below).
    api.view = {
      ...api.view,
      savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME },
      briefingRevision: 1,
    };
    const { user } = renderApp();
    const region = await panel();
    const heading = region.getByRole("heading", { level: 2, name: "Briefing" });
    const header = heading.parentElement;
    const edit = await region.findByRole("button", { name: "Edit" });
    expect(header?.contains(edit)).toBe(true);
    expect(
      edit.compareDocumentPosition(generateButton(region)) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Saving happens only from the edit view.
    expect(region.queryByRole("button", { name: "Save" })).toBeNull();

    await startEditing(user, region);
    expect(queryGenerate(region)).toBeNull();
    const cancel = region.getByRole("button", { name: "Cancel" });
    const save = region.getByRole("button", { name: "Save" });
    expect(header?.contains(cancel) && header.contains(save)).toBe(true);
    expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(region.queryByRole("button", { name: "Edit" })).toBeNull();

    await user.click(cancel);
    expect(generateButton(region)).toBeTruthy();
    expect(region.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(region.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("Review Focus 3 / F6-09 / F5-14: Generate is not offered while editing, and a new preview never replaces a dirty editor", async () => {
    const first = buildBriefingView();
    const second = otherPreview(2, "Second preview theme.");
    api.view = { ...api.view, selectedPreview: first };
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    const theme = region.getByLabelText<HTMLTextAreaElement>("Theme 1");
    await user.type(theme, " My draft.");
    // Save or cancel first: nothing can be generated on top of an open editor from this tab.
    expect(queryGenerate(region)).toBeNull();

    // A result from elsewhere (another tab, or an automatic batch) arrives under the dirty draft.
    api.view = { ...api.view, incomingPreview: second };
    refocus();
    expect(await region.findByText("New briefing ready to review")).toBeTruthy();
    expect(api.selectRequests).toHaveLength(0);
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Requests for more rest-break time. My draft.",
    );

    await user.click(region.getByRole("button", { name: "Review new preview" }));
    expect(await screen.findByText("Discard your edits and review the new preview?")).toBeTruthy();
    await user.click((await confirmDialog()).getByRole("button", { name: "Cancel" }));
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Requests for more rest-break time. My draft.",
    );

    await user.click(region.getByRole("button", { name: "Review new preview" }));
    await user.click(await screen.findByRole("button", { name: "Discard and review" }));
    await waitFor(() => {
      expectReadItem(region, "Themes", "Second preview theme.");
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

  it("F4 step 7: Edit is locked while the automatic select is in flight, then the editor shows the new preview", async () => {
    const second = otherPreview(4, "Second preview theme.");
    // Generated from the saved briefing's read view: Generate is not offered over a shown preview.
    api.view = {
      ...api.view,
      savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME },
      briefingRevision: 1,
    };
    api.generationReplies.push({ kind: "preview", preview: second });
    api.selectDelayMs = 300;
    const { user } = renderApp();
    const region = await panel();
    expect(isLocked(region.getByRole("button", { name: "Edit" }))).toBe(false);
    await user.click(generateButton(region));
    await waitFor(() => {
      expect(api.selectRequests).toHaveLength(1);
    });
    expect(isLocked(region.getByRole("button", { name: "Edit" }))).toBe(true);
    await waitFor(() => {
      expectReadItem(region, "Themes", "Second preview theme.");
    });
    expect(isLocked(region.getByRole("button", { name: "Edit" }))).toBe(false);
    expect(region.queryByText("New briefing ready to review")).toBeNull();
  });

  it("F4 step 7: an editor opened while generating is locked during the automatic select, then shows the new preview", async () => {
    const second = otherPreview(4, "Second preview theme.");
    // Generated from the saved briefing's read view: Generate is not offered over a shown preview.
    api.view = {
      ...api.view,
      savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME },
      briefingRevision: 1,
    };
    api.generationReplies.push({ kind: "preview", preview: second, delayMs: 150 });
    api.selectDelayMs = 300;
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    // Edit stays available while the generation runs; the clean editor still follows the result.
    await startEditing(user, region);
    expect(isLocked(region.getByLabelText("Theme 1"))).toBe(false);
    await waitFor(() => {
      expect(api.selectRequests).toHaveLength(1);
    });
    expect(isLocked(region.getByLabelText("Theme 1"))).toBe(true);
    expect(isLocked(region.getByLabelText("Feedback summary"))).toBe(true);
    await waitFor(() => {
      expectReadItem(region, "Themes", "Second preview theme.");
    });
    expect(isLocked(region.getByRole("button", { name: "Edit" }))).toBe(false);
    expect(region.queryByText("New briefing ready to review")).toBeNull();
  });

  it("F4 step 7 / F6-09: this tab's own result never replaces a draft typed while it was generating", async () => {
    const second = otherPreview(4, "Second preview theme.");
    // Generated from the saved briefing's read view: Generate is not offered over a shown preview.
    api.view = {
      ...api.view,
      savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME },
      briefingRevision: 1,
    };
    api.generationReplies.push({ kind: "preview", preview: second, delayMs: 150 });
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    // Edit stays available while the generation runs; the draft is dirty when the result lands.
    await startEditing(user, region);
    await user.type(region.getByLabelText<HTMLTextAreaElement>("Theme 1"), " Typed meanwhile.");
    expect(await region.findByText("New briefing ready to review")).toBeTruthy();
    expect(api.generationRequests).toHaveLength(1);
    expect(api.selectRequests).toHaveLength(0);
    expect(region.getByLabelText<HTMLTextAreaElement>("Theme 1").value).toBe(
      "Requests for more rest-break time. Typed meanwhile.",
    );
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
      expect(isLocked(region.getByRole("button", { name: "Edit" }))).toBe(false);
    });
    expectReadItem(region, "Themes", "Selected in another tab.");
  });

  it("F6-09: a preview another tab selected under a dirty draft is announced; reviewing it only switches the editor", async () => {
    const first = buildBriefingView();
    const second = otherPreview(4, "Second preview theme.");
    api.view = { ...api.view, selectedPreview: first };
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
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
      expectReadItem(region, "Themes", "Second preview theme.");
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
    await startEditing(user, region);
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
    expect(region.getByRole("heading", { name: "Saved briefing" })).toBeTruthy();
    expect(region.queryByText("Unsaved preview")).toBeNull();
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
    // Read-only: its own title, no provenance line; no editor, so no Unsaved preview badge.
    expect(region.queryByText(/fixture-model/)).toBeNull();
    expect(region.queryByText("Unsaved preview")).toBeNull();
    const toggle = within(sectionItem(region, "Themes")).getByRole("button", {
      name: "Requests for more rest-break time.",
    });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(disclosedBy(toggle)).getByText(EVIDENCE_NOTE)).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Review new preview" }));
    expect(
      await region.findByRole("heading", { name: "Generated preview — not saved as briefing" }),
    ).toBeTruthy();
  });

  it("Plan 4 review: after saving the saved briefing while another tab selected a preview, the editor stays on the saved briefing", async () => {
    api.view = { ...api.view, savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME } };
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
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
    await user.click(region.getByRole("button", { name: "Save" }));
    expect(await region.findByRole("heading", { name: "Saved briefing" })).toBeTruthy();
    expectReadItem(region, "Themes", "Requests for more rest-break time. Edited.");
  });

  it("P22: discarding the saved briefing's edits while another tab selected a preview keeps the saved briefing", async () => {
    api.view = { ...api.view, savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME } };
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.type(region.getByLabelText<HTMLTextAreaElement>("Theme 1"), " Edited.");
    api.view = { ...api.view, selectedPreview: otherPreview(5, "Selected in another tab.") };
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(0);
    });
    FakeEventSource.instances[0]?.emit("changed", '{"version":2}');
    await region.findByText(/ready to review/);
    await user.click(region.getByRole("button", { name: "Cancel" }));
    await user.click((await confirmDialog()).getByRole("button", { name: "Discard" }));
    await waitFor(() => {
      expectReadItem(region, "Themes", "Requests for more rest-break time.");
    });
    expect(region.getByRole("heading", { name: "Saved briefing" })).toBeTruthy();
    // The other tab's preview is still there to switch to; the editor did not jump to it.
    expect(region.getByRole("radiogroup", { name: "Briefing to show" })).toBeTruthy();
  });

  it("shows no visible caption above the preview/saved switch, which keeps its accessible name", async () => {
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
    const region = await panel();
    expect(await region.findByRole("radiogroup", { name: "Briefing to show" })).toBeTruthy();
    // The name is the control's own (visually hidden) label, not a visible caption.
    expect(region.queryByText("Briefing to show")).toBeNull();
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

  it("header: [Edit] [Accept preview] while the preview is shown, no Generate; [Edit] [Generate] on the saved briefing", async () => {
    const { user } = renderApp();
    const region = await panel();
    expect(await region.findByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
    const header = region.getByRole("heading", { level: 2, name: "Briefing" }).parentElement;
    const edit = region.getByRole("button", { name: "Edit" });
    const accept = region.getByRole("button", { name: "Accept preview" });
    expect(header?.contains(edit) && header.contains(accept)).toBe(true);
    expect(edit.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(queryGenerate(region)).toBeNull();

    await user.click(option(region, "Saved briefing"));
    expect(await region.findByRole("heading", { name: "Saved briefing" })).toBeTruthy();
    expect(region.queryByRole("button", { name: "Accept preview" })).toBeNull();
    expect(region.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(generateButton(region).disabled).toBe(false);

    await user.click(option(region, "Generated preview"));
    expect(await region.findByRole("button", { name: "Accept preview" })).toBeTruthy();
    expect(queryGenerate(region)).toBeNull();
  });

  it("marks the generated preview with an Unsaved preview badge in the header, not the saved briefing", async () => {
    const { user } = renderApp();
    const region = await panel();
    expect(await region.findByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
    const header = region.getByRole("heading", { level: 2, name: "Briefing" }).parentElement;
    const badge = region.getByText("Unsaved preview");
    expect(header?.contains(badge)).toBe(true);
    await user.click(option(region, "Saved briefing"));
    expect(await region.findByRole("heading", { name: "Saved briefing" })).toBeTruthy();
    expect(region.queryByText("Unsaved preview")).toBeNull();
    await user.click(option(region, "Generated preview"));
    expect(await region.findByText("Unsaved preview")).toBeTruthy();
  });

  it("switches the editor between the generated preview and the saved briefing", async () => {
    const { user } = renderApp();
    const region = await panel();
    expect(await region.findByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
    expect(option(region, "Generated preview").getAttribute("aria-checked")).toBe("true");
    expectReadItem(region, "Themes", "Requests for more rest-break time.");
    // The read view offers Edit; saving (and so replacing the saved briefing) starts there.
    expect(region.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(region.queryByRole("button", { name: "Save" })).toBeNull();

    await user.click(option(region, "Saved briefing"));
    expect(await region.findByRole("heading", { name: "Saved briefing" })).toBeTruthy();
    expectReadItem(region, "Themes", "Saved theme wording.");
    expect(option(region, "Saved briefing").getAttribute("aria-checked")).toBe("true");
    await expectHeadingFocused(/^Saved briefing/);

    await user.click(option(region, "Generated preview"));
    expect(await region.findByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
    expectReadItem(region, "Themes", "Requests for more rest-break time.");
    await expectHeadingFocused(/^Generated preview/);
  });

  it("F5-10: switching while dirty asks first; Cancel keeps the draft, confirming switches and focuses the heading", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.type(theme(region), " My draft.");
    await user.click(option(region, "Saved briefing"));
    expect(await screen.findByText("Discard your edits and switch?")).toBeTruthy();
    expect(
      screen.getByText(
        "Your unsaved wording will be lost. Cancel to keep editing; you can save it first.",
      ),
    ).toBeTruthy();
    await user.click((await confirmDialog()).getByRole("button", { name: "Cancel" }));
    expect(theme(region).value).toBe("Requests for more rest-break time. My draft.");
    expect(region.getByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
    expect(option(region, "Generated preview").getAttribute("aria-checked")).toBe("true");

    await user.click(option(region, "Saved briefing"));
    await user.click(await screen.findByRole("button", { name: "Discard and switch" }));
    await waitFor(() => {
      expectReadItem(region, "Themes", "Saved theme wording.");
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
      expectReadItem(region, "Themes", "Saved theme wording.");
    });
    await startEditing(user, region);
    await user.clear(theme(region));
    await user.type(theme(region), "Edited saved wording.");
    await user.click(region.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(api.view.briefingRevision).toBe(2);
    });
    const sent = SaveBriefingRequestSchema.parse(api.saveRequests[0]);
    expect(sent.generationId).toBe(saved.provenance.generationId);
    expect(sent.baseBriefingRevision).toBe(1);
    expect(api.view.selectedPreview).toEqual(preview);
    expect(await region.findByRole("heading", { name: "Saved briefing" })).toBeTruthy();
    await waitFor(() => {
      expectReadItem(region, "Themes", "Edited saved wording.");
    });
    // The preview is still there to switch back to.
    await user.click(option(region, "Generated preview"));
    expect(await region.findByRole("heading", { name: PREVIEW_TITLE })).toBeTruthy();
  });

  it("T3 §11: a source opened before a save stays open after the editor remounts", async () => {
    api.view = { ...api.view, savedBriefing: null, briefingRevision: 0 };
    const { user } = renderApp();
    const region = await panel();
    const themeToggle = () =>
      within(sectionItem(region, "Themes")).getByRole("button", {
        name: "Sources (2)",
      });
    await startEditing(user, region);
    await user.click(themeToggle());
    expect(themeToggle().getAttribute("aria-expanded")).toBe("true");
    await user.type(theme(region), " Saved.");
    await user.click(region.getByRole("button", { name: "Save" }));
    expect(await region.findByRole("heading", { name: "Saved briefing" })).toBeTruthy();
    const [row] = within(sectionItem(region, "Themes")).getAllByRole("button");
    expect(row?.getAttribute("aria-expanded")).toBe("true");
    // Only that item: another item's sources stay closed.
    const [other] = within(sectionItem(region, "Disagreements")).getAllByRole("button");
    expect(other?.getAttribute("aria-expanded")).toBe("false");
  });
});
