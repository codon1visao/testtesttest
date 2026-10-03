import { describe, expect, it } from "vitest";
import { DEFAULT_NOTES, parseSimulateArgs, UsageError } from "./feedback-simulate-args.js";

const env = { PORT: "4000", ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173" };
const noFile = () => {
  throw new Error("no file expected");
};

describe("parseSimulateArgs (F3 script)", () => {
  it("defaults to five notes, 200 ms apart, to the local API with the coordinator origin", () => {
    expect(parseSimulateArgs([], env, noFile)).toEqual({
      count: 5,
      intervalMs: 200,
      texts: [...DEFAULT_NOTES],
      apiUrl: "http://127.0.0.1:4000",
      origin: "http://localhost:5173",
      eventId: "E101",
    });
  });

  it("reads options and a text file of one note per line", () => {
    const options = parseSimulateArgs(
      ["--count", "3", "--interval-ms", "0", "--text-file", "notes.txt"],
      env,
      () => "First.\n\n  \nSecond.\n",
    );
    expect(options).toMatchObject({ count: 3, intervalMs: 0, texts: ["First.", "Second."] });
  });

  it("P16: splits Windows line endings without keeping the carriage return", () => {
    const options = parseSimulateArgs(
      ["--text-file", "notes.txt"],
      env,
      () => "First.\r\nSecond.\r\n",
    );
    expect(options.texts).toEqual(["First.", "Second."]);
  });

  it("P16: an empty ALLOWED_ORIGINS falls back to the coordinator origin", () => {
    expect(parseSimulateArgs([], { ...env, ALLOWED_ORIGINS: "" }, noFile).origin).toBe(
      "http://localhost:5173",
    );
    expect(parseSimulateArgs([], { ...env, ALLOWED_ORIGINS: " ,x" }, noFile).origin).toBe(
      "http://localhost:5173",
    );
  });

  it.each([
    [["--count", "1e1"]],
    [["--count", "3.0"]],
    [["--count", " 3"]],
    [["--count", "0x3"]],
    [["--interval-ms", ""]],
    [["--count", "0"]],
    [["--count", "51"]],
    [["--count", "two"]],
    [["--interval-ms", "-1"]],
    [["--unknown"]],
  ])("rejects %j", (argv) => {
    expect(() => parseSimulateArgs(argv, env, noFile)).toThrow(UsageError);
  });

  it("rejects an empty text file and a note over 1,000 characters", () => {
    expect(() => parseSimulateArgs(["--text-file", "x"], env, () => "\n \n")).toThrow(UsageError);
    expect(() => parseSimulateArgs(["--text-file", "x"], env, () => "y".repeat(1_001))).toThrow(
      UsageError,
    );
  });
});
