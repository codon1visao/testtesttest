import { SaveBriefingRequestSchema } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { expectReadItem, sectionItem, startEditing } from "../../testing/briefing-queries";
import { apiErrorResponse, FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";

let api: FakeEventApi;
const preview = buildBriefingView();

beforeEach(() => {
  api = new FakeEventApi();
  api.view = { ...api.view, selectedPreview: preview };
  mswServer.use(...api.handlers());
});

/** A PUT that lands in the fake's saved briefing but whose response is lost (F5 lost response). */
const saveThenLoseResponse = () =>
  http.put("/api/events/:eventId/briefing", async ({ request }) => {
    const { textEdits } = SaveBriefingRequestSchema.parse(await request.json());
    api.view = {
      ...api.view,
      selectedPreview: null,
      briefingRevision: 1,
      savedBriefing: {
        ...preview,
        savedAt: FIXTURE_TIME,
        content: {
          ...preview.content,
          themes: preview.content.themes.map((item, index) => ({
            ...item,
            text: textEdits.themes[index] ?? item.text,
          })),
        },
      },
    };
    return HttpResponse.error();
  });

/** The editor's own heading holds keyboard focus (never <body>). */
const expectEditorHeadingFocused = async (title: RegExp) => {
  await waitFor(() => {
    const active = document.activeElement;
    expect(active?.tagName).toBe("H3");
    expect(active?.isConnected).toBe(true);
    expect(active?.textContent).toMatch(title);
  });
};

/** Disabled natively or through aria-disabled (Astryx keeps some controls focusable). */
const isLocked = (element: HTMLElement) =>
  (element instanceof HTMLTextAreaElement && element.disabled) ||
  (element instanceof HTMLButtonElement && element.disabled) ||
  element.getAttribute("aria-disabled") === "true";

const panel = async () => within(await screen.findByRole("region", { name: "Briefing" }));
const field = (region: Awaited<ReturnType<typeof panel>>, label: string) =>
  region.getByLabelText<HTMLTextAreaElement>(label);

describe("briefing editor", () => {
  it("F5-01: edits a selected preview's wording and saves it with the original references", async () => {
    const { user } = renderApp();
    const region = await panel();
    expect(
      region.getByRole("heading", { name: "Generated preview — not saved as briefing" }),
    ).toBeTruthy();
    expect(region.getByText(/References identify the source notes/)).toBeTruthy();
    await startEditing(user, region);
    const theme = field(region, "Theme 1");
    await user.clear(theme);
    await user.type(theme, "People asked for longer rest breaks.");
    expect(region.getByText("Unsaved changes to the briefing text.")).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Save briefing" }));

    expect(
      await region.findByRole("heading", { name: /^Saved briefing · last saved / }),
    ).toBeTruthy();
    expectReadItem(region, "Which themes recur", "People asked for longer rest breaks.");
    const row = within(sectionItem(region, "Which themes recur")).getByRole("button", {
      name: /^People asked for longer rest breaks\./,
    });
    expect(within(row).getByText("F05")).toBeTruthy();
    const sent = SaveBriefingRequestSchema.parse(api.saveRequests[0]);
    expect(sent.textEdits.themes).toEqual(["People asked for longer rest breaks."]);
    expect(api.view.savedBriefing?.content.themes).toEqual([
      { text: "People asked for longer rest breaks.", sourceIds: ["F05", "F06"] },
    ]);
    // The editor took focus on its own heading after the save, not <body>.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toMatch(/^Saved briefing/);
    });
  });

  it("F5-09: with a saved briefing, the preview's action is Save and replace briefing", async () => {
    api.view = { ...api.view, savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME } };
    renderApp();
    expect((await panel()).getByRole("button", { name: "Save and replace briefing" })).toBeTruthy();
  });

  it("Review Focus 5 / F5-05: opening a source with the keyboard keeps the draft", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    const theme = field(region, "Theme 1");
    await user.type(theme, " Edited.");
    const toggle = within(sectionItem(region, "Which themes recur")).getByRole("button", {
      name: "Sources (2)",
    });
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Edited.");
  });

  it("Review Focus 1 / F5-06: a save after another tab saved is a conflict that keeps the draft", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    api.saveBriefingElsewhere();
    await user.type(field(region, "Theme 1"), " Mine.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("The briefing changed elsewhere")).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Mine.");
    expect(api.view.savedBriefing).toBeNull();
  });

  it("focus: a save that ends in a notice moves focus to the notice, never to <body>", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    api.saveBriefingElsewhere();
    await user.type(field(region, "Theme 1"), " Mine.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    const title = await region.findByText("The briefing changed elsewhere");
    await waitFor(() => {
      expect(document.activeElement?.contains(title)).toBe(true);
    });
  });

  it("focus: a Retry save that fails again keeps focus on the notice", async () => {
    let attempts = 0;
    mswServer.use(
      http.put("/api/events/:eventId/briefing", () => {
        attempts += 1;
        return apiErrorResponse(503, "STORE_UNAVAILABLE", "The database is not reachable.");
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.type(field(region, "Theme 1"), " Again.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    // The Retry button unmounts while the retry is in flight; focus must come back to the notice.
    await user.click(await region.findByRole("button", { name: "Retry save" }));
    await waitFor(() => {
      expect(attempts).toBe(2);
      expect(region.queryByRole("button", { name: "Retry save" })).not.toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain("Briefing was not saved");
    });
  });

  it("Spec 05 revision conflict: shows the latest saved briefing for review and keeps the draft", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    api.view = { ...api.view, savedBriefing: { ...buildBriefingView(), savedAt: FIXTURE_TIME } };
    api.saveBriefingElsewhere();
    await user.type(field(region, "Theme 1"), " Mine.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("The briefing changed elsewhere")).toBeTruthy();
    expect(await region.findByRole("heading", { name: "Latest saved briefing" })).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Mine.");
  });

  it("F5-10 focus: Discard and reload after a conflict moves focus to the remounted editor heading", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    api.saveBriefingElsewhere();
    await user.type(field(region, "Theme 1"), " Mine.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    await user.click(await region.findByRole("button", { name: "Reload saved briefing" }));
    await user.click(await screen.findByRole("button", { name: "Discard and reload" }));
    await waitFor(() => {
      expectReadItem(region, "Which themes recur", "Requests for more rest-break time.");
    });
    expect(region.queryByText("The briefing changed elsewhere")).toBeNull();
    await expectEditorHeadingFocused(/^Generated preview/);
  });

  it("F5-04: a blank item is caught before sending, on that field", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.clear(field(region, "Disagreement 2"));
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Must not be blank")).toBeTruthy();
    expect(api.saveRequests).toHaveLength(0);
  });

  it("F5-04: a server field error lands on its field and keeps every draft", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/briefing", () =>
        apiErrorResponse(
          422,
          "CONTENT_INVALID",
          "Text must be 1-1000 characters and not blank",
          "textEdits.conflicts.0",
        ),
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.type(field(region, "Theme 1"), " Kept.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Text must be 1-1000 characters and not blank")).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Kept.");
  });

  it("M1: a section-level server error, which has no single input, is shown in a banner", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/briefing", () =>
        apiErrorResponse(422, "CONTENT_INVALID", "Expected 1 items.", "textEdits.themes"),
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Expected 1 items.")).toBeTruthy();
    expect(region.getByText("Briefing was not saved")).toBeTruthy();
  });

  it("M1: an error on an item that is not rendered is shown in a banner, not lost", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/briefing", () =>
        apiErrorResponse(422, "CONTENT_INVALID", "Theme 6 is invalid.", "textEdits.themes.5"),
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Theme 6 is invalid.")).toBeTruthy();
    expect(region.getByText("Briefing was not saved")).toBeTruthy();
  });

  it("Spec 05 save failed: Retry save sends the kept draft again", async () => {
    mswServer.use(
      http.put(
        "/api/events/:eventId/briefing",
        () => apiErrorResponse(503, "STORE_UNAVAILABLE", "The database is not reachable."),
        { once: true },
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.type(field(region, "Theme 1"), " Again.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Briefing was not saved")).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Retry save" }));
    expect(await region.findByRole("heading", { name: /^Saved briefing/ })).toBeTruthy();
    expectReadItem(region, "Which themes recur", "Requests for more rest-break time. Again.");
    expect(api.saveRequests).toHaveLength(1);
  });

  it("F5 lost response: Check again re-reads after a failed check and confirms the save", async () => {
    mswServer.use(saveThenLoseResponse());
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.error(), { once: true }));
    await user.type(field(region, "Theme 1"), " Landed.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Could not check the saved briefing")).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Landed.");
    await user.click(region.getByRole("button", { name: "Check again" }));
    expect(await region.findByText("Your briefing changes were saved.")).toBeTruthy();
    expect(region.getByRole("heading", { name: /^Saved briefing/ })).toBeTruthy();
  });

  it("F5 lost response: the fields are locked while the outcome is unknown, so Check again never drops newer text", async () => {
    mswServer.use(saveThenLoseResponse());
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.error(), { once: true }));
    await user.type(field(region, "Theme 1"), " Landed.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Could not check the saved briefing")).toBeTruthy();
    for (const label of ["Attendance overview", "Feedback summary", "Theme 1"]) {
      expect(isLocked(field(region, label))).toBe(true);
    }
    expect(isLocked(region.getByRole("button", { name: "Check again" }))).toBe(false);
    expect(isLocked(region.getByRole("button", { name: "Cancel edit" }))).toBe(false);
    await user.click(region.getByRole("button", { name: "Check again" }));
    expect(await region.findByText("Your briefing changes were saved.")).toBeTruthy();
    expectReadItem(region, "Which themes recur", "Requests for more rest-break time. Landed.");
    expect(isLocked(region.getByRole("button", { name: "Edit briefing" }))).toBe(false);
  });

  it("F5-10: Cancel edit with changes asks first; Cancel keeps the draft, Discard returns to the read view", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.type(field(region, "Theme 1"), " Draft.");
    await user.click(region.getByRole("button", { name: "Cancel edit" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Draft.");
    await user.click(region.getByRole("button", { name: "Cancel edit" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => {
      expectReadItem(region, "Which themes recur", "Requests for more rest-break time.");
    });
    await expectEditorHeadingFocused(/^Generated preview/);
  });

  it("F5-10 focus: Discard after the server moved on remounts the editor and focuses its heading", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    api.saveBriefingElsewhere();
    await user.type(field(region, "Theme 1"), " Mine.");
    // The conflict refreshes the view (new revision); the dirty draft keeps its old base meanwhile.
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("The briefing changed elsewhere")).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Cancel edit" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => {
      expectReadItem(region, "Which themes recur", "Requests for more rest-break time.");
    });
    await expectEditorHeadingFocused(/^Generated preview/);
  });

  it("F5 saving state: fields are locked while the save is in flight", async () => {
    api.saveDelayMs = 150;
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.type(field(region, "Theme 1"), " Locked.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Saving briefing…")).toBeTruthy();
    expect(
      field(region, "Theme 1").disabled ||
        field(region, "Theme 1").getAttribute("aria-disabled") === "true",
    ).toBe(true);
    expect(await region.findByRole("heading", { name: /^Saved briefing/ })).toBeTruthy();
  });

  it("F5 lost response: one re-read confirms the save before reporting it", async () => {
    mswServer.use(saveThenLoseResponse());
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.type(field(region, "Theme 1"), " Landed.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Your briefing changes were saved.")).toBeTruthy();
    expect(region.getByRole("heading", { name: /^Saved briefing/ })).toBeTruthy();
    expectReadItem(region, "Which themes recur", "Requests for more rest-break time. Landed.");
  });

  it("opens read-only; Edit briefing shows the text areas and focuses the feedback summary", async () => {
    const { user } = renderApp();
    const region = await panel();
    expect(region.queryAllByRole("textbox")).toHaveLength(0);
    expectReadItem(region, "Which themes recur", "Requests for more rest-break time.");
    await user.click(region.getByRole("button", { name: "Edit briefing" }));
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time.");
    await waitFor(() => {
      expect(document.activeElement).toBe(field(region, "Feedback summary"));
    });
    expect(region.getByRole("button", { name: "Save briefing" })).toBeTruthy();
    expect(region.getByRole("button", { name: "Cancel edit" })).toBeTruthy();
  });

  it("Cancel edit without changes closes the text areas at once and focuses the heading", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    await user.click(region.getByRole("button", { name: "Cancel edit" }));
    expect(screen.queryByRole("heading", { name: "Discard your edits?" })).toBeNull();
    expect(region.queryAllByRole("textbox")).toHaveLength(0);
    await expectEditorHeadingFocused(/^Generated preview/);
  });

  it("F5: a selected preview is saved from the read view, without editing", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(
      await region.findByRole("heading", { name: /^Saved briefing · last saved / }),
    ).toBeTruthy();
    expect(SaveBriefingRequestSchema.parse(api.saveRequests[0]).textEdits.themes).toEqual([
      "Requests for more rest-break time.",
    ]);
    // The saved briefing's read view offers Edit only: there is nothing unsaved to save.
    expect(region.queryByRole("button", { name: "Save briefing" })).toBeNull();
    expect(region.getByRole("button", { name: "Edit briefing" })).toBeTruthy();
  });

  it("Review Focus 1 / 2: a field error on a read-view save opens that field; Cancel edit closes it for good", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/briefing", () =>
        apiErrorResponse(
          422,
          "CONTENT_INVALID",
          "Text must be 1-1000 characters and not blank",
          "textEdits.conflicts.0",
        ),
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Text must be 1-1000 characters and not blank")).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(field(region, "Disagreement 1"));
    });
    await user.click(region.getByRole("button", { name: "Cancel edit" }));
    expect(region.queryAllByRole("textbox")).toHaveLength(0);
    expect(region.queryByText("Text must be 1-1000 characters and not blank")).toBeNull();
  });

  it("Review Focus 3: a clean open editor follows a newer saved revision back to the read view", async () => {
    const { user } = renderApp();
    const region = await panel();
    await startEditing(user, region);
    api.saveBriefingElsewhere();
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => {
      expect(region.queryAllByRole("textbox")).toHaveLength(0);
    });
    expect(region.getByRole("button", { name: "Edit briefing" })).toBeTruthy();
  });
});
