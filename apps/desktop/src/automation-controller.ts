import {
  createIdempotencyKey,
  evaluateAutomation,
  runsOnLocalDay,
} from "@quotaloop/core";
import type {
  ExecutionRecord,
  QuotaProvider,
  QuotaAutomationPolicy,
} from "@quotaloop/contracts";
import { automationPolicySchema } from "@quotaloop/contracts";
import { MockCodexProvider } from "@quotaloop/providers";

export type DesktopHistory = ExecutionRecord;
export const POLICY_KEY = "quotaloop.desktop.policy";
export const HISTORY_KEY = "quotaloop.desktop.history";
export const NOTIFICATION_KEY = "quotaloop.desktop.notifications";
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
  remove: (key: string) => {
    if (typeof localStorage === "undefined") memory.delete(key);
    else localStorage.removeItem(key);
  },
};

export function safeDefaultPolicy(): QuotaAutomationPolicy {
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

export function loadPolicy(): QuotaAutomationPolicy {
  try {
    const value = JSON.parse(store.get(POLICY_KEY) ?? "null");
    const parsed = automationPolicySchema.safeParse(value);
    if (parsed.success) return parsed.data;
  } catch {
    /* use safe defaults */
  }
  return safeDefaultPolicy();
}
export function loadHistory(): DesktopHistory[] {
  try {
    const value = JSON.parse(store.get(HISTORY_KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (record): record is DesktopHistory =>
        record &&
        typeof record === "object" &&
        typeof record.id === "string" &&
        typeof record.providerId === "string" &&
        typeof record.startedAt === "string" &&
        typeof record.completedAt === "string" &&
        ["success", "blocked", "failed"].includes(record.outcome) &&
        typeof record.idempotencyKey === "string",
    );
  } catch {
    return [];
  }
}

export class DesktopAutomationController {
  private running = false;
  private readonly inFlightKeys = new Set<string>();
  constructor(
    private readonly provider: QuotaProvider = new MockCodexProvider(),
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
  resetToSafeDefaults(): {
    policy: QuotaAutomationPolicy;
    history: DesktopHistory[];
  } {
    const policy = safeDefaultPolicy();
    this.policy = policy;
    this.history = [];
    store.remove(POLICY_KEY);
    store.remove(HISTORY_KEY);
    store.remove(NOTIFICATION_KEY);
    store.remove("quotaloop.desktop.last-notification-event");
    return { policy, history: [] };
  }
  async evaluateAndRun(now = new Date(), manualOverride = false) {
    const key = createIdempotencyKey(
      this.provider.id,
      this.policy.actionMode,
      now,
    );
    if (
      this.inFlightKeys.has(key) ||
      this.history.some((record) => record.idempotencyKey === key)
    )
      return {
        decision: {
          allowed: false as const,
          reason: "duplicate_execution" as const,
        },
        eventKey: key,
      };
    this.inFlightKeys.add(key);
    try {
      const quota = await this.provider.getQuotaStatus();
      const auth = await this.provider.getAuthStatus();
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
        duplicate: false,
        running: this.running,
        manualOverride,
      });
      if (!decision.allowed) return { decision, eventKey: key };
      if (!this.provider.runAction)
        return {
          decision: {
            allowed: false as const,
            reason: "unsupported_action" as const,
          },
          eventKey: key,
        };
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
    } finally {
      this.inFlightKeys.delete(key);
    }
  }
}
