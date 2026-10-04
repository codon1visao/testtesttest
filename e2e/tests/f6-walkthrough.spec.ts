import { expect, type Locator, type Page, test } from "@playwright/test";

// The supplied notes (packages/contracts/src/supplied-records.ts) and the evidence note
// (apps/web/src/features/feedback/source-disclosure.tsx), hard-coded: Playwright does not load
// workspace sources.
const F05 = "A longer rest break halfway would help.";
const F06 = "The rest stop felt rushed; a few more minutes would be good.";
const EVIDENCE_NOTE =
  "Sources show where wording came from; they don't prove it. Check before saving.";
const OUT_OF_DATE = "Out of date — attendance changed since this briefing was generated";
const PREVIEW_TITLE = "Generated preview — not saved as briefing";

const regions = (page: Page) => ({
  attendance: page.getByRole("region", { name: "Attendance" }),
  briefing: page.getByRole("region", { name: "Briefing" }),
});
// Theme 1 in the editor (read or edit view): the first item of the list named by its heading.
const themeItem = (briefing: Locator) =>
  briefing
    .getByRole("list", { name: "Themes", exact: true })
    .first()
    .locator(":scope > li")
    .first();
// The briefing header's actions (spec 2026-10-04): Edit and Generate, or Cancel and Save.
const action = (
  briefing: Locator,
  name: "Edit" | "Generate" | "Accept preview" | "Cancel" | "Save",
) => briefing.getByRole("button", { name, exact: true });
const editBriefing = (briefing: Locator) => action(briefing, "Edit").click();
// The editor's title is visually hidden (spec 05, amended 2026-10-04): it names the briefing and
// takes focus; the header's "Unsaved preview" badge is what marks a generated preview on screen.
const editorTitle = (briefing: Locator, name: string) =>
  briefing.getByRole("heading", { level: 3, name, exact: true });
const unsavedPreviewBadge = (briefing: Locator) =>
  briefing.getByText("Unsaved preview", { exact: true });
// One attendance count tile's value (F2): the <dd> of the tile whose <dt> is the label.
const tileValue = (attendance: Locator, label: string) =>
  attendance
    .getByLabel("Attendance counts")
    .locator(":scope > div")
    .filter({ has: attendance.page().locator("dt").getByText(label, { exact: true }) })
    .locator("dd");
const expectTiles = async (
  attendance: Locator,
  values: Record<"Registered" | "Attended" | "Absent" | "Not recorded", string>,
) => {
  for (const [label, value] of Object.entries(values)) {
    await expect(tileValue(attendance, label)).toHaveText(value);
  }
};

