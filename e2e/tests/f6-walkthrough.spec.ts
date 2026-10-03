import { expect, type Locator, type Page, test } from "@playwright/test";

// The supplied notes (packages/contracts/src/supplied-records.ts), hard-coded: Playwright does not
// load workspace sources.
const F05 = "A longer rest break halfway would help.";
const F06 = "The rest stop felt rushed; a few more minutes would be good.";

const regions = (page: Page) => ({
  attendance: page.getByRole("region", { name: "Attendance" }),
  briefing: page.getByRole("region", { name: "Briefing" }),
});
// `has` is matched inside each list item, so the inner locator starts from the page, not the region.
const themeItem = (page: Page, briefing: Locator) =>
  briefing.getByRole("listitem").filter({ has: page.getByLabel("Theme 1") });

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
  const theme = briefing.getByLabel("Theme 1");
  await theme.fill("People asked for longer rest breaks.");
  const readF05 = themeItem(page, briefing).getByRole("button", { name: "Read source F05" });
  await readF05.focus();
  await page.keyboard.press("Enter");
  await expect(readF05).toHaveAttribute("aria-expanded", "true");
  await expect(themeItem(page, briefing).getByText(F05)).toBeVisible();
  await themeItem(page, briefing).getByRole("button", { name: "Read source F06" }).press("Enter");
  await expect(themeItem(page, briefing).getByText(F06)).toBeVisible();
  await expect(theme).toHaveValue("People asked for longer rest breaks.");
  await briefing.getByRole("button", { name: "Save briefing" }).click();
  await expect(
    briefing.getByRole("heading", { name: /^Saved briefing · last saved / }),
  ).toBeVisible();

  await page.reload(); // F5-02: the wording and its references survive a reload
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("People asked for longer rest breaks.");
  await expect(
    themeItem(page, briefing).getByRole("button", { name: "Read source F05" }),
  ).toBeVisible();
  await expect(
    themeItem(page, briefing).getByRole("button", { name: "Read source F06" }),
  ).toBeVisible();

  // 3. An unsaved attendance change shows unsaved counts and a warning, and does not touch the
  // briefing.
  const overview = briefing.getByLabel("Attendance overview");
  const originalOverview = await overview.inputValue();
  await attendance.getByLabel("Chris").selectOption("attended");
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
  await expect(overview).toHaveValue(originalOverview);

  // 4. Saving attendance marks the saved briefing out of date; wording and references stay.
  await attendance.getByRole("button", { name: "Save attendance" }).click();
  await expect(
    attendance.getByText("Saved counts: 4 registered · 2 attended · 2 absent · 0 not recorded"),
  ).toBeVisible();
  await expect(
    briefing.getByText("Out of date — attendance changed since this briefing was generated"),
  ).toBeVisible();
  await expect(briefing.getByText("Chris: Not recorded → Attended")).toBeVisible();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue("People asked for longer rest breaks.");
  // The original overview stays intact: saving attendance never rewrites briefing wording.
  await expect(overview).toHaveValue(originalOverview);

  // 5. F6-12: saving edited wording keeps the stale flag, also after a reload.
  await briefing.getByLabel("Theme 1").fill("Several people asked for longer rest breaks.");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && response.url().endsWith("/api/events/E101/briefing"),
  );
  await briefing.getByRole("button", { name: "Save briefing" }).click();
  expect((await saved).status()).toBe(200);
  await expect(briefing.getByText("Unsaved changes to the briefing text.")).toHaveCount(0);
  await page.reload();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue(
    "Several people asked for longer rest breaks.",
  );
  await expect(
    briefing.getByText("Out of date — attendance changed since this briefing was generated"),
  ).toBeVisible();

  // 6. F6-09: Generate with unsaved text; the result waits as incoming and the draft is untouched.
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
  await expect(briefing.getByLabel("Theme 1")).toHaveValue(
    "Requests for more rest-break time (interactive, 8 notes).",
  );
  // Spec 05: the saved briefing stays available beside the preview, through the switch; switching
  // away from unsaved preview text asks first (F5-10).
  const briefingToShow = briefing.getByRole("radiogroup", { name: "Briefing to show" });
  await briefing.getByLabel("Theme 1").fill("Preview wording to discard.");
  await briefingToShow.getByRole("radio", { name: "Saved briefing" }).click();
  await page.getByRole("button", { name: "Discard and switch" }).click();
  await expect(
    briefing.getByRole("heading", { name: /^Saved briefing · last saved / }),
  ).toBeFocused();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue(
    "Several people asked for longer rest breaks.",
  );
  await briefingToShow.getByRole("radio", { name: "Generated preview" }).click();
  await expect(
    briefing.getByRole("heading", { name: "Generated preview — not saved as briefing" }),
  ).toBeFocused();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue(
    "Requests for more rest-break time (interactive, 8 notes).",
  );
  await themeItem(page, briefing).getByRole("button", { name: "Read source F05" }).click();
  await expect(themeItem(page, briefing).getByText(F05)).toBeVisible();
  await briefing.getByRole("button", { name: "Save and replace briefing" }).click();
  await expect(
    briefing.getByRole("heading", { name: /^Saved briefing · last saved / }),
  ).toBeVisible();
  await expect(
    briefing.getByText("Up to date with the saved attendance and feedback."),
  ).toBeVisible();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue(
    "Requests for more rest-break time (interactive, 8 notes).",
  );
});
