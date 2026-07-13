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
import {
  MockCodexProvider,
  detectableServiceDefinitions,
  serviceDefinitions,
} from "@quotaloop/providers";
import type {
  AIServicePreference,
  DesktopRequestEnvelope,
  DesktopRequestResult,
  DesktopRequestType,
  DesktopRuntimeSnapshotV2,
  ExecutionRecord,
  QuotaAutomationPolicy,
  Subscription,
} from "@quotaloop/contracts";
import { resolveDesktopSurface } from "./surface";
import { shouldDeliverNotification } from "./notification-controller";
import { ProviderStatus, HistoryList, SubscriptionList } from "@quotaloop/ui";
import { DesktopAuthority } from "./desktop-authority";
import {
  modelLabViewModel,
  syntheticCatalog,
} from "./model-lab/synthetic-catalog";
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
  version?: string | null | undefined;
};
type History = ExecutionRecord;
const providers = detectableServiceDefinitions.map((service) => ({
  id: service.serviceId,
  name: service.displayName,
}));
const demo = new MockCodexProvider();
const defaultServicePreferences = (): AIServicePreference[] =>
  serviceDefinitions.map((service) => ({
    serviceId: service.serviceId,
    enabled: true,
    visibleInQuota: service.supportsQuotaSurface,
    visibleInModelLab: service.supportsModelLab,
    allowCatalogAccess: service.supportsCatalog,
    allowBenchmarkRequests: service.supportsBenchmark,
    favorite: service.integrationLevel === "mock",
  }));
