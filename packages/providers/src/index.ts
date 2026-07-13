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
    installationDetection: true,
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
  readonly capabilities: ProviderCapabilities = {
    installationDetection: true,
    authenticationDetection: false,
    quotaRead: false,
    resetTimeRead: false,
    localTaskExecution: false,
    nativeNotificationMetadata: true,
  };
  constructor(
    readonly id: string,
    readonly displayName: string,
  ) {}
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
  new LocalCliProvider("codex", "Codex"),
  new LocalCliProvider("claude-code", "Claude Code"),
  new LocalCliProvider("gemini-cli", "Gemini CLI"),
  new LocalCliProvider("cursor", "Cursor"),
  new LocalCliProvider("github-copilot", "GitHub Copilot"),
  new LocalCliProvider("opencode", "OpenCode"),
  new LocalCliProvider("openrouter", "OpenRouter"),
];

export const serviceDefinitions = providerCatalog.map((provider) => ({
  serviceId: provider.id,
  displayName: provider.displayName,
  integrationLevel: provider.integrationLevel,
  supportsQuotaSurface: provider.capabilities.quotaRead,
  supportsModelLab: true,
  supportsCatalog: true,
  supportsBenchmark: provider.integrationLevel === "mock",
  credentialMode:
    provider.integrationLevel === "mock"
      ? ("none" as const)
      : ("unavailable" as const),
  capabilities: provider.capabilities,
}));
