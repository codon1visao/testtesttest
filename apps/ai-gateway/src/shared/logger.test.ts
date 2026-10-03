import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString("utf8"));
      done();
    },
  });
  return { lines, logger: createLogger("info", destination) };
}

describe("createLogger", () => {
  it("S1-08: redacts credentials, source notes and model output if they are ever passed", () => {
    const { lines, logger } = capture();
    logger.info(
      {
        auth: "the-service-secret",
        request: { auth: "the-service-secret", input: { feedback: [{ id: "F01", text: "note" }] } },
        result: { sections: { feedbackSummary: { text: "model output" } } },
        provider: { apiKey: "sk-live" },
      },
      "request",
    );
    const line = lines.join("");
    for (const secret of ["the-service-secret", "note", "model output", "sk-live"]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('"service":"ai-gateway"');
  });
});