const makeRequest = <T,>(
  type: DesktopRequestType,
  payload: T,
): DesktopRequestEnvelope<T> => ({
  schemaVersion: 2,
  requestId: crypto.randomUUID(),
  type,
  payload,
});
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
  >(() => defaultServicePreferences());
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [policy, setPolicyState] = useState<QuotaAutomationPolicy>(() => ({
    enabled: false,
    paused: false,
    actionMode: "minimal",
    maximumRunsPerDay: 2,
    minimumRemainingPercent: 40,
    activeHours: { start: "00:00", end: "24:00", timeZone: "UTC" },
    targetProviders: ["codex-demo"],
  }));
  const policyRef = useRef(policy);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
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
    authorityRef.current.setProviderStates(
      results.map((result) =>
        result.version === undefined
          ? { providerId: result.provider_id, state: result.state }
          : {
              providerId: result.provider_id,
              state: result.state,
              version: result.version,
            },
      ),
    );
    setRefreshing(false);
  }, []);
  const dispatchRequest = async <T,>(type: DesktopRequestType, payload: T) => {
    const result = await authorityRef.current.handleRequest(
      makeRequest(type, payload),
      {
        refreshProviders: refresh,
        manualAction: async () => {
          await performManualAction();
        },
        modelLabAction: async () => {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
        },
      },
    );
    await invoke("broadcast_desktop_ack", { result });
    return result;
  };
  const updatePolicy = (next: QuotaAutomationPolicy) => {
    void dispatchRequest("automation_policy_requested", next);
  };
  const togglePause = async () => {
    updatePolicy({ ...policyRef.current, paused: !policyRef.current.paused });
  };
  const runModelLab = () => {
    setModelLabStatus("running");
    void dispatchRequest("model_lab_run_requested", {}).then((result) => {
      if (result.accepted) setModelLabStatus("completed");
      else if (result.reason !== "execution_in_progress")
        setModelLabStatus("idle");
    });
  };
  useEffect(() => {
    void refresh();
    const requestUnlisten = listen<unknown>("desktop-requested", (event) => {
      void authorityRef.current
        .handleRequest(event.payload, {
          refreshProviders: refresh,
          manualAction: performManualAction,
          modelLabAction: async () =>
            new Promise<void>((resolve) => window.setTimeout(resolve, 250)),
        })
        .then((result) => invoke("broadcast_desktop_ack", { result }));
    });
    const trayRefreshUnlisten = listen("tray-refresh-requested", () => {
      void dispatchRequest("refresh_providers_requested", {});
    });
    const trayPauseUnlisten = listen("tray-pause-requested", () => {
      void dispatchRequest("automation_policy_requested", {
        ...policyRef.current,
        paused: !policyRef.current.paused,
      });
    });
    return () => {
      void requestUnlisten.then((unlisten) => unlisten());
      void trayRefreshUnlisten.then((unlisten) => unlisten());
      void trayPauseUnlisten.then((unlisten) => unlisten());
    };
  }, [refresh]);
  useEffect(() => {
    authorityRef.current.setOnSnapshot(() => {
      const snapshot = authorityRef.current.getSnapshot();
      setPolicyState(snapshot.persistent.automationPolicy);
      policyRef.current = snapshot.persistent.automationPolicy;
      setHistory(snapshot.persistent.executionHistory);
      setServicePreferences(snapshot.persistent.preferences.aiServices);
      setSelectedModelIds(
        snapshot.persistent.modelLabPreferences.selectedModelIds,
      );
      setNotificationsEnabled(
        snapshot.persistent.preferences.notifications.enabled,
      );
      void invoke("broadcast_desktop_snapshot", { snapshot });
    });
    void authorityRef.current.hydrate().then(() => {
      const hydrated = authorityRef.current.getSnapshot();
      setPolicyState(hydrated.persistent.automationPolicy);
      policyRef.current = hydrated.persistent.automationPolicy;
      setHistory(hydrated.persistent.executionHistory);
      setServicePreferences(
        hydrated.persistent.preferences.aiServices.length
          ? hydrated.persistent.preferences.aiServices
          : defaultServicePreferences(),
      );
      setSelectedModelIds(
        hydrated.persistent.modelLabPreferences.selectedModelIds,
      );
      setNotificationsEnabled(
        hydrated.persistent.preferences.notifications.enabled,
      );
      authorityRef.current.setOnRecord(async (eventKey) => {
        setHistory(controllerRef.current.records as History[]);
        await refresh();
        void notifyCompletion(eventKey);
      });
      authorityRef.current.start();
    });
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
  const performManualAction = async () => {
    setNotice(null);
    const result = await authorityRef.current.runManual(new Date());
    if (result.record) {
      setHistory(controllerRef.current.records as History[]);
      await notifyCompletion(result.eventKey);
    } else setNotice(`Demo blocked: ${result.decision.reason}`);
  };
  const runDemo = () => {
    void dispatchRequest("manual_action_requested", {});
  };
  const notifyCompletion = async (eventKey: string) => {
    const prefs =
      authorityRef.current.getSnapshot().persistent.preferences.notifications;
    try {
      if (
        !shouldDeliverNotification({
          preferences: prefs,
          permission: await isPermissionGranted(),
          eventKey,
          lastEventKey: authorityRef.current.lastNotificationKey,
        })
      )
        return;
      await sendNotification({
        title: "QuotaLoop demo action complete",
        body: "Synthetic provider action completed locally.",
      });
      authorityRef.current.lastNotificationKey = eventKey;
    } catch {
      setNotice("Native notification permission is unavailable.");
    }
  };
  const testNotification = async () => {
    try {
      let permission = await isPermissionGranted();
      if (!permission) permission = (await requestPermission()) === "granted";
      setNotificationPermission(permission ? "granted" : "denied");
      authorityRef.current.setNotificationPermission(
        permission ? "granted" : "denied",
      );
      if (permission)
        await sendNotification({
          title: "QuotaLoop test notification",
          body: "Native notifications are configured.",
        });
      else setNotice("Native notification permission was denied.");
    } catch {
      setNotificationPermission("unavailable");
      authorityRef.current.setNotificationPermission("unavailable");
      setNotice("Native notifications are unavailable in this environment.");
    }
  };
  const toggleNotifications = () => {
    const next = !notificationsEnabled;
    void dispatchRequest("notification_preference_requested", {
      enabled: next,
      actionCompleted: true,
    });
  };
  const tabRefs = useRef<Record<PopoverTab, HTMLButtonElement | null>>({
    quota: null,
    modelLab: null,
  });
  const moveTab = (event: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home" || event.key === "ArrowLeft" ? "quota" : "modelLab";
    const target =
      event.key === "End" || event.key === "ArrowRight" ? "modelLab" : next;
    setActiveTab(target);
    requestAnimationFrame(() => tabRefs.current[target]?.focus());
  };
  return (
    <main className="popover">
      <header className="tab-header">
        <div className="popover-brand" aria-label="QuotaLoop">
          <div className="mark" aria-hidden="true">
            <Gauge />
          </div>
          <strong>QuotaLoop</strong>
        </div>
        <div className="tab-list" role="tablist" aria-label="QuotaLoop views">
          <button
            role="tab"
            aria-selected={activeTab === "quota"}
            className={activeTab === "quota" ? "tab active" : "tab"}
            id="tab-quota"
            aria-controls="panel-quota"
            tabIndex={activeTab === "quota" ? 0 : -1}
            ref={(node) => {
              tabRefs.current.quota = node;
            }}
            onKeyDown={moveTab}
            onClick={() => setActiveTab("quota")}
          >
            QUOTA
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "modelLab"}
            className={activeTab === "modelLab" ? "tab active" : "tab"}
            id="tab-model-lab"
            aria-controls="panel-model-lab"
            tabIndex={activeTab === "modelLab" ? 0 : -1}
            ref={(node) => {
              tabRefs.current.modelLab = node;
            }}
            onKeyDown={moveTab}
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
        <div
          id="panel-model-lab"
          role="tabpanel"
          aria-labelledby="tab-model-lab"
        >
          <ModelLabPopover
            status={modelLabStatus}
            onRun={runModelLab}
            selectedModelIds={selectedModelIds}
            onToggleModel={(modelId) => {
              const next = selectedModelIds.includes(modelId)
                ? selectedModelIds.filter((id) => id !== modelId)
                : [...selectedModelIds, modelId];
              void dispatchRequest("model_lab_selection_requested", {
                selectedModelIds: next,
              }).then((result) => {
                if (result.accepted) setSelectedModelIds(next);
              });
            }}
          />
        </div>
      ) : (
        <div id="panel-quota" role="tabpanel" aria-labelledby="tab-quota">
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
            {providers
              .filter(
                (provider) =>
                  servicePreferences.find(
                    (item) => item.serviceId === provider.id,
                  )?.enabled !== false &&
                  servicePreferences.find(
                    (item) => item.serviceId === provider.id,
                  )?.visibleInQuota !== false,
              )
              .map((provider) => (
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
        </div>
      )}
    </main>
  );
}

function ModelLabPopover({
  status,
  onRun,
  selectedModelIds,
  onToggleModel,
}: {
  status: "idle" | "running" | "completed";
  onRun: () => void;
  selectedModelIds: string[];
  onToggleModel: (modelId: string) => void;
}) {
  const viewModel = modelLabViewModel();
  return (
    <section className="model-lab-popover">
      <p className="eyebrow">MODEL LAB · SYNTHETIC</p>
      <h2>Local model summary</h2>
      <div className="lab-metrics">
        <strong>
          {viewModel.freeCount}
          <small>Free models</small>
        </strong>
        <strong>
          {viewModel.newCount}
          <small>New today</small>
        </strong>
        <strong>
          {viewModel.measuredCount}
          <small>Measured</small>
        </strong>
      </div>
      <p className="muted">
        Catalog and benchmark values are synthetic fixtures. No external
        requests.
      </p>
      <section className="provider demo-provider">
        <b>Latest synthetic result</b>
        {viewModel.scores.map((score) => (
          <p key={score.modelId}>
            {score.name} <strong>{score.score}</strong>
          </p>
        ))}
      </section>
      <fieldset className="model-selection">
        <legend>Models to benchmark</legend>
        {syntheticCatalog.slice(0, 8).map((model) => (
          <label key={model.id}>
            <input
              type="checkbox"
              checked={selectedModelIds.includes(model.id)}
              onChange={() => onToggleModel(model.id)}
            />
            {model.name} <small>Demo / Synthetic</small>
          </label>
        ))}
      </fieldset>
      <p className="model-lab-status">
        {status === "running"
          ? "Synthetic benchmark running…"
          : status === "completed"
            ? "Synthetic benchmark complete."
            : "Ready for a manual run."}
      </p>
      <button className="primary" onClick={onRun}>
        Run synthetic benchmark
      </button>
      <button
        onClick={() => void invoke("open_dashboard", { section: "model_lab" })}
      >
        Open full results
      </button>
    </section>
  );
}

function DashboardApp() {
  const [section, setSection] = useState("overview");
  const [snapshot, setSnapshot] = useState<DesktopRuntimeSnapshotV2 | null>(
    null,
  );
  const [servicePreferences, setServicePreferences] = useState<
    AIServicePreference[]
  >(() => defaultServicePreferences());
  const [refreshing, setRefreshing] = useState(false);
  const [subscriptionDraft, setSubscriptionDraft] = useState<Subscription>({
    id: "",
    providerId: "codex-demo",
    plan: "Demo plan",
    monthlyPrice: 0,
    currency: "USD",
    renewalDate: new Date().toISOString().slice(0, 10),
    autoRenew: false,
    notes: "Synthetic local subscription",
  });
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<
    string | null
  >(null);
  const [authorityUnavailable, setAuthorityUnavailable] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const pendingRequests = useRef(new Map<string, number>());
  const latestRevision = useRef(-1);
  const request = useCallback(<T,>(type: DesktopRequestType, payload: T) => {
    const envelope = makeRequest(type, payload);
    setFeedback(null);
    const timeout = window.setTimeout(() => {
      pendingRequests.current.delete(envelope.requestId);
      setAuthorityUnavailable(true);
      setFeedback("Desktop authority did not respond. Retry.");
    }, 4000);
    pendingRequests.current.set(envelope.requestId, timeout);
    void invoke<boolean>("request_desktop", { envelope }).then((sent) => {
      if (!sent) {
        window.clearTimeout(timeout);
        pendingRequests.current.delete(envelope.requestId);
        setAuthorityUnavailable(true);
        setFeedback("Desktop authority is unavailable.");
      }
    });
    return envelope.requestId;
  }, []);
  useEffect(() => {
    const listeners = Promise.all([
      listen<string>("section-selected", (event) => setSection(event.payload)),
      listen<DesktopRuntimeSnapshotV2>("desktop-snapshot", (event) => {
        if (event.payload.revision < latestRevision.current) return;
        latestRevision.current = event.payload.revision;
        setAuthorityUnavailable(false);
        setSnapshot(event.payload);
        setServicePreferences(event.payload.persistent.preferences.aiServices);
      }),
      listen<DesktopRequestResult>("desktop-ack", (event) => {
        const timeout = pendingRequests.current.get(event.payload.requestId);
        if (timeout !== undefined) window.clearTimeout(timeout);
        pendingRequests.current.delete(event.payload.requestId);
        setFeedback(
          event.payload.accepted
            ? "Saved"
            : `Request rejected: ${event.payload.reason ?? "invalid request"}`,
        );
        if (!event.payload.accepted) return;
        setAuthorityUnavailable(false);
      }),
    ]);
    void listeners.then(() => request("desktop_snapshot_requested", {}));
    return () => {
      for (const timeout of pendingRequests.current.values())
        window.clearTimeout(timeout);
      pendingRequests.current.clear();
      void listeners.then((items) => items.forEach((item) => item()));
    };
  }, [request]);
  useEffect(() => {
    // A newly mounted Dashboard starts at Overview, so release any stale
    // Settings suppression before the first focus transition.
    void invoke("set_dashboard_section", { section: "overview" });
  }, []);
  const retry = () => {
    setAuthorityUnavailable(false);
    request("desktop_snapshot_requested", {});
  };
  const refresh = async () => {
    setRefreshing(true);
    request("refresh_providers_requested", {});
    setRefreshing(false);
  };
  const updatePolicy = (next: QuotaAutomationPolicy) =>
    request("automation_policy_requested", next);
  const updateServicePreference = (preference: AIServicePreference) =>
    request("service_preference_requested", preference);
  const runModelLab = () => request("model_lab_run_requested", {});
  const subscriptions = snapshot?.persistent.subscriptions ?? [];
  const addSubscription = () => {
    const subscription = {
      ...subscriptionDraft,
      id: subscriptionDraft.id || crypto.randomUUID(),
    };
    request("subscription_requested", {
      operation: editingSubscriptionId ? "update" : "add",
      subscription,
    });
    setSubscriptionDraft((current) => ({ ...current, id: "" }));
    setEditingSubscriptionId(null);
  };
  if (!snapshot?.hydrated)
    return (
      <main className="dashboard-surface">
        {authorityUnavailable ? (
          <div role="alert">
            <p>Desktop authority unavailable.</p>
            <button onClick={retry}>Retry</button>
          </div>
        ) : (
          <p role="status">Loading Desktop authority…</p>
        )}
      </main>
    );
  const policy = snapshot.persistent.automationPolicy;
  const demoServicePreference = servicePreferences.find(
    (preference) => preference.serviceId === "codex-demo",
  );
  const history = snapshot.persistent.executionHistory;
  const detections = Object.fromEntries(
    snapshot.providerStates.map((item) => [
      item.providerId,
      {
        provider_id: item.providerId,
        state: item.state,
        version: item.version,
      },
    ]),
  );
  const detectedCount = snapshot.providerStates.filter(
    (item) => item.state === "installed",
  ).length;
  return (
    <main className="dashboard-surface">
      <header>
        <div className="mark">
          <Gauge />
        </div>
        <strong>QuotaLoop Dashboard</strong>
        <span className="online">LOCAL</span>
      </header>
      <p className="dashboard-section-label">{section.toUpperCase()}</p>
      <nav className="dashboard-nav" aria-label="Dashboard sections">
        {[
          "overview",
          "providers",
          "model_lab",
          "automation",
          "history",
          "signals",
          "subscriptions",
          "settings",
        ].map((item) => (
          <button
            key={item}
            className={section === item ? "active" : ""}
            onClick={() => {
              setSection(item);
              void invoke("set_dashboard_section", { section: item });
            }}
          >
            {item}
          </button>
        ))}
      </nav>
      <section className="dashboard-grid" data-active={section}>
        <section className="dashboard-card" data-section="overview">
          <h2>Overview</h2>
          <p>
            {detectedCount} provider{detectedCount === 1 ? "" : "s"} detected by
            the local allowlist.
          </p>
          <strong>Codex Demo · 72% session · 64% weekly (synthetic)</strong>
        </section>
        <section className="dashboard-card" data-section="model_lab">
          <h2>Model Lab</h2>
          <p>Local synthetic catalog and benchmark fixtures only.</p>
          <p>
            Runtime: {snapshot.modelLabRunState.status} ·{" "}
            {snapshot.modelLabRunState.progress}%
          </p>
          <button onClick={runModelLab}>Run synthetic benchmark</button>
          <fieldset
            className="model-selection"
            disabled={
              demoServicePreference?.enabled !== true ||
              demoServicePreference.visibleInModelLab !== true ||
              demoServicePreference.allowBenchmarkRequests !== true
            }
          >
            <legend>Select synthetic models</legend>
            {syntheticCatalog.map((model) => (
              <label key={model.id}>
                <input
                  type="checkbox"
                  checked={snapshot.persistent.modelLabPreferences.selectedModelIds.includes(
                    model.id,
                  )}
                  onChange={() => {
                    const current =
                      snapshot.persistent.modelLabPreferences.selectedModelIds;
                    const selectedModelIds = current.includes(model.id)
                      ? current.filter((id) => id !== model.id)
                      : [...current, model.id];
                    request("model_lab_selection_requested", {
                      selectedModelIds,
                    });
                  }}
                />
                {model.name} <small>Demo / Synthetic</small>
              </label>
            ))}
          </fieldset>
        </section>
        <section className="dashboard-card" data-section="providers">
          <h2>Providers</h2>
          {[...providers]
            .sort(
              (left, right) =>
                Number(
                  servicePreferences.find((item) => item.serviceId === right.id)
                    ?.favorite,
                ) -
                Number(
                  servicePreferences.find((item) => item.serviceId === left.id)
                    ?.favorite,
                ),
            )
            .filter((provider) => {
              const preference = servicePreferences.find(
                (item) => item.serviceId === provider.id,
              );
              return (
                preference?.enabled !== false &&
                preference?.visibleInQuota !== false
              );
            })
            .map((provider) => (
              <ProviderStatus
                key={provider.id}
                name={provider.name}
                state={providerDetectionState(detections[provider.id])}
                detail={providerDetectionDetail(detections[provider.id])}
              />
            ))}
          <button onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh providers"}
          </button>
        </section>
        <section className="dashboard-card" data-section="automation">
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
        <section className="dashboard-card" data-section="history">
          <h2>History</h2>
          <HistoryList>
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
          </HistoryList>
        </section>
        <section className="dashboard-card" data-section="signals">
          <h2>Signals</h2>
          <p>
            Demo signal fixtures only; no live provider signals are available.
          </p>
        </section>
        <section className="dashboard-card" data-section="subscriptions">
          <h2>Subscriptions</h2>
          <SubscriptionList>
            {subscriptions.map((subscription) => (
              <div key={subscription.id} className="subscription-row">
                <strong>{subscription.plan}</strong>
                <span>
                  {subscription.providerId} · {subscription.currency}{" "}
                  {subscription.monthlyPrice}
                </span>
                <button
                  onClick={() => {
                    setSubscriptionDraft(subscription);
                    setEditingSubscriptionId(subscription.id);
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() =>
                    request("subscription_requested", {
                      operation: "remove",
                      subscriptionId: subscription.id,
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <label>
              Provider{" "}
              <input
                value={subscriptionDraft.providerId}
                onChange={(event) =>
                  setSubscriptionDraft({
                    ...subscriptionDraft,
                    providerId: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Plan{" "}
              <input
                value={subscriptionDraft.plan}
                onChange={(event) =>
                  setSubscriptionDraft({
                    ...subscriptionDraft,
                    plan: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Monthly price{" "}
              <input
                type="number"
                min="0"
                value={subscriptionDraft.monthlyPrice}
                onChange={(event) =>
                  setSubscriptionDraft({
                    ...subscriptionDraft,
                    monthlyPrice: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Renewal date{" "}
              <input
                type="date"
                value={subscriptionDraft.renewalDate}
                onChange={(event) =>
                  setSubscriptionDraft({
                    ...subscriptionDraft,
                    renewalDate: event.target.value,
                  })
                }
              />
            </label>
            <label>
              Auto renew{" "}
              <input
                type="checkbox"
                checked={subscriptionDraft.autoRenew}
                onChange={(event) =>
                  setSubscriptionDraft({
                    ...subscriptionDraft,
                    autoRenew: event.target.checked,
                  })
                }
              />
            </label>
            <button onClick={addSubscription}>
              {editingSubscriptionId ? "Save subscription" : "Add subscription"}
            </button>
          </SubscriptionList>
        </section>
        <section className="dashboard-card" data-section="settings">
          <h2>Settings &amp; safety</h2>
          <p>
            Notifications, pause state, and synthetic execution stay local. No
            shell or repository access.
          </p>
          <button onClick={() => request("clear_local_data_requested", {})}>
            Clear local data
          </button>
          <label className="service-toggle">
            <span>Action notifications</span>
            <input
              type="checkbox"
              checked={snapshot.persistent.preferences.notifications.enabled}
              onChange={(event) =>
                request("notification_preference_requested", {
                  enabled: event.target.checked,
                  actionCompleted:
                    snapshot.persistent.preferences.notifications
                      .actionCompleted,
                })
              }
            />
          </label>
          <h3>AI Services</h3>
          {[...servicePreferences]
            .sort(
              (left, right) => Number(right.favorite) - Number(left.favorite),
            )
            .map((preference) => (
              <fieldset key={preference.serviceId} className="service-toggle">
                <legend>{preference.serviceId}</legend>
                {(
                  [
                    ["enabled", "Enabled"],
                    ["visibleInQuota", "Quota"],
                    ["visibleInModelLab", "Model Lab"],
                    ["allowCatalogAccess", "Catalog"],
                    ["allowBenchmarkRequests", "Benchmark"],
                    ["favorite", "Favorite"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="checkbox"
                      checked={preference[key]}
                      onChange={(event) =>
                        updateServicePreference({
                          ...preference,
                          [key]: event.target.checked,
                        })
                      }
                    />
                  </label>
                ))}
              </fieldset>
            ))}
          <p>
            Credential support unavailable. Secure storage is not connected in
            this build.
          </p>
          {feedback && <p role="status">{feedback}</p>}
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
  return (
    <section className="provider compact">
      <div>
        <b>{provider.name}</b>
        <span className={detection.state === "installed" ? "detect" : "muted"}>
          {providerDetectionState(detection)}
        </span>
      </div>
      <small>{providerDetectionDetail(detection)}</small>
    </section>
  );
}

function providerDetectionState(detection: Detection | undefined) {
  const state = detection?.state ?? "not_checked";
  const label =
    state === "installed"
      ? "Installed"
      : state === "not_installed"
        ? "Not installed"
        : state === "not_checked"
          ? "Not checked"
          : state === "unsupported"
            ? "Unsupported"
            : state === "timeout"
              ? "Detection timed out"
              : "Detection failed";
  return `${label} · Quota unavailable`;
}

function providerDetectionDetail(detection: Detection | undefined) {
  return detection?.version
    ? `Version ${detection.version} · detection only`
    : "Detection only; quota unavailable";
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
