import {
  createIdempotencyKey,
  evaluateAutomation,
  runsOnLocalDay,
} from "@quotaloop/core";
import type {
  ExecutionRecord,
  QuotaAutomationPolicy,
} from "@quotaloop/contracts";
import { MockCodexProvider } from "@quotaloop/providers";

export type DesktopHistory = ExecutionRecord;
export const POLICY_KEY = "quotaloop.desktop.policy";
export const HISTORY_KEY = "quotaloop.desktop.history";
const memory = new Map<string, string>();
const store = {
  get: (key: string) =>
    typeof localStorage === "undefined"
      ? (memory.get(key) ?? null)
      : localStorage.getItem(key),
  set: (key: string, value: string) => {
    if (typeof localStorage === "undefined") memory.set(key, value);
    else localStorage.setItem(key, value);
  },
};

export function loadPolicy(): QuotaAutomationPolicy {
  try {
    const value = JSON.parse(store.get(POLICY_KEY) ?? "null");
    if (value && typeof value === "object")
      return value as QuotaAutomationPolicy;
  } catch {
    /* use safe defaults */
  }
  return {
    enabled: false,
    paused: false,
    actionMode: "minimal",
    maximumRunsPerDay: 2,
    minimumRemainingPercent: 40,
    activeHours: {
      start: "00:00",
      end: "24:00",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    targetProviders: ["codex-demo"],
  };
}
export function loadHistory(): DesktopHistory[] {
  try {
    return JSON.parse(store.get(HISTORY_KEY) ?? "[]") as DesktopHistory[];
  } catch {
    return [];
  }
}

export class DesktopAutomationController {
  private running = false;
  constructor(
    private readonly provider = new MockCodexProvider(),
    private history: DesktopHistory[] = loadHistory(),
    private policy: QuotaAutomationPolicy = loadPolicy(),
  ) {}
  get currentPolicy() {
    return this.policy;
  }
  get records() {
    return this.history;
  }
  setPolicy(policy: QuotaAutomationPolicy) {
    this.policy = policy;
    store.set(POLICY_KEY, JSON.stringify(policy));
  }
  async evaluateAndRun(now = new Date(), manualOverride = false) {
    const quota = await this.provider.getQuotaStatus();
    const auth = await this.provider.getAuthStatus();
    const key = createIdempotencyKey(
      this.provider.id,
      this.policy.actionMode,
      now,
    );
    const decision = evaluateAutomation({
      policy: this.policy,
      quota,
      authenticated: auth.authenticated,
      canRun: true,
      now,
      todayRuns: runsOnLocalDay(
        this.history,
        now,
        this.policy.activeHours.timeZone,
      ),
      duplicate: this.history.some((record) => record.idempotencyKey === key),
      running: this.running,
      manualOverride,
    });
    if (!decision.allowed) return { decision, eventKey: key };
    this.running = true;
    try {
      const result = await this.provider.runAction({
        mode: this.policy.actionMode,
        idempotencyKey: key,
        timeoutMs: 30_000,
      });
      const record: DesktopHistory = {
        id: crypto.randomUUID(),
        providerId: result.providerId,
        startedAt: now.toISOString(),
        completedAt: result.completedAt,
        outcome: result.ok ? "success" : "failed",
        reason: result.summary,
        idempotencyKey: key,
      };
      this.history = [record, ...this.history].slice(0, 50);
      store.set(HISTORY_KEY, JSON.stringify(this.history));
      return { decision, eventKey: key, record };
    } finally {
      this.running = false;
    }
  }
}
