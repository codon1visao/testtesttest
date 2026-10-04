import { buildBriefingView, buildSeedEventView } from "@event-desk/contracts/testing";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app-providers";
import { mswServer } from "../../testing/msw-server";
import { BriefingEditor } from "./briefing-editor";

describe("Accept preview: client-side validation", () => {
  it("a stored text the form rejects is shown in the error banner, and nothing is sent", async () => {
    // Not reachable through the API (the same schema parses every read), so the editor gets a
    // base directly: a preview whose first theme is blank.
    const preview = buildBriefingView();
    const invalid = {
      ...preview,
      content: {
        ...preview.content,
        themes: preview.content.themes.map((item, index) =>
          index === 0 ? { ...item, text: "   " } : item,
        ),
      },
    };
    const view = { ...buildSeedEventView(), selectedPreview: invalid };
    let puts = 0;
    mswServer.use(
      http.put("/api/events/:eventId/briefing", () => {
        puts += 1;
        return HttpResponse.error();
      }),
    );
    const actions = document.createElement("div");
    document.body.append(actions);
    const user = userEvent.setup();
    render(
      <AppProviders>
        <BriefingEditor
          eventId={view.event.id}
          view={view}
          base={{ slot: "selected", briefing: invalid, briefingRevision: 0 }}
          refetch={() => Promise.resolve({ data: view, isError: false, error: null })}
          onSaved={() => undefined}
          onReset={() => undefined}
          consumePendingFocus={() => false}
          actionsSlot={actions}
        />
      </AppProviders>,
    );
    await user.click(within(actions).getByRole("button", { name: "Accept preview" }));
    expect(await screen.findByText("Briefing was not saved")).toBeTruthy();
    expect(
      screen.getByText("Some text cannot be saved as it is. Select Edit to see which."),
    ).toBeTruthy();
    // Edit shows the rejected field with its own message.
    await user.click(within(actions).getByRole("button", { name: "Edit" }));
    await waitFor(() => {
      expect(screen.getByText("Must not be blank")).toBeTruthy();
    });
    expect(puts).toBe(0);
    actions.remove();
  });
});
