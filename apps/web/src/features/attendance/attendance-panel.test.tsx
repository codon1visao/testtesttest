import { MemberIdSchema } from "@event-desk/contracts";
import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../state/ui-store";
import { apiErrorResponse, FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { renderApp } from "../../testing/render-app";
import { chooseOption } from "../../testing/selector";

const M03 = MemberIdSchema.parse("M03");
const M04 = MemberIdSchema.parse("M04");
let api: FakeEventApi;

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

const panel = async () => within(await screen.findByRole("region", { name: "Attendance" }));
const select = (region: Awaited<ReturnType<typeof panel>>, name: string) =>
  region.getByRole<HTMLButtonElement>("combobox", { name });
/**
 * The "Attendance saved" toast. Astryx also announces its text in a document-level live region, so
 * a plain findByText finds two elements whenever both are present at its first check (under load)
 * and fails; the toast itself is the element outside the live region (P18).
 */
const toastShown = async (text: string) => {
  await waitFor(
    () => {
      const toasts = screen
        .queryAllByText(text)
        .filter((element) => element.closest("[data-astryx-live-region]") === null);
      expect(toasts).not.toHaveLength(0);
    },
    { timeout: 3_000 },
  );
};
const refocus = () => {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
};

describe("attendance panel", () => {
  it("F2-01: shows each member's saved status and the saved counts", async () => {
    renderApp();
    const region = await panel();
    expect(select(region, "Alex").textContent).toBe("Attended");
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(
      region.getByText("Saved counts: 4 registered · 1 attended · 2 absent · 1 not recorded"),
    ).toBeTruthy();
    expect(
      region.getByRole<HTMLButtonElement>("button", { name: "Save attendance" }).disabled,
    ).toBe(true);
  });

  it("offers exactly the three states, labelled Not recorded (not Absent)", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.click(select(region, "Chris"));
    const options = region.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Attended", "Absent", "Not recorded"]);
  });

  it("F2-02: previews unsaved counts while keeping the saved baseline", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    expect(
      region.getByText("Unsaved counts: 4 registered · 2 attended · 2 absent · 0 not recorded"),
    ).toBeTruthy();
    expect(
      region.getByText("Saved counts: 4 registered · 1 attended · 2 absent · 1 not recorded"),
    ).toBeTruthy();
    expect(region.getByText(/unsaved attendance changes/i)).toBeTruthy();
    expect(useUiStore.getState().attendanceDirty).toBe(true);
  });

  it("F2-03: saves all members in one request with the draft's base revision", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    await toastShown("Attendance saved");
    expect(api.attendanceRequests).toEqual([
      {
        baseAttendanceRevision: 0,
        members: [
          { id: "M01", attendance: "attended" },
          { id: "M02", attendance: "absent" },
          { id: "M03", attendance: "attended" },
          { id: "M04", attendance: "absent" },
        ],
      },
    ]);
    await waitFor(() => {
      expect(
        region.getByText("Saved counts: 4 registered · 2 attended · 2 absent · 0 not recorded"),
      ).toBeTruthy();
    });
    expect(region.queryByText(/unsaved attendance changes/i)).toBeNull();
    expect(useUiStore.getState().attendanceDirty).toBe(false);
  });

  it("discards back to the saved values without asking (explicit action)", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(region.getByRole("button", { name: "Discard attendance changes" }));
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(region.queryByText(/unsaved counts/i)).toBeNull();
  });

  it("moves focus to the Attendance heading after a keyboard Discard (the button unmounts)", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    act(() => {
      region.getByRole("button", { name: "Discard attendance changes" }).focus();
    });
    await user.keyboard("{Enter}");
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(document.activeElement).toBe(region.getByRole("heading", { name: "Attendance" }));
  });

  it("F2-08: keeps the selections and explains a failed save", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/attendance", () =>
        apiErrorResponse(
          503,
          "STORE_UNAVAILABLE",
          "The event store is unavailable. Try again shortly.",
        ),
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(
      await region.findByText("The event store is unavailable. Try again shortly."),
    ).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Attended");
    // The toast text is also announced through Astryx's screen-reader live region, so it occurs twice.
    expect(await screen.findAllByText(/^Attendance was not saved:/)).not.toHaveLength(0);
  });

  it("explains a conflict, keeps the draft, and reloads only after confirmation", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    api.saveElsewhere(M04, "attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText(/saved elsewhere/i)).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Attended");
    await user.click(region.getByRole("button", { name: "Reload saved attendance" }));
    await user.click(await screen.findByRole("button", { name: "Discard and reload" }));
    await waitFor(() => {
      expect(select(region, "Drew").textContent).toBe("Attended");
    });
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(region.queryByText(/saved elsewhere/i)).toBeNull();
    // The Reload button unmounted with the notice; focus lands on a stable target, not <body>.
    await waitFor(() => {
      expect(document.activeElement).toBe(region.getByRole("heading", { name: "Attendance" }));
    });
  });

  it("keeps the draft and the conflict explanation when the confirmed reload fails", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    api.saveElsewhere(M04, "attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText(/saved elsewhere/i)).toBeTruthy();
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.error()));
    await user.click(region.getByRole("button", { name: "Reload saved attendance" }));
    await user.click(await screen.findByRole("button", { name: "Discard and reload" }));
    expect(
      await region.findByText(/the latest saved attendance could not be loaded/i),
    ).toBeTruthy();
    expect(region.getByText(/saved elsewhere/i)).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(select(region, "Drew").textContent).toBe("Absent");
    expect(region.getByRole("button", { name: "Reload saved attendance" })).toBeTruthy();
  });

  it("clears the conflict when the draft is reverted by hand and the form adopts the newer records", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    api.saveElsewhere(M04, "attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText(/saved elsewhere/i)).toBeTruthy();
    await waitFor(() => {
      expect(region.getByText(/Saved counts: 4 registered · 2 attended/)).toBeTruthy();
    });
    await chooseOption(user, region, "Chris", "Not recorded");
    await waitFor(() => {
      expect(select(region, "Drew").textContent).toBe("Attended");
    });
    expect(region.queryByText(/saved elsewhere/i)).toBeNull();
  });

  it("a refetch never overwrites a dirty draft, and its save still conflicts", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    api.saveElsewhere(M04, "attended");
    refocus();
    await waitFor(() => {
      expect(region.getByText(/Saved counts: 4 registered · 2 attended/)).toBeTruthy();
    });
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(select(region, "Drew").textContent).toBe("Absent");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText(/saved elsewhere/i)).toBeTruthy();
    expect(api.view.members.find((m) => m.id === M03)?.attendance).toBe("not_recorded");
  });

  it("a clean form follows newer saved records", async () => {
    renderApp();
    const region = await panel();
    api.saveElsewhere(M04, "attended");
    refocus();
    await waitFor(() => {
      expect(select(region, "Drew").textContent).toBe("Attended");
    });
  });

  it("a draft reverted by hand follows the saved records that arrived while it was dirty", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    api.saveElsewhere(M04, "attended");
    refocus();
    await waitFor(() => {
      expect(region.getByText(/Saved counts: 4 registered · 2 attended/)).toBeTruthy();
    });
    expect(select(region, "Drew").textContent).toBe("Absent");
    await chooseOption(user, region, "Chris", "Not recorded");
    await waitFor(() => {
      expect(select(region, "Drew").textContent).toBe("Attended");
    });
  });

  it("reconciles a lost response that was in fact saved", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/attendance", () => {
        api.saveElsewhere(M03, "attended");
        return HttpResponse.error();
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText("Your attendance changes were saved.")).toBeTruthy();
    expect(region.queryByText(/unsaved attendance changes/i)).toBeNull();
  });

  it("treats a 2xx save with a malformed body as unconfirmed and reconciles it", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/attendance", () => {
        api.saveElsewhere(M03, "attended");
        return HttpResponse.json({ saved: true });
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText("Your attendance changes were saved.")).toBeTruthy();
    expect(screen.queryByText(/attendance was not saved/i)).toBeNull();
    expect(await screen.findAllByText(/could not confirm the attendance save/i)).not.toHaveLength(
      0,
    );
  });

  it("keeps the draft when a lost response was not saved", async () => {
    mswServer.use(http.put("/api/events/:eventId/attendance", () => HttpResponse.error()));
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText(/could not confirm the save/i)).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Attended");
  });

  it("says the check failed (not a mismatch) when the re-read after a lost response fails", async () => {
    let failReads = false;
    mswServer.use(
      http.get("/api/events/:eventId", () => (failReads ? HttpResponse.error() : undefined)),
      http.put("/api/events/:eventId/attendance", () => {
        failReads = true;
        return HttpResponse.error();
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(region.getByRole("button", { name: "Save attendance" }));
    expect(await region.findByText("Could not check the saved records")).toBeTruthy();
    expect(region.getByText(/your selections are kept/i)).toBeTruthy();
    expect(region.queryByText(/do not match your selections/i)).toBeNull();
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(region.getByText(/unsaved attendance changes/i)).toBeTruthy();
  });

  it("keeps inputs and Save locked during the lost-response check, with one re-read and one PUT", async () => {
    let checking = false;
    let reads = 0;
    let puts = 0;
    mswServer.use(
      http.get("/api/events/:eventId", async () => {
        if (!checking) return undefined;
        reads += 1;
        await delay(200);
        return undefined;
      }),
      http.put("/api/events/:eventId/attendance", () => {
        puts += 1;
        checking = true;
        return HttpResponse.error();
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    const save = region.getByRole<HTMLButtonElement>("button", { name: "Save attendance" });
    await user.click(save);
    await waitFor(() => {
      expect(reads).toBe(1);
    });
    // The PUT has failed; the re-read is in flight. Nothing may be edited or saved meanwhile.
    await act(() => delay(50));
    expect(select(region, "Alex").disabled).toBe(true);
    expect(select(region, "Chris").disabled).toBe(true);
    expect(save.disabled).toBe(true);
    await user.click(save);
    expect(await region.findByText(/could not confirm the save/i)).toBeTruthy();
    expect(select(region, "Chris").disabled).toBe(false);
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(puts).toBe(1);
    expect(reads).toBe(1);
  });

  it("locks inputs while saving and sends one request for a double-clicked Save", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/attendance", async ({ request }) => {
        await delay(150);
        api.attendanceRequests.push(await request.json());
        return apiErrorResponse(503, "STORE_UNAVAILABLE", "Busy.");
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    const save = region.getByRole("button", { name: "Save attendance" });
    await user.dblClick(save);
    expect(select(region, "Alex").disabled).toBe(true);
    await region.findByText("Busy.");
    expect(api.attendanceRequests).toHaveLength(1);
  });

  it("F2-10: every control is reachable and operable by keyboard", async () => {
    const { user } = renderApp();
    const region = await panel();
    act(() => {
      select(region, "Alex").focus();
    });
    for (const name of ["Bea", "Chris", "Drew"]) {
      await user.tab();
      expect(document.activeElement).toBe(select(region, name));
    }
    // Drew is Absent: Enter opens the list on it, ArrowUp moves to Attended, Enter picks it.
    await user.keyboard("{Enter}");
    expect(await region.findByRole("listbox")).toBeTruthy();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(select(region, "Drew").textContent).toBe("Attended");
    expect(document.activeElement).toBe(select(region, "Drew"));
    await user.tab();
    expect(document.activeElement).toBe(region.getByRole("button", { name: "Save attendance" }));
    await user.keyboard("{Enter}");
    await toastShown("Attendance saved");
  });

  it("shows the members as a table with Name and Actions columns", async () => {
    renderApp();
    const region = await panel();
    const table = region.getByRole("table", { name: "Member attendance" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Name", "Actions"]);
    const rows = within(table)
      .getAllByRole("row")
      .filter((row) => within(row).queryAllByRole("columnheader").length === 0);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "Alex",
      "Bea",
      "Chris",
      "Drew",
    ]);
  });

  it("warns before leaving while attendance is unsaved", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
