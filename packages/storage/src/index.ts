import {
  automationPolicySchema,
  type ExecutionRecord,
  type QuotaAutomationPolicy,
  type Subscription,
} from "@quotaloop/contracts";
export interface AppData {
  schemaVersion: 1;
  policy: QuotaAutomationPolicy;
  history: ExecutionRecord[];
  subscriptions: Subscription[];
  theme: "light" | "dark" | "system";
  onboardingComplete: boolean;
}
export class LocalStorageRepository {
  constructor(private readonly key = "quotaloop.v1") {}
  load(fallback: AppData): AppData {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return fallback;
      const value = JSON.parse(raw) as AppData;
      return {
        ...fallback,
        ...value,
        schemaVersion: 1,
        policy: automationPolicySchema.parse(value.policy),
      };
    } catch {
      return fallback;
    }
  }
  save(data: AppData) {
    localStorage.setItem(this.key, JSON.stringify(data));
  }
  clear() {
    localStorage.removeItem(this.key);
  }
  export(data: AppData) {
    return JSON.stringify(data, null, 2);
  }
}
