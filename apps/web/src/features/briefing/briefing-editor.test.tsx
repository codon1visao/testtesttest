import { SaveBriefingRequestSchema } from "@event-desk/contracts";
import { buildBriefingView, FIXTURE_TIME } from "@event-desk/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
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
    const theme = field(region, "Theme 1");
    await user.clear(theme);
    await user.type(theme, "People asked for longer rest breaks.");
    expect(region.getByText("Unsaved changes to the briefing text.")).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Save briefing" }));

    expect(
      await region.findByRole("heading", { name: /^Saved briefing · last saved / }),
    ).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("People asked for longer rest breaks.");
    // F05 is cited by the feedback summary and by Theme 1, so there is more than one toggle.
    expect(region.getAllByRole("button", { name: "Read source F05" }).length).toBeGreaterThan(0);
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
    const theme = field(region, "Theme 1");
    await user.type(theme, " Edited.");
    const toggle = region.getAllByRole("button", { name: "Read source F05" })[1];
    if (toggle === undefined) throw new Error("theme source toggle missing");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Edited.");
  });

  it("Review Focus 1 / F5-06: a save after another tab saved is a conflict that keeps the draft", async () => {
    const { user } = renderApp();
    const region = await panel();
    api.saveBriefingElsewhere();
    await user.type(field(region, "Theme 1"), " Mine.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("The briefing changed elsewhere")).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Mine.");
    expect(api.view.savedBriefing).toBeNull();
  });

  it("Spec 05 revision conflict: shows the latest saved briefing for review and keeps the draft", async () => {
    const { user } = renderApp();
    const region = await panel();
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
    api.saveBriefingElsewhere();
    await user.type(field(region, "Theme 1"), " Mine.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    await user.click(await region.findByRole("button", { name: "Reload saved briefing" }));
    await user.click(await screen.findByRole("button", { name: "Discard and reload" }));
    await waitFor(() => {
      expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time.");
    });
    expect(region.queryByText("The briefing changed elsewhere")).toBeNull();
    await expectEditorHeadingFocused(/^Generated preview/);
  });

  it("F5-04: a blank item is caught before sending, on that field", async () => {
    const { user } = renderApp();
    const region = await panel();
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
    await user.type(field(region, "Theme 1"), " Again.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Briefing was not saved")).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Retry save" }));
    expect(await region.findByRole("heading", { name: /^Saved briefing/ })).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Again.");
    expect(api.saveRequests).toHaveLength(1);
  });

  it("F5 lost response: Check again re-reads after a failed check and confirms the save", async () => {
    mswServer.use(saveThenLoseResponse());
    const { user } = renderApp();
    const region = await panel();
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.error(), { once: true }));
    await user.type(field(region, "Theme 1"), " Landed.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Could not check the saved briefing")).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Landed.");
    await user.click(region.getByRole("button", { name: "Check again" }));
    expect(await region.findByText("Your briefing changes were saved.")).toBeTruthy();
    expect(region.getByRole("heading", { name: /^Saved briefing/ })).toBeTruthy();
  });

  it("F5-10: Discard edits asks first; Cancel keeps the draft, Discard restores the text", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.type(field(region, "Theme 1"), " Draft.");
    await user.click(region.getByRole("button", { name: "Discard edits" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Draft.");
    await user.click(region.getByRole("button", { name: "Discard edits" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => {
      expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time.");
    });
    await expectEditorHeadingFocused(/^Generated preview/);
  });

  it("F5-10 focus: Discard after the server moved on remounts the editor and focuses its heading", async () => {
    const { user } = renderApp();
    const region = await panel();
    api.saveBriefingElsewhere();
    await user.type(field(region, "Theme 1"), " Mine.");
    // The conflict refreshes the view (new revision); the dirty draft keeps its old base meanwhile.
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("The briefing changed elsewhere")).toBeTruthy();
    await user.click(region.getByRole("button", { name: "Discard edits" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => {
      expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time.");
    });
    await expectEditorHeadingFocused(/^Generated preview/);
  });

  it("F5 saving state: fields are locked while the save is in flight", async () => {
    api.saveDelayMs = 150;
    const { user } = renderApp();
    const region = await panel();
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
    await user.type(field(region, "Theme 1"), " Landed.");
    await user.click(region.getByRole("button", { name: "Save briefing" }));
    expect(await region.findByText("Your briefing changes were saved.")).toBeTruthy();
    expect(region.getByRole("heading", { name: /^Saved briefing/ })).toBeTruthy();
    expect(field(region, "Theme 1").value).toBe("Requests for more rest-break time. Landed.");
  });
});
