import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./app";

describe("Astryx spike", () => {
  it("renders Astryx components with contracts data and shows a toast", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Saturday Walk" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save attendance" }));
    expect(await screen.findByText("Attendance saved")).toBeTruthy();
  });
});
