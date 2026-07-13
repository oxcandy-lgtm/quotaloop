import { describe, expect, it } from "vitest";
import { detectableServiceIds, serviceDefinitions } from "./index";

const rustDetectableProviderIds = [
  "codex",
  "claude-code",
  "gemini-cli",
  "opencode",
] as const;

describe("provider detection registry", () => {
  it("keeps the TypeScript registry in parity with the Rust executable allowlist", () => {
    expect(detectableServiceIds).toEqual([...rustDetectableProviderIds]);
    expect(
      serviceDefinitions
        .filter(
          (service) =>
            service.integrationLevel === "detect_only" &&
            service.capabilities?.installationDetection,
        )
        .map((service) => service.serviceId),
    ).toEqual([...rustDetectableProviderIds]);
  });

  it("separates quota surface visibility from quota reads", () => {
    const codex = serviceDefinitions.find(
      (service) => service.serviceId === "codex",
    );
    expect(codex?.supportsQuotaSurface).toBe(true);
    expect(codex?.supportsQuotaRead).toBe(false);
    expect(codex?.capabilities?.quotaRead).toBe(false);
  });
});