test("F6 example / F6-15: edit, save, change attendance, regenerate, replace", async ({ page }) => {
  await page.goto("/events/E101");
  const { attendance, briefing } = regions(page);

  // 1. Generate from the saved seed counts; this tab's result opens in the clean editor (F4 step 7).
  await expectTiles(attendance, {
    Registered: "4",
    Attended: "1",
    Absent: "2",
    "Not recorded": "1",
  });
  await action(briefing, "Generate").click();
  await expect(editorTitle(briefing, PREVIEW_TITLE)).toBeAttached();
  await expect(unsavedPreviewBadge(briefing)).toBeVisible();
  // A shown preview offers Accept preview in place of Generate (spec 05, amended 2026-10-04).
  await expect(action(briefing, "Accept preview")).toBeVisible();
  await expect(action(briefing, "Generate")).toHaveCount(0);

  // 2. Review Focus 5: inspect F05/F06 by keyboard while editing; the draft survives; save.
  await editBriefing(briefing);
  // Save or cancel first: Generate is not offered while the briefing is being edited.
  await expect(action(briefing, "Generate")).toHaveCount(0);
  const theme = briefing.getByLabel("Theme 1");
  await theme.fill("People asked for longer rest breaks.");
  const sources = themeItem(briefing).getByRole("button", { name: "Sources (2)" });
  await sources.focus();
  await page.keyboard.press("Enter");
  await expect(sources).toHaveAttribute("aria-expanded", "true");
  await expect(themeItem(briefing).getByText(F05)).toBeVisible();
  await expect(themeItem(briefing).getByText(F06)).toBeVisible();
  // F3 evidence limits: at the bottom of the opened sources view.
  await expect(themeItem(briefing).getByText(EVIDENCE_NOTE)).toBeVisible();
  await expect(theme).toHaveValue("People asked for longer rest breaks.");
  await action(briefing, "Save").click();
  await expect(editorTitle(briefing, "Saved briefing")).toBeAttached();
  await expect(unsavedPreviewBadge(briefing)).toHaveCount(0);

  await page.reload(); // F5-02: the wording and its references survive a reload
  const savedRow = themeItem(briefing);
  await expect(
    savedRow.getByText("People asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  // The row shows the wording only; activating it reveals the cited notes with their IDs.
  const savedRowButton = savedRow.getByRole("button", {
    name: "People asked for longer rest breaks.",
    exact: true,
  });
  await savedRowButton.click();
  await expect(savedRowButton).toHaveAttribute("aria-expanded", "true");
  await expect(savedRow.getByText("F05", { exact: true })).toBeVisible();
  await expect(savedRow.getByText("F06", { exact: true })).toBeVisible();
  await expect(savedRow.getByText(F05)).toBeVisible();
  await expect(savedRow.getByText(EVIDENCE_NOTE)).toBeVisible();

  // 3. An unsaved attendance change (by keyboard) shows saved → draft under an Unsaved badge and
  // does not touch the briefing: it stays up to date, with its wording.
  await expect(briefing.getByText(OUT_OF_DATE)).toHaveCount(0);
  const chris = attendance.getByRole("combobox", { name: "Chris" });
  // Chris is Not recorded: Enter opens the list on it, ArrowUp twice moves to Attended, Enter picks it.
  await chris.focus();
  await page.keyboard.press("Enter");
  await expect(attendance.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(chris).toHaveText("Attended");
  await expect(attendance.getByText("Unsaved", { exact: true })).toBeVisible();
  await expectTiles(attendance, {
    Registered: "4",
    Attended: "1 → 2",
    Absent: "2",
    "Not recorded": "1 → 0",
  });
  await expect(briefing.getByText(OUT_OF_DATE)).toHaveCount(0);
  await expect(
    themeItem(briefing).getByText("People asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();

  // 4. Save changes stores it: the saved counts update, the saved briefing becomes out of date,
  // and its wording and references stay.
  const attendanceSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/api/events/E101/attendance"),
  );
  await attendance.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await attendanceSaved).status()).toBe(200);
  await expectTiles(attendance, {
    Registered: "4",
    Attended: "2",
    Absent: "2",
    "Not recorded": "0",
  });
  await expect(attendance.getByText("Unsaved", { exact: true })).toHaveCount(0);
  // Save changes is disabled once clean: focus moves to the Attendance heading, not <body>.
  await expect(attendance.getByRole("heading", { name: "Attendance" })).toBeFocused();
  await expect(briefing.getByText(OUT_OF_DATE)).toBeVisible();
  await expect(briefing.getByText("Chris: Not recorded → Attended")).toBeVisible();
  await expect(
    themeItem(briefing).getByText("People asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();

  // 5. F6-12: saving edited wording keeps the stale flag, also after a reload.
  await editBriefing(briefing);
  await briefing.getByLabel("Theme 1").fill("Several people asked for longer rest breaks.");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/api/events/E101/briefing"),
  );
  await action(briefing, "Save").click();
  expect((await saved).status()).toBe(200);
  await expect(briefing.getByText("Unsaved changes to the briefing text.")).toHaveCount(0);
  await page.reload();
  await expect(
    themeItem(briefing).getByText("Several people asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  await expect(briefing.getByText(OUT_OF_DATE)).toBeVisible();

  // 6. F6 (amended 2026-10-04): Generate is not offered over unsaved text. Cancel (discarding the
  // draft) brings it back, and the saved wording is untouched.
  await editBriefing(briefing);
  await briefing.getByLabel("Theme 1").fill("Draft to discard before generating.");
  await expect(action(briefing, "Generate")).toHaveCount(0);
  await action(briefing, "Cancel").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(
    themeItem(briefing).getByText("Several people asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();

  // 7. Generate from the saved briefing's read view: the clean editor opens the new preview (F4
  // step 7). Inspect its sources, then Accept preview, which replaces the saved briefing.
  await action(briefing, "Generate").click();
  await expect(editorTitle(briefing, PREVIEW_TITLE)).toBeAttached();
  await expect(unsavedPreviewBadge(briefing)).toBeVisible();
  await expect(briefing.getByText("New briefing ready to review")).toHaveCount(0);
  const previewTheme = "Requests for more rest-break time (interactive, 8 notes).";
  await expect(themeItem(briefing).getByText(previewTheme, { exact: true })).toBeVisible();
  // Spec 05: the saved briefing stays available beside the preview, through the switch; switching
  // away from unsaved preview text asks first (F5-10).
  const briefingToShow = briefing.getByRole("radiogroup", { name: "Briefing to show" });
  await editBriefing(briefing);
  await briefing.getByLabel("Theme 1").fill("Preview wording to discard.");
  await briefingToShow.getByRole("radio", { name: "Saved briefing" }).click();
  await page.getByRole("button", { name: "Discard and switch" }).click();
  await expect(editorTitle(briefing, "Saved briefing")).toBeFocused();
  await expect(unsavedPreviewBadge(briefing)).toHaveCount(0);
  // On the saved briefing Generate is offered again; on the preview, Accept preview.
  await expect(action(briefing, "Generate")).toBeVisible();
  await expect(action(briefing, "Accept preview")).toHaveCount(0);
  // The hidden title sits inside its briefing (the article is positioned), so focusing it keeps
  // the briefing in view instead of scrolling the page to its top.
  const titleBox = await editorTitle(briefing, "Saved briefing").boundingBox();
  const articleBox = await briefing.getByRole("article", { name: "Saved briefing" }).boundingBox();
  expect(titleBox).not.toBeNull();
  expect(articleBox).not.toBeNull();
  if (titleBox !== null && articleBox !== null) {
    expect(titleBox.y).toBeGreaterThanOrEqual(articleBox.y - 1);
    expect(titleBox.x).toBeGreaterThanOrEqual(articleBox.x - 1);
  }
  await expect(
    themeItem(briefing).getByText("Several people asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  await briefingToShow.getByRole("radio", { name: "Generated preview" }).click();
  await expect(editorTitle(briefing, PREVIEW_TITLE)).toBeFocused();
  await expect(unsavedPreviewBadge(briefing)).toBeVisible();
  await expect(themeItem(briefing).getByText(previewTheme, { exact: true })).toBeVisible();
  // Clicking the theme row reveals its notes (spec 2026-10-04).
  await themeItem(briefing).getByRole("button").first().click();
  await expect(themeItem(briefing).getByText(F05)).toBeVisible();
  await expect(action(briefing, "Generate")).toHaveCount(0);
  // Accept preview keeps it unchanged as the saved briefing, replacing the earlier one.
  await action(briefing, "Accept preview").click();
  await expect(editorTitle(briefing, "Saved briefing")).toBeAttached();
  await expect(action(briefing, "Generate")).toBeVisible();
  await expect(unsavedPreviewBadge(briefing)).toHaveCount(0);
  // The new briefing is current: no freshness warning.
  await expect(briefing.getByText(OUT_OF_DATE)).toHaveCount(0);
  await expect(themeItem(briefing).getByText(previewTheme, { exact: true })).toBeVisible();
});
