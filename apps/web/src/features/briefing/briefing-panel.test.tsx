import { RunIdSchema } from "@event-desk/contracts";
import { buildBriefingView } from "@event-desk/contracts/testing";
import { screen, waitFor, within } from "@testing-library/react";
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

  it("F4-01: generates from the saved baseline and shows the incoming preview read-only", async () => {
    api.generationReplies.push({ kind: "preview", delayMs: 150 });
    const { user } = renderApp();
    const region = await panel();
    await user.click(generateButton(region));
    expect(
      await region.findByText("Generating briefing… This can take up to a minute."),
    ).toBeTruthy();
    expect(generateButton(region).disabled).toBe(true);

    expect(
      await region.findByRole("heading", { name: "New preview (not yet reviewed)" }),
    ).toBeTruthy();
    expect(
      region.getByText(
        "4 registered members: 1 attended, 2 absent, 1 not recorded (attendance is incomplete).",
      ),
    ).toBeTruthy();
    expect(region.getByText(/Requests for more rest-break time\./)).toBeTruthy();
    expect(region.getAllByText(/\(Sources: F05, F06\)/).length).toBeGreaterThan(0);
    expect(region.getByText(/fixture-model · requested by you/)).toBeTruthy();
    expect(api.generationRequests).toEqual([{ baseAttendanceRevision: 0 }]);
    expect((await screen.findAllByText("Briefing generated")).length).toBeGreaterThan(0);
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
        "The connection to the AI service was lost after the request was sent; the attempt may have been charged. Your saved work is unchanged.",
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
    renderApp();
    const region = await panel();
    expect(await region.findByText("A briefing is being generated in another tab…")).toBeTruthy();
    expect(generateButton(region).disabled).toBe(true);
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
});
