import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
const failOn = { sql: "" };

vi.mock("mysql2/promise", () => ({
  createConnection: () =>
    Promise.resolve({
      query: (sql: string) => {
        queries.push(sql);
        return sql.startsWith(failOn.sql) ? Promise.reject(new Error("boom")) : Promise.resolve([]);
      },
      end: () => Promise.resolve(),
    }),
}));
vi.mock("ioredis", () => ({
  Redis: class {
    on(): this {
      return this;
    }
    connect(): Promise<void> {
      return Promise.resolve();
    }
    disconnect(): void {
      return undefined;
    }
  },
}));
vi.mock("../integrations/delete-keys-by-prefix.js", () => ({
  deleteKeysByPrefix: () => Promise.reject(new Error("redis went away")),
}));

const { ResetIncompleteError, resetStore } = await import("./reset-store.js");

const options = {
  mysqlUrl: "mysql://u:p@127.0.0.1:3306/event_desk",
  redisUrl: "redis://127.0.0.1:6379/0",
  healthUrl: "http://127.0.0.1:4000/api/health",
  isApiRunning: () => Promise.resolve(false),
};

describe("resetStore failures after the database may have been dropped", () => {
  beforeEach(() => {
    queries.length = 0;
  });

  it("says the reset did not finish when CREATE DATABASE fails after the DROP", async () => {
    failOn.sql = "CREATE DATABASE";
    const error: unknown = await resetStore(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResetIncompleteError);
    expect((error as Error).message).toMatch(
      /did not finish.*"event_desk".*dropped.*pnpm db:reset again/,
    );
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(queries[0]).toMatch(/^DROP DATABASE/);
  });

  it("says the reset did not finish when deleting Redis keys fails", async () => {
    failOn.sql = "never";
    const error: unknown = await resetStore(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResetIncompleteError);
    expect((error as Error).message).toContain("redis went away");
  });
});
