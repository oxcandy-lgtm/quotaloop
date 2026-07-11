import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
describe("App", () => {
    beforeEach(() => localStorage.clear());
    it("starts with privacy-conscious onboarding", () => {
        render(_jsx(MemoryRouter, { children: _jsx(App, {}) }));
        expect(screen.getByText("Welcome to QuotaLoop")).toBeInTheDocument();
        expect(screen.getByText("Automation remains off until you enable it.")).toBeInTheDocument();
    });
});
