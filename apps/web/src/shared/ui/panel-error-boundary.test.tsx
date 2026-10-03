import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { PanelErrorBoundary } from "./panel-error-boundary";

function Broken(): never {
  throw new Error("render bug");
}

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined); // React logs caught render errors
});
afterEach(() => {
  consoleError.mockRestore();
});

describe("PanelErrorBoundary", () => {
  it("contains a failing panel and keeps its siblings", () => {
    render(
      <Theme theme={neutralTheme}>
        <PanelErrorBoundary name="Feedback">
          <Broken />
        </PanelErrorBoundary>
        <p>Attendance still here</p>
      </Theme>,
    );
    expect(screen.getByText("Feedback could not be displayed")).toBeTruthy();
    expect(screen.getByText("Attendance still here")).toBeTruthy();
  });
});
