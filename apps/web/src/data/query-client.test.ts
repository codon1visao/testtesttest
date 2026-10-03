import { describe, expect, it } from "vitest";
import { ApiError } from "./http/api-error";
import { createQueryClient, type MutationToastMeta, type ToastMessage } from "./query-client";

function run(meta: MutationToastMeta, outcome: "success" | ApiError) {
  const toasts: ToastMessage[] = [];
  const client = createQueryClient((toast) => toasts.push(toast));
  const mutation = client.getMutationCache().build(client, {
    mutationFn: () => (outcome === "success" ? Promise.resolve("ok") : Promise.reject(outcome)),
    meta,
  });
  return mutation.execute(undefined).then(
    () => toasts,
    () => toasts,
  );
}

describe("mutation toast policy (T1)", () => {
  it("shows exactly one success toast", async () => {
    expect(await run({ successToast: "Attendance saved" }, "success")).toEqual([
      { type: "info", body: "Attendance saved" },
    ]);
  });

  it("shows exactly one error toast with the reason", async () => {
    const error = new ApiError("http", "The event store is unavailable.", {
      status: 503,
      code: "STORE_UNAVAILABLE",
    });
    expect(await run({ errorToast: "Attendance was not saved" }, error)).toEqual([
      { type: "error", body: "Attendance was not saved: The event store is unavailable." },
    ]);
  });

  it("does not claim failure when the outcome is unknown", async () => {
    const meta = {
      errorToast: "Attendance was not saved",
      unknownOutcomeToast: "Could not confirm the save.",
    };
    expect(await run(meta, new ApiError("network", "x"))).toEqual([
      { type: "error", body: "Could not confirm the save." },
    ]);
  });

  it("stays silent for mutations without toast metadata", async () => {
    expect(await run({}, "success")).toEqual([]);
  });
});
