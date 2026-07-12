import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());
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
  it("does not claim a desktop agent or local detection in standalone web mode", () => {
    localStorage.setItem(
      "quotaloop.v1",
      JSON.stringify({
        schemaVersion: 1,
        policy: {
          enabled: false,
          paused: false,
          actionMode: "minimal",
          maximumRunsPerDay: 2,
          minimumRemainingPercent: 40,
          activeHours: { start: "08:00", end: "24:00", timeZone: "UTC" },
          targetProviders: ["codex"],
        },
        history: [],
        subscriptions: [],
        theme: "system",
        onboardingComplete: true,
        notifications: {
          webEnabled: false,
          desktopEnabled: false,
          actionCompleted: true,
          testNotification: true,
        },
      }),
    );
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("Desktop agent not connected")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Agent ready")).not.toBeInTheDocument();
    expect(screen.queryByText("Detected")).not.toBeInTheDocument();
  });
  it("opens provider help from a functional accessible control", async () => {
    localStorage.setItem(
      "quotaloop.v1",
      JSON.stringify({
        schemaVersion: 1,
        policy: {
          enabled: false,
          paused: false,
          actionMode: "minimal",
          maximumRunsPerDay: 2,
          minimumRemainingPercent: 40,
          activeHours: { start: "08:00", end: "24:00", timeZone: "UTC" },
          targetProviders: ["codex"],
        },
        history: [],
        subscriptions: [],
        theme: "system",
        onboardingComplete: true,
        notifications: {
          webEnabled: false,
          desktopEnabled: false,
          actionCompleted: true,
          testNotification: true,
        },
      }),
    );
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const help = screen.getByRole("button", { name: "Help for Codex" });
    fireEvent.click(help);
    await waitFor(() =>
      expect(screen.getByText("Codex Demo help")).toBeInTheDocument(),
    );
  });
  it("persists notification preference after explicit user action", async () => {
    localStorage.setItem(
      "quotaloop.v1",
      JSON.stringify({
        schemaVersion: 1,
        policy: {
          enabled: false,
          paused: false,
          actionMode: "minimal",
          maximumRunsPerDay: 2,
          minimumRemainingPercent: 40,
          activeHours: { start: "08:00", end: "24:00", timeZone: "UTC" },
          targetProviders: ["codex"],
        },
        history: [],
        subscriptions: [],
        theme: "system",
        onboardingComplete: true,
        notifications: {
          webEnabled: false,
          desktopEnabled: false,
          actionCompleted: true,
          testNotification: true,
        },
      }),
    );
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: Object.assign(function Notification() {}, {
        permission: "granted",
        requestPermission: async () => "granted",
      }),
    });
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getAllByRole("link", { name: "Settings" })[0]!);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("quotaloop.v1") ?? "{}").notifications
          .webEnabled,
      ).toBe(true),
    );
  });
});
