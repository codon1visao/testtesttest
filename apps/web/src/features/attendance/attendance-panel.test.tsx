import { MemberIdSchema } from "@event-desk/contracts";
import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../state/ui-store";
import { apiErrorResponse, FakeEventApi } from "../../testing/fake-event-api";
import { commonAncestor } from "../../testing/dom";
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
const saveButton = (region: Region) =>
  region.getByRole<HTMLButtonElement>("button", { name: /^Save changes/ });
const discardButton = (region: Region) =>
  region.getByRole<HTMLButtonElement>("button", { name: "Discard" });
const heading = (region: Region) => region.getByRole("heading", { name: "Attendance" });
/**
 * Locked for input: Astryx keeps a Selector with a disabled message focusable through
 * aria-disabled, so a trigger never drops keyboard focus to <body> when it locks.
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

describe("attendance panel", () => {
  it("F2-01: shows each member's saved status and the saved counts; nothing to save or discard", async () => {
    renderApp();
    const region = await panel();
    expect(select(region, "Alex").textContent).toBe("Attended");
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(tileValues(region)).toEqual(["4", "1", "2", "1"]);
    expect(saveButton(region).disabled).toBe(true);
    expect(discardButton(region).disabled).toBe(true);
  });

  it("F2 counts: four labelled cells; changed ones show saved → draft under an Unsaved badge until Discard", async () => {
    const { user } = renderApp();
    const region = await panel();
    const counts = region.getByLabelText("Attendance counts");
    expect(counts.tagName).toBe("DL");
    // Announced as a whole: the badge and every label with its value, not a bare "1 → 2".
    const live = counts.closest("[aria-live]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.getAttribute("aria-atomic")).toBe("true");
    expect(
      Array.from(counts.children).map((tile) => tile.querySelector("dt")?.textContent),
    ).toEqual(["Registered", "Attended", "Absent", "Not recorded"]);
    expect(tileValues(region)).toEqual(["4", "1", "2", "1"]);
    expect(region.queryByText("Unsaved")).toBeNull();

    await chooseOption(user, region, "Chris", "Attended");
    expect(tileValues(region)).toEqual(["4", "1 → 2", "2", "1 → 0"]);
    expect(region.getByText("Unsaved")).toBeTruthy();

    await user.click(discardButton(region));
    expect(tileValues(region)).toEqual(["4", "1", "2", "1"]);
    expect(region.queryByText("Unsaved")).toBeNull();
  });

  it("the Unsaved and Saving… badges sit in the card header, beside the heading, announced politely", async () => {
    const release = holdSaves();
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    const unsaved = region.getByText("Unsaved");
    const header = commonAncestor(heading(region), unsaved);
    const counts = region.getByLabelText("Attendance counts");
    expect(header.contains(counts)).toBe(false);
    expect(unsaved.closest("[aria-live='polite']")).not.toBeNull();
    // The strip's own live region still announces the counts as a whole.
    expect(unsaved.closest("[aria-live]")).not.toBe(counts.closest("[aria-live]"));
    await user.click(saveButton(region));
    const saving = await region.findByText("Saving…");
    expect(commonAncestor(heading(region), saving).contains(counts)).toBe(false);
    release();
    await toastShown("Attendance saved");
  });

  it("Discard and Save changes form one row of their own after the table", async () => {
    renderApp();
    const region = await panel();
    const row = commonAncestor(discardButton(region), saveButton(region));
    expect(within(row).getAllByRole("button")).toHaveLength(2);
    const table = region.getByRole("table", { name: "Member attendance" });
    expect(row.contains(table)).toBe(false);
    expect(table.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers exactly the three states, labelled Not recorded (not Absent)", async () => {
    const { user } = renderApp();
    const region = await panel();
    await user.click(select(region, "Chris"));
    const options = region.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Attended", "Absent", "Not recorded"]);
  });

  it("F2-02: a change only updates the draft: unsaved counts, Generate blocked, no request", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await act(() => delay(50));
    expect(api.attendanceRequests).toHaveLength(0);
    expect(tileValues(region)).toEqual(["4", "1 → 2", "2", "1 → 0"]);
    expect(useUiStore.getState().attendanceDirty).toBe(true);
    // The badge and the Generate status say it; there is no separate warning line.
    expect(region.queryByText(/unsaved attendance changes/i)).toBeNull();
  });

  it("Discard and Save changes sit after the table, Discard first, enabled only while there are changes", async () => {
    const { user } = renderApp();
    const region = await panel();
    const table = region.getByRole("table", { name: "Member attendance" });
    expect(
      table.compareDocumentPosition(discardButton(region)) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      discardButton(region).compareDocumentPosition(saveButton(region)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await chooseOption(user, region, "Chris", "Attended");
    expect(saveButton(region).disabled).toBe(false);
    expect(discardButton(region).disabled).toBe(false);
    await user.click(discardButton(region));
    expect(saveButton(region).disabled).toBe(true);
    expect(discardButton(region).disabled).toBe(true);

    await chooseOption(user, region, "Chris", "Attended");
    await user.click(saveButton(region));
    await waitFor(() => {
      expect(saveButton(region).disabled).toBe(true);
    });
    expect(discardButton(region).disabled).toBe(true);
  });

  it("F2-03: Save changes sends all members in one request with the draft's base revision", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(saveButton(region));
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
      expect(tileValues(region)).toEqual(["4", "2", "2", "0"]);
    });
    expect(region.queryByText("Unsaved")).toBeNull();
    expect(useUiStore.getState().attendanceDirty).toBe(false);
    // Save changes is disabled once clean: focus moves to the heading instead of <body>.
    await waitFor(() => {
      expect(document.activeElement).toBe(heading(region));
    });
  });

  it("discards back to the saved values without asking (explicit action)", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(discardButton(region));
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(tileValues(region)).toEqual(["4", "1", "2", "1"]);
    expect(region.queryByText("Unsaved")).toBeNull();
    expect(useUiStore.getState().attendanceDirty).toBe(false);
  });

  it("moves focus to the Attendance heading after a keyboard Discard (the button disables)", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    act(() => {
      discardButton(region).focus();
    });
    await user.keyboard("{Enter}");
    expect(select(region, "Chris").textContent).toBe("Not recorded");
    expect(document.activeElement).toBe(heading(region));
  });

  it("while saving: Saving… shows, and the Selectors and both buttons are locked", async () => {
    const release = holdSaves();
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(saveButton(region));
    expect(await region.findByText("Saving…")).toBeTruthy();
    expect(lockedStates(region)).toEqual([true, true, true, true]);
    expect(isLocked(saveButton(region))).toBe(true);
    expect(isLocked(discardButton(region))).toBe(true);
    release();
    await toastShown("Attendance saved");
    await waitFor(() => {
      expect(region.queryByText("Saving…")).toBeNull();
    });
    expect(lockedStates(region)).toEqual([false, false, false, false]);
  });

  it("after a save, focus stays where the user moved it outside Attendance", async () => {
    const release = holdSaves();
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(saveButton(region));
    await region.findByText("Saving…");
    const elsewhere = within(screen.getByRole("region", { name: "Feedback" })).getByRole("link", {
      name: /Open feedback form/,
    });
    act(() => {
      elsewhere.focus();
    });
    release();
    await toastShown("Attendance saved");
    await waitFor(() => {
      expect(saveButton(region).disabled).toBe(true);
    });
    await act(() => delay(50));
    expect(document.activeElement).toBe(elsewhere);
  });

  it("Save changes stays focusable while saving, ignores repeated keys, and keeps focus after a failure", async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<undefined>();
    let puts = 0;
    mswServer.use(
      http.put("/api/events/:eventId/attendance", async () => {
        puts += 1;
        await gate;
        return apiErrorResponse(503, "STORE_UNAVAILABLE", "Busy.");
      }),
    );
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    act(() => {
      saveButton(region).focus();
    });
    await user.keyboard("{Enter}");
    await region.findByText("Saving…");
    // aria-disabled, never the disabled attribute: browsers drop focus from a natively disabled
    // button to <body> (jsdom keeps it, so the attribute itself is checked).
    expect(saveButton(region).disabled).toBe(false);
    expect(saveButton(region).getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(saveButton(region));
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    release(undefined);
    expect(await region.findByText("Busy.")).toBeTruthy();
    expect(puts).toBe(1);
    expect(document.activeElement).toBe(saveButton(region));
  });

  it("a locked Selector keeps focus and ignores the keyboard while a save is in flight", async () => {
    const release = holdSaves();
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    await user.click(saveButton(region));
    await region.findByText("Saving…");
    // Locked through aria-disabled, never the disabled attribute: browsers drop focus from a
    // natively disabled button to <body> (jsdom keeps it, so the attribute itself is checked).
    expect(select(region, "Drew").disabled).toBe(false);
    expect(select(region, "Drew").getAttribute("aria-disabled")).toBe("true");
    act(() => {
      select(region, "Drew").focus();
    });
    await user.keyboard("{Enter}");
    await user.keyboard("A");
    expect(region.queryByRole("listbox")).toBeNull();
    expect(select(region, "Drew").textContent).toBe("Absent");
    expect(document.activeElement).toBe(select(region, "Drew"));
    release();
    await toastShown("Attendance saved");
    expect(select(region, "Drew").textContent).toBe("Absent");
    expect(api.attendanceRequests).toHaveLength(1);
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
    await user.click(saveButton(region));
    expect(
      await region.findByText("The event store is unavailable. Try again shortly."),
    ).toBeTruthy();
    expect(region.getByText("Attendance was not saved")).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(saveButton(region).disabled).toBe(false);
    // The toast text is also announced through Astryx's screen-reader live region, so it occurs
    // twice.
    expect(await screen.findAllByText(/^Attendance was not saved:/)).not.toHaveLength(0);
  });

  it("explains a conflict, keeps the draft, and reloads only after confirmation", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    api.saveElsewhere(M04, "attended");
    await user.click(saveButton(region));
    expect(await region.findByText("Attendance changed elsewhere")).toBeTruthy();
    expect(region.getByText(/saved elsewhere/i)).toBeTruthy();
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
      expect(document.activeElement).toBe(heading(region));
    });
  });

  it("keeps the draft and the conflict explanation when the confirmed reload fails", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    api.saveElsewhere(M04, "attended");
    await user.click(saveButton(region));
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
    await user.click(saveButton(region));
    expect(await region.findByText(/saved elsewhere/i)).toBeTruthy();
    await waitFor(() => {
      // The saved counts moved on (Drew attended elsewhere) under the unchanged draft.
      expect(tileValue(region, "Attended")).toBe("2");
      expect(tileValue(region, "Absent")).toBe("1 → 2");
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
      // The saved counts moved on (Drew attended elsewhere) under the unchanged draft.
      expect(tileValue(region, "Attended")).toBe("2");
      expect(tileValue(region, "Absent")).toBe("1 → 2");
    });
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(select(region, "Drew").textContent).toBe("Absent");
    await user.click(saveButton(region));
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
      expect(tileValue(region, "Attended")).toBe("2");
      expect(tileValue(region, "Absent")).toBe("1 → 2");
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
    await user.click(saveButton(region));
    expect(await region.findByText("Your attendance changes were saved.")).toBeTruthy();
    expect(region.queryByText("Unsaved")).toBeNull();
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
    await user.click(saveButton(region));
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
    await user.click(saveButton(region));
    expect(await region.findByText("Could not confirm the save")).toBeTruthy();
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(region.getByText("Unsaved")).toBeTruthy();
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
    await user.click(saveButton(region));
    expect(await region.findByText("Could not check the saved records")).toBeTruthy();
    expect(region.getByText(/your selections are kept/i)).toBeTruthy();
    expect(region.queryByText(/do not match your selections/i)).toBeNull();
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(region.getByText("Unsaved")).toBeTruthy();
  });

  it("keeps inputs and both buttons locked during the lost-response check, with one re-read and one PUT", async () => {
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
    await user.click(saveButton(region));
    await waitFor(() => {
      expect(reads).toBe(1);
    });
    // The PUT has failed; the re-read is in flight. Nothing may be edited or saved meanwhile.
    await act(() => delay(50));
    expect(lockedStates(region)).toEqual([true, true, true, true]);
    expect(isLocked(saveButton(region))).toBe(true);
    expect(isLocked(discardButton(region))).toBe(true);
    await user.click(saveButton(region));
    expect(await region.findByText("Could not confirm the save")).toBeTruthy();
    expect(isLocked(select(region, "Chris"))).toBe(false);
    expect(select(region, "Chris").textContent).toBe("Attended");
    expect(puts).toBe(1);
    expect(reads).toBe(1);
  });

  it("sends one request for a double-clicked Save changes", async () => {
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
    await user.dblClick(saveButton(region));
    expect(isLocked(select(region, "Alex"))).toBe(true);
    await region.findByText("Busy.");
    expect(api.attendanceRequests).toHaveLength(1);
  });

  it("F2-10: every control is reachable and operable by keyboard, in visual order", async () => {
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
    expect(document.activeElement).toBe(discardButton(region));
    await user.tab();
    expect(document.activeElement).toBe(saveButton(region));
    await user.keyboard("{Enter}");
    await toastShown("Attendance saved");
    await waitFor(() => {
      expect(document.activeElement).toBe(heading(region));
    });
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

  it("warns before leaving while attendance is unsaved", async () => {
    const { user } = renderApp();
    const region = await panel();
    await chooseOption(user, region, "Chris", "Attended");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
