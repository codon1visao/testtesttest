import { expect, type Locator, type Page, test } from "@playwright/test";

// The supplied notes (packages/contracts/src/supplied-records.ts), hard-coded: Playwright does not
// load workspace sources.
const F05 = "A longer rest break halfway would help.";
const F06 = "The rest stop felt rushed; a few more minutes would be good.";

const regions = (page: Page) => ({
  attendance: page.getByRole("region", { name: "Attendance" }),
  briefing: page.getByRole("region", { name: "Briefing" }),
});
// Theme 1 in the editor (read or edit view): the first item of the list named by its heading.
const themeItem = (briefing: Locator) =>
  briefing.getByRole("list", { name: "Which themes recur" }).first().locator(":scope > li").first();
const editBriefing = (briefing: Locator) =>
  briefing.getByRole("button", { name: "Edit briefing" }).click();

test("F6 example / F6-15: edit, save, change attendance, regenerate, replace", async ({ page }) => {
  await page.goto("/events/E101");
  const { attendance, briefing } = regions(page);

  // 1. Generate from the saved seed counts; this tab's result opens in the clean editor (F4 step 7).
  await expect(
    attendance.getByText("Saved counts: 4 registered · 1 attended · 2 absent · 1 not recorded"),
  ).toBeVisible();
  await briefing.getByRole("button", { name: "Generate briefing" }).click();
  await expect(
    briefing.getByRole("heading", { name: "Generated preview — not saved as briefing" }),
  ).toBeVisible();
  await expect(briefing.getByText(/References identify the source notes/)).toBeVisible();

  // 2. Review Focus 5: inspect F05/F06 by keyboard while editing; the draft survives; save.
  await editBriefing(briefing);
  const theme = briefing.getByLabel("Theme 1");
  await theme.fill("People asked for longer rest breaks.");
  const sources = themeItem(briefing).getByRole("button", { name: "Sources (2)" });
  await sources.focus();
  await page.keyboard.press("Enter");
  await expect(sources).toHaveAttribute("aria-expanded", "true");
  await expect(themeItem(briefing).getByText(F05)).toBeVisible();
  await expect(themeItem(briefing).getByText(F06)).toBeVisible();
  await expect(theme).toHaveValue("People asked for longer rest breaks.");
  await briefing.getByRole("button", { name: "Save briefing" }).click();
  await expect(
    briefing.getByRole("heading", { name: /^Saved briefing · last saved / }),
  ).toBeVisible();

  await page.reload(); // F5-02: the wording and its references survive a reload
  const savedRow = themeItem(briefing);
  await expect(
    savedRow.getByText("People asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  // The cited IDs are badges in the row's own button; the closed disclosure holds the notes' IDs too.
  const savedRowButton = savedRow.getByRole("button").first();
  await expect(savedRowButton.getByText("F05", { exact: true })).toBeVisible();
  await expect(savedRowButton.getByText("F06", { exact: true })).toBeVisible();

  // 3. An unsaved attendance change shows unsaved counts and a warning, and does not touch the
  // briefing.
  const overview = briefing.getByText(/^4 registered members: /).first();
  const originalOverview = (await overview.textContent()) ?? "";
  await attendance.getByRole("combobox", { name: "Chris" }).click();
  await attendance.getByRole("option", { name: "Attended" }).click();
  await expect(
    attendance.getByText("Unsaved counts: 4 registered · 2 attended · 2 absent · 0 not recorded"),
  ).toBeVisible();
  await expect(
    attendance.getByText(
      "Unsaved attendance changes. Save or discard them before generating a briefing.",
    ),
  ).toBeVisible();
  await expect(
    briefing.getByText("Up to date with the saved attendance and feedback."),
  ).toBeVisible();
  await expect(overview).toHaveText(originalOverview);

  // 4. Saving attendance marks the saved briefing out of date; wording and references stay.
  await attendance.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    attendance.getByText("Saved counts: 4 registered · 2 attended · 2 absent · 0 not recorded"),
  ).toBeVisible();
  await expect(
    briefing.getByText("Out of date — attendance changed since this briefing was generated"),
  ).toBeVisible();
  await expect(briefing.getByText("Chris: Not recorded → Attended")).toBeVisible();
  await expect(
    themeItem(briefing).getByText("People asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  // The original overview stays intact: saving attendance never rewrites briefing wording.
  await expect(overview).toHaveText(originalOverview);

  // 5. F6-12: saving edited wording keeps the stale flag, also after a reload.
  await editBriefing(briefing);
  await briefing.getByLabel("Theme 1").fill("Several people asked for longer rest breaks.");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/api/events/E101/briefing"),
  );
  await briefing.getByRole("button", { name: "Save briefing" }).click();
  expect((await saved).status()).toBe(200);
  await expect(briefing.getByText("Unsaved changes to the briefing text.")).toHaveCount(0);
  await page.reload();
  await expect(
    themeItem(briefing).getByText("Several people asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  await expect(
    briefing.getByText("Out of date — attendance changed since this briefing was generated"),
  ).toBeVisible();

  // 6. F6-09: Generate with unsaved text; the result waits as incoming and the draft is untouched.
  await editBriefing(briefing);
  await briefing.getByLabel("Theme 1").fill("Draft that must survive generation.");
  await briefing.getByRole("button", { name: "Generate briefing" }).click();
  await expect(briefing.getByText("New briefing ready to review")).toBeVisible();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("Draft that must survive generation.");

  // 7. Review it (explicitly discarding the draft), inspect its sources, then Save and replace.
  await briefing.getByRole("button", { name: "Review new preview" }).click();
  await page.getByRole("button", { name: "Discard and review" }).click();
  await expect(
    briefing.getByRole("heading", { name: "Generated preview — not saved as briefing" }),
  ).toBeVisible();
  const previewTheme = "Requests for more rest-break time (interactive, 8 notes).";
  await expect(themeItem(briefing).getByText(previewTheme, { exact: true })).toBeVisible();
  // Spec 05: the saved briefing stays available beside the preview, through the switch; switching
  // away from unsaved preview text asks first (F5-10).
  const briefingToShow = briefing.getByRole("radiogroup", { name: "Briefing to show" });
  await editBriefing(briefing);
  await briefing.getByLabel("Theme 1").fill("Preview wording to discard.");
  await briefingToShow.getByRole("radio", { name: "Saved briefing" }).click();
  await page.getByRole("button", { name: "Discard and switch" }).click();
  await expect(
    briefing.getByRole("heading", { name: /^Saved briefing · last saved / }),
  ).toBeFocused();
  await expect(
    themeItem(briefing).getByText("Several people asked for longer rest breaks.", { exact: true }),
  ).toBeVisible();
  await briefingToShow.getByRole("radio", { name: "Generated preview" }).click();
  await expect(
    briefing.getByRole("heading", { name: "Generated preview — not saved as briefing" }),
  ).toBeFocused();
  await expect(themeItem(briefing).getByText(previewTheme, { exact: true })).toBeVisible();
  // Clicking the theme row reveals its notes (spec 2026-10-04).
  await themeItem(briefing).getByRole("button").first().click();
  await expect(themeItem(briefing).getByText(F05)).toBeVisible();
  await briefing.getByRole("button", { name: "Save and replace briefing" }).click();
  await expect(
    briefing.getByRole("heading", { name: /^Saved briefing · last saved / }),
  ).toBeVisible();
  await expect(
    briefing.getByText("Up to date with the saved attendance and feedback."),
  ).toBeVisible();
  await expect(themeItem(briefing).getByText(previewTheme, { exact: true })).toBeVisible();
});
