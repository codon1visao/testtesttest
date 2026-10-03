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

  // E101 starts with no briefing, so no editor is open: the automatic result is shown read-only
  // and offered for review, never opened on its own (F7).
  await expect(
    briefing.getByRole("heading", { name: "New preview (not yet reviewed)" }),
  ).toBeVisible();
  await expect(briefing.getByLabel("Theme 1")).toHaveCount(0);

  // One batch for the three notes: the result read all eleven notes on the background lane.
  await briefing.getByRole("button", { name: "Review new preview" }).click();
  await expect(briefing.getByLabel("Theme 1")).toHaveValue(
    "Requests for more rest-break time (background, 11 notes).",
  );
  // Nothing was being edited, so reviewing never asked to discard a draft.
  await expect(page.getByRole("button", { name: "Discard and review" })).toHaveCount(0);
});
