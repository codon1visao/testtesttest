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
const MEMBERS = ["Alex", "Bea", "Chris", "Drew"];
let api: FakeEventApi;

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

const panel = async () => within(await screen.findByRole("region", { name: "Attendance" }));
type Region = Awaited<ReturnType<typeof panel>>;
const select = (region: Region, name: string) =>
  region.getByRole<HTMLButtonElement>("combobox", { name });
/**
 * Locked for input: Astryx keeps a Selector with a disabled message focusable through
 * aria-disabled, so the trigger that started a save keeps keyboard focus (F2-10).
 */
const isLocked = (element: HTMLElement) =>
  (element instanceof HTMLButtonElement && element.disabled) ||
  element.getAttribute("aria-disabled") === "true";
const lockedStates = (region: Region) => MEMBERS.map((name) => isLocked(select(region, name)));
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
/** A count tile's value, by its label: the <dd> beside that <dt> (F2 counts as stat tiles). */
const tileValue = (region: Region, label: string) => {
  const term = region.getAllByRole("term").find((element) => element.textContent === label);
  if (term === undefined) throw new Error(`no ${label} tile`);
  return term.parentElement?.querySelector("dd")?.textContent ?? null;
};
const tileValues = (region: Region) =>
  ["Registered", "Attended", "Absent", "Not recorded"].map((label) => tileValue(region, label));
