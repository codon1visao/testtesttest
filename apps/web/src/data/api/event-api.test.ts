import { EventIdSchema, MemberIdSchema, type SaveAttendanceRequest } from "@event-desk/contracts";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { apiErrorResponse, FakeEventApi } from "../../testing/fake-event-api";
import { mswServer } from "../../testing/msw-server";
import { ApiError } from "../http/api-error";
import { fetchEvent, saveAttendance } from "./event-api";

const E101 = EventIdSchema.parse("E101");
const signal = () => new AbortController().signal;
let api: FakeEventApi;

const failureOf = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
};

beforeEach(() => {
  api = new FakeEventApi();
  mswServer.use(...api.handlers());
});

describe("fetchEvent", () => {
  it("returns the contract-validated event view", async () => {
    const view = await fetchEvent(E101, signal());
    expect(view.event.name).toBe("Saturday Walk");
    expect(view.counts).toEqual({ registered: 4, attended: 1, absent: 2, notRecorded: 1 });
  });

  it("turns an API error body into an http ApiError with its code", async () => {
    const error = await failureOf(fetchEvent(EventIdSchema.parse("E999"), signal()));
    expect(error).toMatchObject({ kind: "http", status: 404, code: "EVENT_NOT_FOUND" });
  });

  it("rejects a response that breaks the contract as invalid-response", async () => {
    mswServer.use(
      http.get("/api/events/:eventId", () => HttpResponse.json({ event: { id: "E101" } })),
    );
    expect(await failureOf(fetchEvent(E101, signal()))).toMatchObject({ kind: "invalid-response" });
  });

  it("reports an unreachable API as a network error", async () => {
    mswServer.use(http.get("/api/events/:eventId", () => HttpResponse.error()));
    expect(await failureOf(fetchEvent(E101, signal()))).toMatchObject({
      kind: "network",
      outcomeUnknown: true,
    });
  });

  it("reports a gateway error without a contract body (e.g. a proxy 502 page) as a network error", async () => {
    mswServer.use(
      http.get(
        "/api/events/:eventId",
        () => new HttpResponse("<html>Bad gateway</html>", { status: 502 }),
      ),
    );
    const error = await failureOf(fetchEvent(E101, signal()));
    expect(error).toMatchObject({
      kind: "network",
      status: 502,
      code: undefined,
      outcomeUnknown: true,
    });
  });

  it.each([503, 504])("reports a bare %i gateway answer as a network error", async (status) => {
    mswServer.use(http.get("/api/events/:eventId", () => new HttpResponse(null, { status })));
    expect(await failureOf(fetchEvent(E101, signal()))).toMatchObject({
      kind: "network",
      status,
      outcomeUnknown: true,
    });
  });

  it("keeps a contract-body 503 as an http error with its code and message", async () => {
    mswServer.use(
      http.get("/api/events/:eventId", () =>
        apiErrorResponse(503, "STORE_UNAVAILABLE", "The event store is unavailable."),
      ),
    );
    const error = await failureOf(fetchEvent(E101, signal()));
    expect(error).toMatchObject({
      kind: "http",
      status: 503,
      code: "STORE_UNAVAILABLE",
      outcomeUnknown: false,
    });
    expect(error.message).toBe("The event store is unavailable.");
  });

  it("reports any other non-contract error body without a code", async () => {
    mswServer.use(
      http.get(
        "/api/events/:eventId",
        () => new HttpResponse("<html>Oops</html>", { status: 500 }),
      ),
    );
    const error = await failureOf(fetchEvent(E101, signal()));
    expect(error).toMatchObject({ kind: "http", status: 500, code: undefined });
    expect(error.message).toBe("The event API answered with status 500.");
  });

  it("reports an aborted request as a network error", async () => {
    mswServer.use(
      http.get("/api/events/:eventId", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    const controller = new AbortController();
    const pending = failureOf(fetchEvent(E101, controller.signal));
    controller.abort();
    expect(await pending).toMatchObject({ kind: "network" });
  });
});

describe("saveAttendance", () => {
  const body = (base = 0): SaveAttendanceRequest => ({
    baseAttendanceRevision: base,
    members: api.view.members.map((m) => ({
      id: m.id,
      attendance: m.id === "M03" ? "attended" : m.attendance,
    })),
  });

  it("sends the body and returns the contract-validated response", async () => {
    const saved = await saveAttendance(E101, body());
    expect(saved.counts).toEqual({ registered: 4, attended: 2, absent: 2, notRecorded: 0 });
    expect(api.attendanceRequests).toEqual([body()]);
  });

  it("checks the full roster before the revision, as the service does", async () => {
    api.saveElsewhere(MemberIdSchema.parse("M04"), "attended");
    const partial = { ...body(0), members: body(0).members.slice(0, 3) };
    expect(await failureOf(saveAttendance(E101, partial))).toMatchObject({
      kind: "http",
      status: 400,
      code: "VALIDATION_FAILED",
      field: "members",
    });
  });

  it("surfaces a conflict as http 409 ATTENDANCE_CONFLICT", async () => {
    api.saveElsewhere(MemberIdSchema.parse("M04"), "attended");
    expect(await failureOf(saveAttendance(E101, body(0)))).toMatchObject({
      kind: "http",
      status: 409,
      code: "ATTENDANCE_CONFLICT",
    });
  });
});
