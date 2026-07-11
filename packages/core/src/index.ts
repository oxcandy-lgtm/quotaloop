import type {
  ExecutionRecord,
  QuotaAutomationPolicy,
  QuotaStatus,
} from "@quotaloop/contracts";

export type AutomationBlockReason =
  | "disabled"
  | "paused"
  | "provider_unavailable"
  | "quota_unknown"
  | "auth_expired"
  | "weekly_threshold"
  | "outside_active_hours"
  | "daily_limit"
  | "duplicate_execution"
  | "execution_in_progress"
  | "unsupported_action"
  | "stale_data";
export type AutomationDecision =
  | { allowed: true; reason: "quota_ready" | "manual_override" }
  | { allowed: false; reason: AutomationBlockReason };

export function defaultAutomationPolicy(
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): QuotaAutomationPolicy {
  return {
    enabled: false,
    paused: false,
    actionMode: "minimal",
    maximumRunsPerDay: 2,
    minimumRemainingPercent: 40,
    activeHours: { start: "08:00", end: "24:00", timeZone },
    targetProviders: ["codex"],
  };
}

export function evaluateAutomation(input: {
  policy: QuotaAutomationPolicy;
  quota: QuotaStatus;
  authenticated: boolean | null;
  canRun: boolean;
  now: Date;
  todayRuns: number;
  duplicate: boolean;
  running: boolean;
  manualOverride?: boolean;
}): AutomationDecision {
  const { policy, quota } = input;
  if (input.manualOverride && input.canRun)
    return { allowed: true, reason: "manual_override" };
  if (!policy.enabled) return { allowed: false, reason: "disabled" };
  if (policy.paused) return { allowed: false, reason: "paused" };
  if (!input.canRun) return { allowed: false, reason: "unsupported_action" };
  if (input.authenticated === false)
    return { allowed: false, reason: "auth_expired" };
  if (["unavailable", "not_installed", "unsupported"].includes(quota.state))
    return { allowed: false, reason: "provider_unavailable" };
  if (
    quota.sessionRemainingPercent === null &&
    quota.weeklyRemainingPercent === null
  )
    return { allowed: false, reason: "quota_unknown" };
  if (new Date(quota.staleAfter) < input.now)
    return { allowed: false, reason: "stale_data" };
  if (
    policy.minimumRemainingPercent !== null &&
    quota.weeklyRemainingPercent !== null &&
    quota.weeklyRemainingPercent < policy.minimumRemainingPercent
  )
    return { allowed: false, reason: "weekly_threshold" };
  if (input.running) return { allowed: false, reason: "execution_in_progress" };
  if (input.duplicate) return { allowed: false, reason: "duplicate_execution" };
  if (input.todayRuns >= policy.maximumRunsPerDay)
    return { allowed: false, reason: "daily_limit" };
  const minutes = input.now.getHours() * 60 + input.now.getMinutes();
  const parse = (value: string) => {
    const [h = 0, m = 0] = value.split(":").map(Number);
    return h * 60 + m;
  };
  if (
    minutes < parse(policy.activeHours.start) ||
    minutes >= parse(policy.activeHours.end)
  )
    return { allowed: false, reason: "outside_active_hours" };
  return { allowed: true, reason: "quota_ready" };
}

export function createIdempotencyKey(
  providerId: string,
  mode: string,
  when: Date,
): string {
  return `${providerId}:${mode}:${when.toISOString().slice(0, 16)}`;
}

export function runsToday(records: ExecutionRecord[], now: Date): number {
  const day = now.toISOString().slice(0, 10);
  return records.filter(
    (record) =>
      record.startedAt.startsWith(day) && record.outcome === "success",
  ).length;
}
