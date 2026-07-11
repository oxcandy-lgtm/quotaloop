import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  beforeEach(() => localStorage.clear());
  it("starts with privacy-conscious onboarding", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("Welcome to QuotaLoop")).toBeInTheDocument();
    expect(
      screen.getByText("Automation remains off until you enable it."),
    ).toBeInTheDocument();
  });
});