const refocus = () => {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
};
/** Holds every attendance PUT until released; the fake API then answers it as usual. */
const holdSaves = () => {
  const { promise: gate, resolve } = Promise.withResolvers<undefined>();
  mswServer.use(
    http.put("/api/events/:eventId/attendance", async () => {
      await gate;
      return undefined;
    }),
  );
  return () => {
    resolve(undefined);
  };
};
const leavingIsWarned = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("attendance panel", () => {
  it("F2-01: shows each member's saved status and the saved counts, with no Save button", async () => {
    renderApp();
    const region = await panel();
    expect(select(region, "Alex").textContent).toBe("Attended");
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(tileValues(region)).toEqual(["4", "1", "2", "1"]);
    expect(region.queryByRole("button", { name: "Save attendance" })).toBeNull();
    expect(region.queryByRole("button", { name: "Discard attendance changes" })).toBeNull();
  });

  it("F2 counts: four labelled tiles in one row, in order, announced as a whole", async () => {
    renderApp();
    const region = await panel();
    const counts = region.getByLabelText("Attendance counts");
    expect(counts.tagName).toBe("DL");
    const live = counts.closest("[aria-live]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.getAttribute("aria-atomic")).toBe("true");
    // One tile per count, as direct children of the list, in reading order.
    expect(
      Array.from(counts.children).map((tile) => tile.querySelector("dt")?.textContent),
    ).toEqual(["Registered", "Attended", "Absent", "Not recorded"]);
    expect(tileValues(region)).toEqual(["4", "1", "2", "1"]);
    expect(region.queryByText("Saving…")).toBeNull();
  });

  it("offers exactly the three states, labelled Not recorded (not Absent)", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.click(select(region, "Chris"));
    const options = region.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Attended", "Absent", "Not recorded"]);
  });

  it("F2-03: a choice saves at once: one PUT with all members and the saved revision", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
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
    expect(tileValues(region)).toEqual(["4", "2", "2", "0"]);
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(useUiStore.getState().attendanceDirty).toBe(false);
  });

  it("choosing the status a member already has sends nothing", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Not recorded");
    await act(() => delay(50));
    expect(api.attendanceRequests).toHaveLength(0);
    expect(region.queryByText("Saving…")).toBeNull();
    expect(lockedStates(region)).toEqual([false, false, false, false]);
  });

  it("while saving: every Selector is locked, Saving… shows, the tiles show the choice, Generate waits", async () => {
    const release = holdSaves();
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    expect(await region.findByText("Saving…")).toBeTruthy();
    expect(lockedStates(region)).toEqual([true, true, true, true]);
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(tileValues(region)).toEqual(["4", "2", "2", "0"]);
    expect(useUiStore.getState().attendanceDirty).toBe(true);
    expect(leavingIsWarned()).toBe(true);

    release();
    await waitFor(() => {
      expect(region.queryByText("Saving…")).toBeNull();
    });
    expect(lockedStates(region)).toEqual([false, false, false, false]);
    expect(tileValues(region)).toEqual(["4", "2", "2", "0"]);
    expect(useUiStore.getState().attendanceDirty).toBe(false);
    expect(leavingIsWarned()).toBe(false);
  });

  it("adopts the saved response: the next change carries the new revision", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await waitFor(() => {
      expect(isLocked(select(region, "Drew"))).toBe(false);
    });
    await chooseOption(user, region, "Drew", "Attended");
    await waitFor(() => {
      expect(api.attendanceRequests).toHaveLength(2);
    });
    expect(api.attendanceRequests[1]).toMatchObject({ baseAttendanceRevision: 1 });
    await waitFor(() => {
      expect(tileValues(region)).toEqual(["4", "3", "1", "0"]);
    });
    expect(api.view.attendanceRevision).toBe(2);
  });

  it("a second choice while a save is in flight sends nothing (one PUT)", async () => {
    const release = holdSaves();
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await region.findByText("Saving…");
    await user.click(select(region, "Drew"));
    expect(region.queryByRole("listbox")).toBeNull();
    release();
    await toastShown("Attendance saved");
    expect(api.attendanceRequests).toHaveLength(1);
    expect(select(region, "Drew").textContent).toBe("Absent");
  });

  it("a locked trigger ignores the keyboard while a save is in flight", async () => {
    const release = holdSaves();
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await region.findByText("Saving…");
    act(() => {
      select(region, "Chris").focus();
    });
    await user.keyboard("{Enter}");
    await user.keyboard("N");
    expect(region.queryByRole("listbox")).toBeNull();
    expect(select(region, "Chris").textContent).toBe("Attended");
    release();
    await toastShown("Attendance saved");
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(api.attendanceRequests).toHaveLength(1);
  });

  it("a refetch during a save keeps the choice shown; the save then meets the conflict", async () => {
    let reads = 0;
    mswServer.use(
      http.get("/api/events/:eventId", () => {
        reads += 1;
        return undefined;
      }),
    );
    const release = holdSaves();
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await region.findByText("Saving…");
    api.saveElsewhere(M04, "attended");
    const before = reads;
    refocus();
    await waitFor(() => {
      expect(reads).toBeGreaterThan(before);
    });
    await act(() => delay(50));
    // The newer saved view does not replace the change being saved.
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(select(region, "Drew").textContent).toBe("Absent");
    release();
    expect(await region.findByText("Attendance changed elsewhere")).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(select(region, "Drew").textContent).toBe("Attended");
  });

  it("F2-08: a failed save reverts the choice and names the member; the next successful save clears it", async () => {
    mswServer.use(
      http.put(
        "/api/events/:eventId/attendance",
        () =>
          apiErrorResponse(
            503,
            "STORE_UNAVAILABLE",
            "The event store is unavailable. Try again shortly.",
          ),
        { once: true },
      ),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    expect(await region.findByText("Chris was not saved")).toBeTruthy();
    expect(region.getByText("The event store is unavailable. Try again shortly.")).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(tileValues(region)).toEqual(["4", "1", "2", "1"]);
    expect(lockedStates(region)).toEqual([false, false, false, false]);
    expect(useUiStore.getState().attendanceDirty).toBe(false);
    // The toast text is also announced through Astryx's screen-reader live region, so it occurs
    // twice.
    expect(await screen.findAllByText(/^Attendance was not saved:/)).not.toHaveLength(0);

    await chooseOption(user, region, "Drew", "Attended");
    await waitFor(() => {
      expect(region.queryByText("Chris was not saved")).toBeNull();
    });
    expect(select(region, "Drew").textContent).toBe("Attended");
  });

  it("a conflict re-reads and shows the latest saved attendance with a warning", async () => {
    const { user } = renderApp();
    const region = await panel();
    api.saveElsewhere(M04, "attended");
    await chooseOption(user, region, "Chris", "Attended");
    expect(await region.findByText("Attendance changed elsewhere")).toBeTruthy();
    expect(
      region.getByText(
        "Your change to Chris was not applied. The latest saved attendance is shown.",
      ),
    ).toBeTruthy();
    expect(select(region, "Drew").textContent).toBe("Attended");
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(tileValues(region)).toEqual(["4", "2", "1", "1"]);
    expect(api.view.members.find((m) => m.id === M03)?.attendance).toBe("not_recorded");

    // Choosing again starts from the latest revision, saves, and clears the warning.
    await chooseOption(user, region, "Chris", "Attended");
    await waitFor(() => {
      expect(region.queryByText("Attendance changed elsewhere")).toBeNull();
    });
    expect(api.attendanceRequests[1]).toMatchObject({ baseAttendanceRevision: 1 });
    expect(select(region, "Chris").textContent).toBe("Attended");
  });

  it("a conflict whose re-read fails reverts to the last known saved values and says why", async () => {
    const { user } = renderApp();
    const region = await panel();
    api.saveElsewhere(M04, "attended");
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.error()));
    await chooseOption(user, region, "Chris", "Attended");
    expect(await region.findByText("Attendance changed elsewhere")).toBeTruthy();
    expect(
      region.getByText(
        /^Your change to Chris was not applied\. The latest saved attendance could not be loaded: Could not reach the event API/,
      ),
    ).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(select(region, "Drew").textContent).toBe("Absent");
    expect(lockedStates(region)).toEqual([false, false, false, false]);
  });

  it("a lost response that was in fact saved is confirmed by one re-read", async () => {
    mswServer.use(
      http.put("/api/events/:eventId/attendance", () => {
        api.saveElsewhere(M03, "attended");
        return HttpResponse.error();
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    expect(await region.findByText("Chris was saved.")).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(tileValues(region)).toEqual(["4", "2", "2", "0"]);
    expect(lockedStates(region)).toEqual([false, false, false, false]);
    expect(useUiStore.getState().attendanceDirty).toBe(false);
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
    expect(await region.findByText("Chris was saved.")).toBeTruthy();
    expect(screen.queryByText(/attendance was not saved/i)).toBeNull();
    expect(await screen.findAllByText(/could not confirm the attendance save/i)).not.toHaveLength(
      0,
    );
  });

  it("a lost response that was not saved shows the latest saved values and a warning", async () => {
    mswServer.use(http.put("/api/events/:eventId/attendance", () => HttpResponse.error()));
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    expect(await region.findByText("Could not confirm the save")).toBeTruthy();
    expect(
      region.getByText(
        "Your change to Chris was not applied. The latest saved attendance is shown.",
      ),
    ).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(lockedStates(region)).toEqual([false, false, false, false]);
  });

  it("a failed re-read after a lost response keeps everything locked until Check again succeeds", async () => {
    let failReads = false;
    mswServer.use(
      http.get("/api/events/:eventId", () => (failReads ? HttpResponse.error() : undefined)),
      http.put("/api/events/:eventId/attendance", () => {
        api.saveElsewhere(M03, "attended");
        failReads = true;
        return HttpResponse.error();
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    expect(await region.findByText("Could not check the saved attendance")).toBeTruthy();
    expect(region.getByText(/Could not reach the event API/)).toBeTruthy();
    expect(region.queryByText("Could not confirm the save")).toBeNull();
    expect(lockedStates(region)).toEqual([true, true, true, true]);
    expect(useUiStore.getState().attendanceDirty).toBe(true);
    const briefing = within(screen.getByRole("region", { name: "Briefing" }));
    expect(briefing.getByRole<HTMLButtonElement>("button", { name: "Generate" }).disabled).toBe(
      true,
    );

    failReads = false;
    await user.click(region.getByRole("button", { name: "Check again" }));
    expect(await region.findByText("Chris was saved.")).toBeTruthy();
    expect(region.queryByText("Could not check the saved attendance")).toBeNull();
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(lockedStates(region)).toEqual([false, false, false, false]);
    expect(useUiStore.getState().attendanceDirty).toBe(false);
    expect(api.attendanceRequests).toHaveLength(0);
    // Check again unmounted with its banner: focus lands on a stable target, not <body>.
    await waitFor(() => {
      expect(document.activeElement).toBe(region.getByRole("heading", { name: "Attendance" }));
    });
  });

  it("keeps the Selectors locked during the lost-response check, with one re-read and one PUT", async () => {
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
    await waitFor(() => {
      expect(reads).toBe(1);
    });
    // The PUT has failed; the re-read is in flight. Nothing may be changed meanwhile.
    await act(() => delay(50));
    expect(lockedStates(region)).toEqual([true, true, true, true]);
    expect(region.getByText("Saving…")).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(await region.findByText("Could not confirm the save")).toBeTruthy();
    expect(lockedStates(region)).toEqual([false, false, false, false]);
    expect(puts).toBe(1);
    expect(reads).toBe(1);
  });

  it("a newer saved view replaces what is shown when nothing is saving", async () => {
    renderApp();
    const region = await panel();
    api.saveElsewhere(M04, "attended");
    refocus();
    await waitFor(() => {
      expect(select(region, "Drew").textContent).toBe("Attended");
    });
    expect(tileValues(region)).toEqual(["4", "2", "1", "1"]);
  });

  it("F2-10: every Selector is reachable and operable by keyboard; focus stays on it through the save", async () => {
    const release = holdSaves();
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
    await region.findByText("Saving…");
    // Locked through aria-disabled, never the disabled attribute: browsers drop focus from a
    // natively disabled button to <body> (jsdom keeps it, so the attribute itself is checked).
    expect(select(region, "Drew").disabled).toBe(false);
    expect(select(region, "Drew").getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(select(region, "Drew"));
    release();
    await toastShown("Attendance saved");
    await waitFor(() => {
      expect(isLocked(select(region, "Drew"))).toBe(false);
    });
    expect(document.activeElement).toBe(select(region, "Drew"));
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
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual(MEMBERS);
  });
});
