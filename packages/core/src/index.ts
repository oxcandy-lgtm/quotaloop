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

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const validTime = (value: string) => TIME_RE.test(value);
function validTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
function localDateKey(date: Date, timeZone: string): string | null {
  if (!validTimeZone(timeZone)) return null;
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return values.year && values.month && values.day
    ? `${values.year}-${values.month}-${values.day}`
    : null;
}
function localMinutes(date: Date, timeZone: string): number | null {
  if (!validTimeZone(timeZone)) return null;
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(values.hour),
    minute = Number(values.minute);
  return Number.isInteger(hour) && Number.isInteger(minute)
    ? hour * 60 + minute
    : null;
}
function parsedMinutes(value: string): number | null {
  if (!validTime(value)) return null;
  const [hour = Number.NaN, minute = Number.NaN] = value.split(":").map(Number);
  return hour * 60 + minute;
}
function activeWindowContains(
  now: number,
  start: number,
  end: number,
): boolean {
  if (start === end) return true;
  if (end === 1440) return now >= start;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

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
  if (
    !Number.isFinite(new Date(quota.staleAfter).getTime()) ||
    new Date(quota.staleAfter) < input.now
  )
    return { allowed: false, reason: "stale_data" };
  if (input.running) return { allowed: false, reason: "execution_in_progress" };
  if (input.duplicate) return { allowed: false, reason: "duplicate_execution" };
  if (!input.manualOverride) {
    if (!policy.enabled) return { allowed: false, reason: "disabled" };
    if (policy.paused) return { allowed: false, reason: "paused" };
    if (
      policy.minimumRemainingPercent !== null &&
      quota.weeklyRemainingPercent !== null &&
      quota.weeklyRemainingPercent < policy.minimumRemainingPercent
    )
      return { allowed: false, reason: "weekly_threshold" };
    if (input.todayRuns >= policy.maximumRunsPerDay)
      return { allowed: false, reason: "daily_limit" };
  }
  const start = parsedMinutes(policy.activeHours.start),
    end = parsedMinutes(policy.activeHours.end),
    minutes = localMinutes(input.now, policy.activeHours.timeZone);
  if (start === null || end === null || minutes === null)
    return { allowed: false, reason: "outside_active_hours" };
  if (!input.manualOverride && !activeWindowContains(minutes, start, end))
    return { allowed: false, reason: "outside_active_hours" };
  return {
    allowed: true,
    reason: input.manualOverride ? "manual_override" : "quota_ready",
  };
}

export function createIdempotencyKey(
  providerId: string,
  mode: string,
  when: Date,
): string {
  return `${providerId}:${mode}:${when.toISOString().slice(0, 16)}`;
}

export function runsToday(records: ExecutionRecord[], now: Date): number {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const day = localDateKey(now, timeZone);
  if (!day) return 0;
  return records.filter(
    (record) =>
      localDateKey(new Date(record.startedAt), timeZone) === day &&
      record.outcome === "success",
  ).length;
}

export function runsOnLocalDay(
  records: ExecutionRecord[],
  now: Date,
  timeZone: string,
): number {
  const day = localDateKey(now, timeZone);
  if (!day) return 0;
  return records.filter(
    (record) =>
      localDateKey(new Date(record.startedAt), timeZone) === day &&
      record.outcome === "success",
  ).length;
}
