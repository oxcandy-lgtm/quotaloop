import type { DesktopPersistentStateV2 } from "@quotaloop/contracts";
import { safeDefaultPolicy } from "./automation-controller";

const KEY = "quotaloop.desktop.v2";
export function defaultDesktopState(): DesktopPersistentStateV2 {
  return {
    schemaVersion: 2,
    preferences: {
      theme: "system",
      aiServices: [],
      credentials: [],
      notifications: { enabled: false, actionCompleted: true },
    },
    automationPolicy: safeDefaultPolicy(),
    executionHistory: [],
    modelLabPreferences: { selectedModelIds: [] },
    modelLabHistory: [],
    subscriptions: [],
  };
}
export class DesktopStateRepository {
  load(): DesktopPersistentStateV2 {
    const fallback = defaultDesktopState();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fallback;
      const value = JSON.parse(raw) as Partial<DesktopPersistentStateV2>;
      return {
        ...fallback,
        ...value,
        schemaVersion: 2,
        automationPolicy: value.automationPolicy ?? fallback.automationPolicy,
        executionHistory: Array.isArray(value.executionHistory)
          ? value.executionHistory
          : [],
        modelLabPreferences:
          value.modelLabPreferences ?? fallback.modelLabPreferences,
        modelLabHistory: Array.isArray(value.modelLabHistory)
          ? value.modelLabHistory
          : [],
        subscriptions: Array.isArray(value.subscriptions)
          ? value.subscriptions
          : [],
        preferences: value.preferences ?? fallback.preferences,
      };
    } catch {
      return fallback;
    }
  }
  save(state: DesktopPersistentStateV2) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  clear() {
    localStorage.removeItem(KEY);
  }
}
