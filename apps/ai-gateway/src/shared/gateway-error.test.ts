import { GatewayErrorSchema } from "@event-desk/contracts/gateway-rpc";
import { describe, expect, it } from "vitest";
import { GatewayError } from "./gateway-error.js";

describe("GatewayError", () => {
  it("serialises to a wire body that satisfies the contract, without the cause", () => {
    const error = new GatewayError(
      "PROVIDER_RATE_LIMITED",
      "The provider is rate limiting requests.",
      {
        notSent: false,
        retryAfterMs: 2_000,
        cause: new Error("raw provider text"),
      },
    );
    const body = error.toBody();
    expect(GatewayErrorSchema.parse(body)).toEqual(body);
    expect(body).toEqual({
      code: "PROVIDER_RATE_LIMITED",
      message: "The provider is rate limiting requests.",
      notSent: false,
      retryAfterMs: 2_000,
    });
    expect(JSON.stringify(body)).not.toContain("raw provider text");
  });

  it("omits retryAfterMs when none is given", () => {
    const body = new GatewayError("PROVIDER_NOT_CONFIGURED", "No provider is configured.", {
      notSent: true,
    }).toBody();
    expect(body).toEqual({
      code: "PROVIDER_NOT_CONFIGURED",
      message: "No provider is configured.",
      notSent: true,
    });
  });
});
