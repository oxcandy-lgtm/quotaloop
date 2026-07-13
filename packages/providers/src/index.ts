import type {
  ProviderActionOptions,
  ProviderActionResult,
  ProviderCapabilities,
  QuotaProvider,
  QuotaStatus,
} from "@quotaloop/contracts";
const unavailable = (providerId: string): QuotaStatus => ({
  providerId,
  state: "unavailable",
  origin: "local_cli",
  sessionRemainingPercent: null,
  weeklyRemainingPercent: null,
  resetsAt: null,
  observedAt: new Date().toISOString(),
  staleAfter: new Date(Date.now() + 300_000).toISOString(),
});

export class MockCodexProvider implements QuotaProvider {
  readonly id = "codex-demo";
  readonly displayName = "Codex Demo";
  readonly integrationLevel = "mock" as const;
  readonly capabilities: ProviderCapabilities = {
    installationDetection: false,
    authenticationDetection: true,
    quotaRead: true,
    resetTimeRead: true,
    localTaskExecution: true,
    nativeNotificationMetadata: true,
  };
  async detectInstallation() {
    return { installed: true, version: "demo" };
  }
  async getAuthStatus() {
    return { authenticated: true };
  }
  async getQuotaStatus(): Promise<QuotaStatus> {
    const now = Date.now();
    return {
      providerId: this.id,
      state: "mock",
      origin: "mock",
      sessionRemainingPercent: 72,
      weeklyRemainingPercent: 64,
      resetsAt: new Date(now + 7_200_000).toISOString(),
      observedAt: new Date(now).toISOString(),
      staleAfter: new Date(now + 3_600_000).toISOString(),
    };
  }
  async runAction(
    options: ProviderActionOptions,
  ): Promise<ProviderActionResult> {
    return {
      ok: true,
      providerId: this.id,
      completedAt: new Date().toISOString(),
      summary: `Demo ${options.mode} action completed`,
    };
  }
}

export class LocalCliProvider implements QuotaProvider {
  readonly integrationLevel = "detect_only" as const;
  readonly capabilities: ProviderCapabilities;
  constructor(
    readonly id: string,
    readonly displayName: string,
    detectable = false,
  ) {
    this.capabilities = {
      installationDetection: detectable,
      authenticationDetection: false,
      quotaRead: false,
      resetTimeRead: false,
      localTaskExecution: false,
      nativeNotificationMetadata: true,
    };
  }
  async detectInstallation() {
    return { installed: false, version: null };
  }
  async getAuthStatus() {
    return { authenticated: null };
  }
  async getQuotaStatus() {
    return unavailable(this.id);
  }
}

export const providerCatalog: QuotaProvider[] = [
  new MockCodexProvider(),
  new LocalCliProvider("codex", "Codex", true),
  new LocalCliProvider("claude-code", "Claude Code", true),
  new LocalCliProvider("gemini-cli", "Gemini CLI", true),
  new LocalCliProvider("cursor", "Cursor"),
  new LocalCliProvider("github-copilot", "GitHub Copilot"),
  new LocalCliProvider("opencode", "OpenCode", true),
  new LocalCliProvider("openrouter", "OpenRouter"),
];

export const serviceDefinitions = providerCatalog.map((provider) => ({
  serviceId: provider.id,
  displayName: provider.displayName,
  integrationLevel:
    provider.id === "openrouter"
      ? ("manual" as const)
      : provider.integrationLevel,
  supportsQuotaSurface:
    provider.capabilities.installationDetection ||
    provider.capabilities.quotaRead,
  supportsQuotaRead: provider.capabilities.quotaRead,
  supportsModelLab: true,
  supportsCatalog: true,
  supportsBenchmark:
    provider.integrationLevel === "mock" || provider.id === "openrouter",
  credentialMode:
    provider.integrationLevel === "mock"
      ? ("none" as const)
      : provider.id === "openrouter"
        ? ("api_key" as const)
        : ("unavailable" as const),
  capabilities: provider.capabilities,
}));

/**
 * The Rust detector supports this exact set of executable-backed providers.
 * Keeping the list derived from provider capabilities prevents the Popover
 * from maintaining a second hand-written detection registry.
 */
export const detectableServiceIds = serviceDefinitions
  .filter(
    (service) =>
      service.integrationLevel === "detect_only" &&
      service.capabilities?.installationDetection === true,
  )
  .map((service) => service.serviceId);

export const detectableServiceDefinitions = serviceDefinitions.filter(
  (service) =>
    service.integrationLevel === "detect_only" &&
    service.capabilities?.installationDetection === true,
);

/** Must stay byte-for-byte aligned with DETECTABLE_PROVIDER_IDS in Rust. */
export const rustDetectableProviderIds = [
  "codex",
  "claude-code",
  "gemini-cli",
  "opencode",
] as const;

export const detectableRegistryParity =
  JSON.stringify(detectableServiceIds.slice().sort()) ===
  JSON.stringify([...rustDetectableProviderIds].sort());
