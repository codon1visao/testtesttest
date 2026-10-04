import { expect, test } from "@playwright/test";

test("F7-15 / F3-10: notes from the feedback form reach the open coordinator page and become one automatic briefing", async ({
  page,
  context,
}) => {
  await page.goto("/events/E101");
  const briefing = page.getByRole("region", { name: "Briefing" });
  const feedback = page.getByRole("region", { name: "Feedback" });
  await expect(feedback.getByRole("link", { name: /Open feedback form \(test\)/ })).toBeVisible();

  const form = await context.newPage();
  await form.goto("/events/E101/feedback");
  for (const text of [
    "The water stop was perfect.",
    "More water stops, please.",
    "Shade at the rest stop would help.",
  ]) {
    await form.getByLabel("Your feedback").fill(text);
    await form.getByRole("button", { name: "Submit feedback" }).click();
    await expect(form.getByText("Thank you — your feedback was received.")).toBeVisible();
  }

  // No reload: the change stream (or the polling fallback) brings the notes and the batch states.
  await expect(feedback.getByText("Shade at the rest stop would help.")).toBeVisible();
  await expect(
    briefing.getByText(/^New feedback received \(3 notes\)\. Preparing an automatic briefing at /),
  ).toBeVisible();
  await expect(briefing.getByText("New automatic briefing ready to review.").first()).toBeVisible({
    timeout: 15_000,
  });

  // Nothing is being edited (after the walkthrough the saved briefing is open in its read view,
  // which offers Edit and no Save; run alone, no editor is open at all), so the automatic result
  // is offered, not opened (F7), and reviewing it never asks to discard a draft.
  await expect(briefing.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(briefing.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);

  // One batch for the three notes: the result read all eleven notes on the background lane.
  await briefing.getByRole("button", { name: "Review new preview" }).click();
  await expect(
    briefing
      .getByRole("list", { name: "Themes", exact: true })
      .first()
      .locator(":scope > li")
      .first()
      .getByText("Requests for more rest-break time (background, 11 notes).", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Discard and review" })).toHaveCount(0);
  // The reviewed preview is marked in the header until it is saved (spec 05, amended 2026-10-04).
  await expect(briefing.getByText("Unsaved preview", { exact: true })).toBeVisible();
});
