import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  Gauge,
  Pause,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { MockCodexProvider } from "@quotaloop/providers";
import type {
  AIServicePreference,
  ExecutionRecord,
  QuotaAutomationPolicy,
} from "@quotaloop/contracts";
import { automationPolicySchema } from "@quotaloop/contracts";
import { loadHistory, loadPolicy } from "./automation-controller";
import { resolveDesktopSurface } from "./surface";
import { shouldDeliverNotification } from "./notification-controller";
import { ProviderStatus } from "@quotaloop/ui";
import { DesktopAuthority } from "./desktop-authority";
import "./styles.css";

type PopoverTab = "quota" | "modelLab";

type DetectionState =
  | "installed"
  | "not_installed"
  | "timeout"
  | "failed"
  | "unsupported"
  | "not_checked";
type Detection = {
  provider_id: string;
  state: DetectionState;
  version?: string | null;
};
type History = ExecutionRecord;
const providers = [
  { id: "codex", name: "Codex" },
  { id: "claude-code", name: "Claude Code" },
  { id: "gemini-cli", name: "Gemini CLI" },
  { id: "opencode", name: "OpenCode" },
];
const demo = new MockCodexProvider();
const defaultServicePreferences = (): AIServicePreference[] =>
  providers.map((provider) => ({
    serviceId: provider.id,
    enabled: true,
    visibleInQuota: true,
    visibleInModelLab: true,
    allowCatalogAccess: true,
    allowBenchmarkRequests: provider.id === "codex",
    favorite: provider.id === "codex",
  }));
function PopoverApp() {
  const [detections, setDetections] = useState<Record<string, Detection>>(() =>
    Object.fromEntries(
      providers.map((p) => [p.id, { provider_id: p.id, state: "not_checked" }]),
    ),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<PopoverTab>("quota");
  const [modelLabStatus, setModelLabStatus] = useState<
    "idle" | "running" | "completed"
  >("idle");
  const [servicePreferences, setServicePreferences] = useState<
    AIServicePreference[]
  >(() => {
    try {
      return (
        JSON.parse(
          localStorage.getItem("quotaloop.desktop.ai-services") ?? "null",
        ) ?? defaultServicePreferences()
      );
    } catch {
      return defaultServicePreferences();
    }
  });
  const [history, setHistory] = useState<History[]>(
    () => loadHistory() as History[],
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [policy, setPolicyState] = useState<QuotaAutomationPolicy>(() =>
    loadPolicy(),
  );
  const policyRef = useRef(policy);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () =>
      (
        JSON.parse(
          localStorage.getItem("quotaloop.desktop.notifications") ??
            '{"enabled":false,"actionCompleted":true}',
        ) as { enabled: boolean }
      ).enabled,
  );
  const [notificationPermission, setNotificationPermission] = useState<
    "unknown" | "granted" | "denied" | "unavailable"
  >("unknown");
  const authorityRef = useRef(new DesktopAuthority(demo));
  const controllerRef = useRef(authorityRef.current.controller);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          return await invoke<Detection>("detect_provider", {
            providerId: provider.id,
          });
        } catch {
          return { provider_id: provider.id, state: "failed" as const };
        }
      }),
    );
    setDetections(
      Object.fromEntries(results.map((result) => [result.provider_id, result])),
    );
    void invoke("broadcast_provider_state", { providers: results });
    setRefreshing(false);
  }, []);
  const updatePolicy = (next: QuotaAutomationPolicy) => {
    policyRef.current = next;
    controllerRef.current.setPolicy(next);
    setPolicyState(next);
    void invoke("broadcast_policy_state", { policy: next });
  };
  const togglePause = async () => {
    const next = await invoke<boolean>("set_automation_paused", {
      paused: !policyRef.current.paused,
    });
    updatePolicy({ ...policyRef.current, paused: next });
  };
  const resetLocalData = () => {
    setModelLabStatus("idle");
    const result = authorityRef.current.reset();
    policyRef.current = result.policy;
    setPolicyState(result.policy);
    setHistory([]);
    setServicePreferences(defaultServicePreferences());
    setNotice("Local data cleared; automation is OFF.");
    void invoke("broadcast_policy_state", { policy: result.policy });
    void invoke("broadcast_history_state", { history: [] });
    void invoke("broadcast_service_preferences", {
      preferences: defaultServicePreferences(),
    });
  };
  const runModelLab = () => {
    setModelLabStatus("running");
    void authorityRef.current.modelLab
      .run(
        async () =>
          new Promise<void>((resolve) => window.setTimeout(resolve, 250)),
      )
      .then((result) => {
        if (result === "completed") setModelLabStatus("completed");
        else if (result === "discarded") setModelLabStatus("idle");
      });
  };
  const updateServicePreference = (preference: AIServicePreference) => {
    const next = servicePreferences.map((item) =>
      item.serviceId === preference.serviceId ? preference : item,
    );
    setServicePreferences(next);
    localStorage.setItem("quotaloop.desktop.ai-services", JSON.stringify(next));
    void invoke("broadcast_service_preferences", { preferences: next });
  };
  useEffect(() => {
    void isPermissionGranted()
      .then((granted) =>
        setNotificationPermission(granted ? "granted" : "denied"),
      )
      .catch(() => setNotificationPermission("unavailable"));
  }, []);
  useEffect(() => {
    void refresh();
    const refreshUnlisten = listen("refresh-providers", () => void refresh());
    const pauseUnlisten = listen<boolean>(
      "automation-state-changed",
      (event) => {
        setPolicyState((current) => {
          const next = { ...current, paused: event.payload };
          policyRef.current = next;
          controllerRef.current.setPolicy(next);
          return next;
        });
      },
    );
    const pauseRequestUnlisten = listen(
      "automation-pause-requested",
      () => void togglePause(),
    );
    const policyRequestUnlisten = listen<unknown>(
      "automation-policy-requested",
      (event) => {
        const parsed = automationPolicySchema.safeParse(event.payload);
        if (parsed.success) updatePolicy(parsed.data);
      },
    );
    const clearDataUnlisten = listen(
      "clear-local-data-requested",
      resetLocalData,
    );
    const modelLabUnlisten = listen("model-lab-run-requested", runModelLab);
    const servicePreferenceUnlisten = listen<AIServicePreference>(
      "service-preference-requested",
      (event) => updateServicePreference(event.payload),
    );
    return () => {
      void refreshUnlisten.then((unlisten) => unlisten());
      void pauseUnlisten.then((unlisten) => unlisten());
      void pauseRequestUnlisten.then((unlisten) => unlisten());
      void policyRequestUnlisten.then((unlisten) => unlisten());
      void clearDataUnlisten.then((unlisten) => unlisten());
      void modelLabUnlisten.then((unlisten) => unlisten());
      void servicePreferenceUnlisten.then((unlisten) => unlisten());
    };
  }, [refresh]);
  useEffect(() => {
    authorityRef.current.setOnRecord(async (eventKey) => {
      setHistory(controllerRef.current.records as History[]);
      void invoke("broadcast_history_state", {
        history: controllerRef.current.records,
      });
      await refresh();
      void notifyCompletion(eventKey);
    });
    authorityRef.current.start();
    return () => {
      authorityRef.current.stop();
    };
  }, [refresh]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") authorityRef.current.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const runDemo = async () => {
    setNotice(null);
    const result = await authorityRef.current.runManual(new Date());
    if (result.record) {
      setHistory(controllerRef.current.records as History[]);
      void invoke("broadcast_history_state", {
        history: controllerRef.current.records,
      });
      await notifyCompletion(result.eventKey);
    } else setNotice(`Demo blocked: ${result.decision.reason}`);
  };
  const notifyCompletion = async (eventKey: string) => {
    const prefs = JSON.parse(
      localStorage.getItem("quotaloop.desktop.notifications") ??
        '{"enabled":false,"actionCompleted":true}',
    ) as { enabled: boolean; actionCompleted: boolean };
    try {
      if (
        !shouldDeliverNotification({
          preferences: prefs,
          permission: await isPermissionGranted(),
          eventKey,
          lastEventKey: localStorage.getItem(
            "quotaloop.desktop.last-notification-event",
          ),
        })
      )
        return;
      await sendNotification({
        title: "QuotaLoop demo action complete",
        body: "Synthetic provider action completed locally.",
      });
      localStorage.setItem(
        "quotaloop.desktop.last-notification-event",
        eventKey,
      );
    } catch {
      setNotice("Native notification permission is unavailable.");
    }
  };
  const testNotification = async () => {
    try {
      let permission = await isPermissionGranted();
      if (!permission) permission = (await requestPermission()) === "granted";
      setNotificationPermission(permission ? "granted" : "denied");
      if (permission)
        await sendNotification({
          title: "QuotaLoop test notification",
          body: "Native notifications are configured.",
        });
      else setNotice("Native notification permission was denied.");
    } catch {
      setNotificationPermission("unavailable");
      setNotice("Native notifications are unavailable in this environment.");
    }
  };
  const toggleNotifications = () => {
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    localStorage.setItem(
      "quotaloop.desktop.notifications",
      JSON.stringify({ enabled: next, actionCompleted: true }),
    );
  };
  return (
    <main className="popover">
      <header className="tab-header">
        <div className="tab-list" role="tablist" aria-label="QuotaLoop views">
          <button
            role="tab"
            aria-selected={activeTab === "quota"}
            className={activeTab === "quota" ? "tab active" : "tab"}
            onClick={() => setActiveTab("quota")}
          >
            QUOTA
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "modelLab"}
            className={activeTab === "modelLab" ? "tab active" : "tab"}
            onClick={() => setActiveTab("modelLab")}
          >
            MODEL LAB
          </button>
        </div>
        <button
          className="settings-tab"
          aria-label="Settings"
          onClick={() => void invoke("open_dashboard", { section: "settings" })}
        >
          <Settings />
        </button>
      </header>
      {activeTab === "modelLab" ? (
        <ModelLabPopover status={modelLabStatus} />
      ) : (
        <>
          <section className="provider demo-provider">
            <div>
              <b>Codex Demo</b>
              <span>DEMO</span>
            </div>
            <p>
              <label>
                Session <strong>72%</strong>
              </label>
              <i>
                <em style={{ width: "72%" }} />
              </i>
            </p>
            <p>
              <label>
                Weekly <strong>64%</strong>
              </label>
              <i>
                <em style={{ width: "64%" }} />
              </i>
            </p>
            <small>Quota values are synthetic demo data.</small>
          </section>
          <div className="provider-list">
            {providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                detection={detections[provider.id]!}
              />
            ))}
          </div>
          <section className="automation">
            <div>
              <span>AUTOMATION</span>
              <strong>
                <Pause />
                {policy.paused
                  ? "Paused"
                  : policy.enabled
                    ? "Enabled"
                    : "Off by default"}
              </strong>
            </div>
            <small>Only the synthetic Demo action can run in this beta.</small>
          </section>
          {notice && (
            <p role="status" className="notice">
              <ShieldCheck />
              {notice}
            </p>
          )}
          <nav>
            <button onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw />
              {refreshing ? "Checking…" : "Refresh"}
            </button>
            <button onClick={() => void runDemo()}>
              <Play />
              Run Demo
            </button>
            <button onClick={() => void togglePause()}>
              <Pause />
              {policy.paused ? "Resume" : "Pause"}
            </button>
            <button
              onClick={() =>
                updatePolicy({ ...policy, enabled: !policy.enabled })
              }
            >
              {policy.enabled ? "Disable automation" : "Enable automation"}
            </button>
            <button
              className="primary"
              onClick={() => void invoke("open_dashboard")}
            >
              <Settings />
              Dashboard
            </button>
            <button onClick={() => void testNotification()}>
              <ShieldCheck />
              Test notification
            </button>
            <button onClick={toggleNotifications}>
              {notificationsEnabled
                ? `Notifications: ${notificationPermission}`
                : "Enable notifications"}
            </button>
          </nav>
          <section className="history">
            <small>
              Local history · {history.length} record
              {history.length === 1 ? "" : "s"}
            </small>
            {history.slice(0, 2).map((item) => (
              <div key={item.id}>
                <strong>
                  {item.outcome === "success" ? "Demo complete" : "Demo failed"}
                </strong>
                <span>{new Date(item.completedAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}

function ModelLabPopover({
  status,
}: {
  status: "idle" | "running" | "completed";
}) {
  return (
    <section className="model-lab-popover">
      <p className="eyebrow">MODEL LAB · SYNTHETIC</p>
      <h2>Local model summary</h2>
      <div className="lab-metrics">
        <strong>
          24<small>Free models</small>
        </strong>
        <strong>
          3<small>New today</small>
        </strong>
        <strong>
          12<small>Measured</small>
        </strong>
      </div>
      <p className="muted">
        Catalog and benchmark values are synthetic fixtures. No external
        requests.
      </p>
      <section className="provider demo-provider">
        <b>Latest synthetic result</b>
        <p>
          Demo Model A <strong>86</strong>
        </p>
        <p>
          Demo Model B <strong>81</strong>
        </p>
        <p>
          Demo Model C <strong>77</strong>
        </p>
      </section>
      <p className="model-lab-status">
        {status === "running"
          ? "Synthetic benchmark running…"
          : status === "completed"
            ? "Synthetic benchmark complete."
            : "Ready for a manual run."}
      </p>
      <button
        className="primary"
        onClick={() => void invoke("request_model_lab_run")}
      >
        Run synthetic benchmark
      </button>
      <button
        onClick={() => void invoke("open_dashboard", { section: "modelLab" })}
      >
        Open full results
      </button>
    </section>
  );
}

function DashboardApp() {
  const [section, setSection] = useState("overview");
  const [policy, setPolicy] = useState(() => loadPolicy());
  const [history, setHistory] = useState<History[]>(
    () => loadHistory() as History[],
  );
  const [detections, setDetections] = useState<Record<string, Detection>>({});
  const [servicePreferences, setServicePreferences] = useState<
    AIServicePreference[]
  >(() => defaultServicePreferences());
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    void invoke("request_refresh_providers");
    const listeners = Promise.all([
      listen<string>("section-selected", (event) => setSection(event.payload)),
      listen<QuotaAutomationPolicy>("automation-policy-changed", (event) =>
        setPolicy(event.payload),
      ),
      listen<History[]>("history-changed", (event) =>
        setHistory(event.payload),
      ),
      listen<Detection[]>("provider-state-changed", (event) =>
        setDetections(
          Object.fromEntries(
            event.payload.map((item) => [item.provider_id, item]),
          ),
        ),
      ),
      listen<AIServicePreference[]>("service-preferences-changed", (event) =>
        setServicePreferences(event.payload),
      ),
    ]);
    return () => {
      void listeners.then((items) => items.forEach((item) => item()));
    };
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    await invoke("request_refresh_providers");
    setRefreshing(false);
  };
  const updatePolicy = (next: QuotaAutomationPolicy) =>
    void invoke("request_policy_update", { policy: next });
  const updateServicePreference = (preference: AIServicePreference) =>
    void invoke("request_service_preference", { preference });
  const detectedCount = Object.values(detections).filter(
    (item) => item.state === "installed",
  ).length;
  return (
    <main className="dashboard-surface">
      <header>
        <div className="mark">
          <Gauge />
        </div>
        <strong>QuotaLoop Dashboard</strong>
        <span className="online">LOCAL AGENT</span>
      </header>
      <p className="dashboard-section-label">{section.toUpperCase()}</p>
      <nav className="dashboard-nav" aria-label="Dashboard sections">
        {[
          "overview",
          "providers",
          "modelLab",
          "automation",
          "history",
          "signals",
          "subscriptions",
          "settings",
        ].map((item) => (
          <button
            key={item}
            className={section === item ? "active" : ""}
            onClick={() => setSection(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <section className="dashboard-grid">
        <section className="dashboard-card">
          <h2>Overview</h2>
          <p>
            {detectedCount} provider{detectedCount === 1 ? "" : "s"} detected by
            the local allowlist.
          </p>
          <strong>Codex Demo · 72% session · 64% weekly (synthetic)</strong>
        </section>
        <section className="dashboard-card">
          <h2>Providers</h2>
          {providers.map((provider) => (
            <ProviderStatus
              key={provider.id}
              name={provider.name}
              state={detections[provider.id]?.state ?? "not checked"}
              detail={
                detections[provider.id]?.version ??
                "Quota unavailable · detection only"
              }
            />
          ))}
          <button onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh providers"}
          </button>
        </section>
        <section className="dashboard-card">
          <h2>Automation</h2>
          <p>
            Only the Mock Codex Demo action can execute. Controls route to the
            Popover authority.
          </p>
          <p>
            State:{" "}
            <b>
              {policy.paused
                ? "Paused"
                : policy.enabled
                  ? "Enabled"
                  : "Off by default"}
            </b>
          </p>
          <p>
            Daily maximum: {policy.maximumRunsPerDay} · Active hours:{" "}
            {policy.activeHours.start}–{policy.activeHours.end} ·{" "}
            {policy.activeHours.timeZone}
          </p>
          <button
            onClick={() =>
              updatePolicy({ ...policy, enabled: !policy.enabled })
            }
          >
            {policy.enabled ? "Disable automation" : "Enable automation"}
          </button>
          <button
            onClick={() => updatePolicy({ ...policy, paused: !policy.paused })}
          >
            {policy.paused ? "Resume" : "Pause"}
          </button>
        </section>
        <section className="dashboard-card">
          <h2>History</h2>
          {history.length ? (
            history.slice(0, 5).map((item) => (
              <p key={item.id}>
                <b>{item.outcome}</b> ·{" "}
                {new Date(item.completedAt).toLocaleString()} · {item.reason}
              </p>
            ))
          ) : (
            <p>No execution records.</p>
          )}
        </section>
        <section className="dashboard-card">
          <h2>Signals</h2>
          <p>
            Demo signal fixtures only; no live provider signals are available.
          </p>
        </section>
        <section className="dashboard-card">
          <h2>Subscriptions</h2>
          <p>
            Local subscription model is empty in this beta; cloud billing is
            disabled.
          </p>
        </section>
        <section className="dashboard-card">
          <h2>Settings &amp; safety</h2>
          <p>
            Notifications, pause state, and synthetic execution stay local. No
            shell or repository access.
          </p>
          <button onClick={() => void invoke("request_clear_local_data")}>
            Clear local data
          </button>
          <h3>AI Services</h3>
          {servicePreferences.map((preference) => (
            <label key={preference.serviceId} className="service-toggle">
              <span>{preference.serviceId}</span>
              <input
                type="checkbox"
                checked={preference.enabled}
                onChange={(event) =>
                  updateServicePreference({
                    ...preference,
                    enabled: event.target.checked,
                  })
                }
              />
            </label>
          ))}
          <p>
            Credential support unavailable. Secure storage is not connected in
            this build.
          </p>
        </section>
      </section>
    </main>
  );
}

function App() {
  let label = "";
  try {
    label = getCurrentWindow().label;
  } catch {
    /* browser preview */
  }
  const surface = resolveDesktopSurface(
    window.location.search ||
      (label === "dashboard" ? "?surface=dashboard" : "?surface=popover"),
  );
  return surface === "dashboard" ? <DashboardApp /> : <PopoverApp />;
}

function ProviderRow({
  provider,
  detection,
}: {
  provider: { id: string; name: string };
  detection: Detection;
}) {
  const label =
    detection.state === "installed"
      ? "Installed"
      : detection.state === "not_installed"
        ? "Not installed"
        : detection.state === "not_checked"
          ? "Not checked"
          : detection.state === "unsupported"
            ? "Unsupported"
            : detection.state === "timeout"
              ? "Timed out"
              : "Detection failed";
  return (
    <section className="provider compact">
      <div>
        <b>{provider.name}</b>
        <span className={detection.state === "installed" ? "detect" : "muted"}>
          {label}
        </span>
      </div>
      <small>
        {detection.version
          ? `Version ${detection.version}`
          : "Quota unavailable · detection only"}
      </small>
    </section>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
