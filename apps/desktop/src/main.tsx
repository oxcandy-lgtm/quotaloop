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
  OpenRouterKeyStatus,
  OpenRouterBenchmarkResult,
  OpenRouterPersistentState,
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
import { catalogCounts } from "./openrouter/catalog";
import { OPENROUTER_BENCHMARK_MANIFEST } from "./openrouter/benchmark-manifest";
import { scoreBenchmark } from "./openrouter/scoring";
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

type NativeOpenRouterBenchmarkResponse = Omit<
  OpenRouterBenchmarkResult,
  "metrics" | "caseScores"
> & {
  answerText?: string;
};

async function runNativeOpenRouterModel(input: {
  modelId: string;
  runId: string;
  manifest: typeof OPENROUTER_BENCHMARK_MANIFEST;
  catalogHash?: string;
}): Promise<OpenRouterBenchmarkResult> {
  const raw = await invoke<NativeOpenRouterBenchmarkResponse>(
    "run_openrouter_benchmark_model",
    {
      ...input,
      manifest: { ...input.manifest, catalogHash: input.catalogHash },
    },
  );
  const answers: Record<string, string> = {};
  try {
    const parsed = JSON.parse(raw.answerText ?? "") as unknown;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).id === "string" &&
          typeof (item as Record<string, unknown>).answer === "string"
        ) {
          const record = item as { id: string; answer: string };
          answers[record.id] = record.answer;
        }
      }
    }
  } catch {
    // Invalid model output is scored as zero by the deterministic scorer.
  }
  const scored = scoreBenchmark(input.manifest.cases, answers);
  return {
    id: raw.id,
    modelId: raw.modelId,
    modelName: raw.modelName,
    manifestId: raw.manifestId,
    catalogHash: raw.catalogHash,
    completedAt: raw.completedAt,
    outcome: raw.outcome,
    ...(raw.errorCode ? { errorCode: raw.errorCode } : {}),
    metrics: scored.metrics,
    caseScores: scored.caseScores,
  };
}
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
  const [modelLabMode, setModelLabMode] = useState<"synthetic" | "live">(
    "synthetic",
  );
  const [openrouter, setOpenrouter] =
    useState<OpenRouterPersistentState | null>(null);
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
        openrouterCatalog: async () => invoke("fetch_openrouter_catalog"),
        openrouterRunModel: runNativeOpenRouterModel,
        openrouterCancel: async () => {
          await invoke("cancel_openrouter_benchmark");
        },
        openrouterKeyStatus: async () =>
          invoke<OpenRouterKeyStatus>("openrouter_key_status"),
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
  const refreshOpenRouter = () => {
    void dispatchRequest("openrouter_catalog_refresh_requested", {});
  };
  const runOpenRouter = (modelIds: string[]) => {
    if (!openrouter?.catalog) {
      setNotice("Refresh the OpenRouter free catalog first.");
      return;
    }
    void dispatchRequest("openrouter_benchmark_requested", {
      modelIds,
      catalogHash: openrouter.catalog.catalogHash,
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
          openrouterCatalog: async () => invoke("fetch_openrouter_catalog"),
          openrouterRunModel: runNativeOpenRouterModel,
          openrouterCancel: async () => {
            await invoke("cancel_openrouter_benchmark");
          },
          openrouterKeyStatus: async () =>
            invoke<OpenRouterKeyStatus>("openrouter_key_status"),
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
      setOpenrouter(snapshot.openrouter);
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
      setOpenrouter(hydrated.openrouter);
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
  const openSettings = () => {
    void invoke("open_settings_window").catch(() =>
      setNotice("Settings window is unavailable in this build."),
    );
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
          onClick={openSettings}
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
            mode={modelLabMode}
            onModeChange={setModelLabMode}
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
            openrouter={openrouter}
            onRefreshOpenRouter={refreshOpenRouter}
            onRunOpenRouter={runOpenRouter}
            onPauseOpenRouter={() =>
              void dispatchRequest("openrouter_benchmark_pause_requested", {})
            }
            onResumeOpenRouter={() =>
              void dispatchRequest("openrouter_benchmark_resume_requested", {})
            }
            onCancelOpenRouter={() =>
              void dispatchRequest("openrouter_benchmark_cancel_requested", {})
            }
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
  mode,
  onModeChange,
  selectedModelIds,
  onToggleModel,
  openrouter,
  onRefreshOpenRouter,
  onRunOpenRouter,
  onPauseOpenRouter,
  onResumeOpenRouter,
  onCancelOpenRouter,
}: {
  status: "idle" | "running" | "completed";
  onRun: () => void;
  mode: "synthetic" | "live";
  onModeChange: (mode: "synthetic" | "live") => void;
  selectedModelIds: string[];
  onToggleModel: (modelId: string) => void;
  openrouter: OpenRouterPersistentState | null;
  onRefreshOpenRouter: () => void;
  onRunOpenRouter: (modelIds: string[]) => void;
  onPauseOpenRouter: () => void;
  onResumeOpenRouter: () => void;
  onCancelOpenRouter: () => void;
}) {
  const viewModel = modelLabViewModel();
  const liveCatalog = openrouter?.catalog;
  const liveRun = openrouter?.benchmarkRun;
  const [liveSelectedModelIds, setLiveSelectedModelIds] = useState<string[]>([]);
  useEffect(() => {
    if (!liveCatalog) return;
    setLiveSelectedModelIds((current) => {
      const eligible = new Set(liveCatalog.eligibleModels.map((model) => model.id));
      const retained = current.filter((id) => eligible.has(id));
      return retained.length ? retained : liveCatalog.eligibleModels.map((model) => model.id);
    });
  }, [liveCatalog]);
  return (
    <section className="model-lab-popover">
      <div
        className="settings-option-list"
        role="group"
        aria-label="Model Lab mode"
      >
        <button
          className={mode === "synthetic" ? "active" : ""}
          onClick={() => onModeChange("synthetic")}
        >
          DEMO / SYNTHETIC
        </button>
        <button
          className={mode === "live" ? "active" : ""}
          onClick={() => onModeChange("live")}
        >
          LIVE / OPENROUTER
        </button>
      </div>
      <p className="eyebrow">
        MODEL LAB · {mode === "live" ? "LIVE / OPENROUTER" : "DEMO / SYNTHETIC"}
      </p>
      <h2>Local model summary</h2>
      {mode === "live" ? (
        <>
          <div className="lab-metrics">
            <strong>
              {catalogCounts(liveCatalog ?? null).eligible}
              <small>Free eligible</small>
            </strong>
            <strong>
              {catalogCounts(liveCatalog ?? null).excluded}
              <small>Excluded</small>
            </strong>
            <strong>
              {liveRun?.progress ?? 0}%<small>Progress</small>
            </strong>
          </div>
          <p className="muted">
            OpenRouter catalog is live; benchmark requests run only after an
            explicit click. Paid models and router aliases are excluded.
          </p>
          <button onClick={onRefreshOpenRouter}>Refresh free catalog</button>
          <fieldset className="model-selection">
            <legend>Free models to benchmark</legend>
            {(liveCatalog?.eligibleModels.slice(0, 12) ?? []).map((model) => (
              <label key={model.id}>
                <input
                  type="checkbox"
                  checked={liveSelectedModelIds.includes(model.id)}
                  onChange={() =>
                    setLiveSelectedModelIds((current) =>
                      current.includes(model.id)
                        ? current.filter((id) => id !== model.id)
                        : [...current, model.id],
                    )
                  }
                />
                {model.name} <small>LIVE / OPENROUTER · {model.id}</small>
              </label>
            ))}
          </fieldset>
          <p className="model-lab-status">
            {liveRun?.status ?? "idle"} ·{" "}
            {liveRun?.currentModelId ?? "No model running"}
          </p>
          <button
            className="primary"
            onClick={() =>
              onRunOpenRouter(
                liveSelectedModelIds,
              )
            }
            disabled={!liveCatalog || liveRun?.status === "running"}
          >
            Run all free models
          </button>
          <button
            onClick={onPauseOpenRouter}
            disabled={liveRun?.status !== "running"}
          >
            Pause
          </button>
          <button
            onClick={onResumeOpenRouter}
            disabled={
              liveRun?.status !== "paused" && liveRun?.status !== "interrupted"
            }
          >
            Resume
          </button>
          <button
            onClick={onCancelOpenRouter}
            disabled={
              liveRun?.status !== "running" && liveRun?.status !== "paused"
            }
          >
            Cancel
          </button>
          {(openrouter?.benchmarkResults ?? []).slice(0, 5).map((result) => (
            <p key={result.id}>
              {result.modelName} · {result.outcome} ·{" "}
              {result.metrics?.overallScore ?? 0}
            </p>
          ))}
        </>
      ) : (
        <>
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
            onClick={() =>
              void invoke("open_dashboard", { section: "model_lab" })
            }
          >
            Open full results
          </button>
        </>
      )}
    </section>
  );
}

type DesktopRequest = <T>(type: DesktopRequestType, payload: T) => string;

function useDesktopClient() {
  const [snapshot, setSnapshot] = useState<DesktopRuntimeSnapshotV2 | null>(
    null,
  );
  const [servicePreferences, setServicePreferences] = useState<
    AIServicePreference[]
  >(() => defaultServicePreferences());
  const [refreshing, setRefreshing] = useState(false);
  const [authorityUnavailable, setAuthorityUnavailable] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const pendingRequests = useRef(new Map<string, number>());
  const latestRevision = useRef(-1);
  const request: DesktopRequest = useCallback((type, payload) => {
    const envelope = makeRequest(type, payload);
    setFeedback(null);
    const timeout = window.setTimeout(() => {
      pendingRequests.current.delete(envelope.requestId);
      setAuthorityUnavailable(true);
      setFeedback("Desktop authority did not respond. Retry.");
    }, 4000);
    pendingRequests.current.set(envelope.requestId, timeout);
    void invoke<boolean>("request_desktop", { envelope })
      .then((sent) => {
        if (!sent) {
          window.clearTimeout(timeout);
          pendingRequests.current.delete(envelope.requestId);
          setAuthorityUnavailable(true);
          setFeedback("Desktop authority is unavailable.");
        }
      })
      .catch(() => {
        window.clearTimeout(timeout);
        pendingRequests.current.delete(envelope.requestId);
        setAuthorityUnavailable(true);
        setFeedback("Desktop authority is unavailable.");
      });
    return envelope.requestId;
  }, []);
  useEffect(() => {
    const listeners = Promise.all([
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
        if (event.payload.accepted) setAuthorityUnavailable(false);
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
  const retry = () => {
    setAuthorityUnavailable(false);
    request("desktop_snapshot_requested", {});
  };
  const refresh = async () => {
    setRefreshing(true);
    request("refresh_providers_requested", {});
    setRefreshing(false);
  };
  return {
    snapshot,
    servicePreferences,
    refreshing,
    authorityUnavailable,
    feedback,
    request,
    retry,
    refresh,
  };
}

function DashboardApp() {
  const [section, setSection] = useState("overview");
  const {
    snapshot,
    servicePreferences,
    refreshing,
    authorityUnavailable,
    feedback,
    request,
    retry,
    refresh,
  } = useDesktopClient();
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
  useEffect(() => {
    const listener = listen<string>("section-selected", (event) =>
      setSection(event.payload),
    );
    return () => {
      void listener.then((unlisten) => unlisten());
    };
  }, []);
  const updatePolicy = (next: QuotaAutomationPolicy) =>
    request("automation_policy_requested", next);
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
              if (item === "settings") {
                void invoke("open_settings_window").catch(() => undefined);
                return;
              }
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
            Live OpenRouter catalog:{" "}
            {snapshot.openrouter.catalog?.eligibleModels.length ?? 0} free
            models · run {snapshot.openrouter.benchmarkRun.status}
          </p>
          <button
            onClick={() => request("openrouter_catalog_refresh_requested", {})}
          >
            Refresh OpenRouter free catalog
          </button>
          <button
            onClick={() =>
              request("openrouter_benchmark_requested", {
                modelIds:
                  snapshot.openrouter.catalog?.eligibleModels.map(
                    (model) => model.id,
                  ) ?? [],
                catalogHash:
                  snapshot.openrouter.catalog?.catalogHash ?? "missing",
              })
            }
            disabled={
              !snapshot.openrouter.catalog ||
              snapshot.openrouter.benchmarkRun.status === "running"
            }
          >
            Run live free-model benchmark
          </button>
          <p>Live results are never mixed into synthetic history.</p>
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
          <SettingsPanel
            snapshot={snapshot}
            servicePreferences={servicePreferences}
            request={request}
            feedback={feedback}
          />
        </section>
      </section>
    </main>
  );
}

type SettingsSection =
  | "ai_services"
  | "model_lab"
  | "automation"
  | "notifications"
  | "subscriptions"
  | "storage_privacy"
  | "advanced_safety";

const settingsSections: Array<{ id: SettingsSection; label: string }> = [
  { id: "ai_services", label: "AI Services" },
  { id: "model_lab", label: "Model Lab" },
  { id: "automation", label: "Automation" },
  { id: "notifications", label: "Notifications" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "storage_privacy", label: "Storage & Privacy" },
  { id: "advanced_safety", label: "Advanced / Safety" },
];

function SettingsPanel({
  snapshot,
  servicePreferences,
  request,
  feedback,
}: {
  snapshot: DesktopRuntimeSnapshotV2;
  servicePreferences: AIServicePreference[];
  request: DesktopRequest;
  feedback: string | null;
}) {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("ai_services");
  const openrouterKeyRef = useRef<HTMLInputElement>(null);
  const [openrouterKeyStatus, setOpenrouterKeyStatus] =
    useState<OpenRouterKeyStatus | null>(null);
  const [openrouterBusy, setOpenrouterBusy] = useState(false);
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
  const demoServicePreference = servicePreferences.find(
    (preference) => preference.serviceId === "codex-demo",
  );
  useEffect(() => {
    void invoke<OpenRouterKeyStatus>("openrouter_key_status")
      .then(setOpenrouterKeyStatus)
      .catch(() =>
        setOpenrouterKeyStatus({
          configured: false,
          source: "none",
          lastFour: null,
        }),
      );
  }, []);
  const subscriptions = snapshot.persistent.subscriptions;
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
  const toggleModel = (modelId: string) => {
    const current = snapshot.persistent.modelLabPreferences.selectedModelIds;
    request("model_lab_selection_requested", {
      selectedModelIds: current.includes(modelId)
        ? current.filter((id) => id !== modelId)
        : [...current, modelId],
    });
  };
  const updateServicePreference = (
    preference: AIServicePreference,
    key: keyof Omit<AIServicePreference, "serviceId">,
    value: boolean,
  ) => {
    request("service_preference_requested", {
      ...preference,
      [key]: value,
    });
  };
  const renderServicePreferences = () => (
    <>
      <h2>AI Services</h2>
      <p>Capabilities remain visible even when a service is disabled.</p>
      {[...servicePreferences]
        .sort((left, right) => Number(right.favorite) - Number(left.favorite))
        .map((preference) => (
          <fieldset key={preference.serviceId} className="settings-service">
            <legend>{preference.serviceId}</legend>
            <div className="settings-option-list">
              {(
                [
                  ["enabled", "Enabled"],
                  ["visibleInQuota", "Visible in Quota"],
                  ["visibleInModelLab", "Visible in Model Lab"],
                  ["allowCatalogAccess", "Allow catalog access"],
                  ["allowBenchmarkRequests", "Allow benchmark requests"],
                  ["favorite", "Favorite"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="settings-toggle-row">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={preference[key]}
                    onChange={(event) =>
                      updateServicePreference(
                        preference,
                        key,
                        event.target.checked,
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
    </>
  );
  const renderModelLab = () => (
    <>
      <h2>Model Lab</h2>
      <p>
        Demo / Synthetic fixtures remain offline. Live / OpenRouter is explicit
        and never mixed with synthetic results.
      </p>
      <p>
        OpenRouter free catalog:{" "}
        {snapshot.openrouter.catalog?.eligibleModels.length ?? 0} eligible ·{" "}
        {snapshot.openrouter.catalog?.excludedModels.length ?? 0} excluded
      </p>
      <button
        onClick={() => request("openrouter_catalog_refresh_requested", {})}
      >
        Refresh live catalog
      </button>
      <button
        onClick={() =>
          request("openrouter_benchmark_requested", {
            modelIds:
              snapshot.openrouter.catalog?.eligibleModels.map(
                (model) => model.id,
              ) ?? [],
            catalogHash: snapshot.openrouter.catalog?.catalogHash ?? "missing",
          })
        }
        disabled={
          !snapshot.openrouter.catalog ||
          snapshot.openrouter.benchmarkRun.status === "running"
        }
      >
        Run live free-model benchmark
      </button>
      <p>
        Live run: {snapshot.openrouter.benchmarkRun.status} ·{" "}
        {snapshot.openrouter.benchmarkRun.progress}%
      </p>
      <p>
        Status: {snapshot.modelLabRunState.status} ·{" "}
        {snapshot.modelLabRunState.progress}%
      </p>
      <button
        className="primary"
        onClick={() => request("model_lab_run_requested", {})}
        disabled={snapshot.modelLabRunState.status === "running"}
      >
        Run synthetic benchmark
      </button>
      <fieldset
        className="model-selection"
        disabled={
          demoServicePreference?.enabled !== true ||
          demoServicePreference.visibleInModelLab !== true ||
          demoServicePreference.allowBenchmarkRequests !== true
        }
      >
        <legend>Select synthetic models</legend>
        <div className="settings-option-list">
          {syntheticCatalog.map((model) => (
            <label key={model.id} className="settings-toggle-row">
              <span>
                {model.name} <small>Demo / Synthetic</small>
              </span>
              <input
                type="checkbox"
                checked={snapshot.persistent.modelLabPreferences.selectedModelIds.includes(
                  model.id,
                )}
                onChange={() => toggleModel(model.id)}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <h3>Recent synthetic results</h3>
      {snapshot.persistent.modelLabHistory.length ? (
        snapshot.persistent.modelLabHistory.slice(0, 5).map((record) => (
          <p key={record.id}>
            {record.outcome} · {new Date(record.completedAt).toLocaleString()}
          </p>
        ))
      ) : (
        <p>No synthetic results yet.</p>
      )}
    </>
  );
  const renderAutomation = () => {
    const policy = snapshot.persistent.automationPolicy;
    return (
      <>
        <h2>Automation</h2>
        <p>Only the local Mock Codex Demo action can execute in this beta.</p>
        <p>
          State: <b>{policy.enabled ? "Enabled" : "Off"}</b>
          {policy.paused ? " · Paused" : ""}
        </p>
        <p>
          Daily maximum: {policy.maximumRunsPerDay} · Active hours:{" "}
          {policy.activeHours.start}–{policy.activeHours.end}
        </p>
        <div className="settings-option-list">
          <button
            onClick={() =>
              request("automation_policy_requested", {
                ...policy,
                enabled: !policy.enabled,
              })
            }
          >
            {policy.enabled ? "Disable automation" : "Enable automation"}
          </button>
          <button
            onClick={() =>
              request("automation_policy_requested", {
                ...policy,
                paused: !policy.paused,
              })
            }
          >
            {policy.paused ? "Resume" : "Pause"}
          </button>
        </div>
      </>
    );
  };
  const renderNotifications = () => (
    <>
      <h2>Notifications</h2>
      <div className="settings-option-list">
        <label className="settings-toggle-row">
          <span>Action notifications</span>
          <input
            type="checkbox"
            checked={snapshot.persistent.preferences.notifications.enabled}
            onChange={(event) =>
              request("notification_preference_requested", {
                enabled: event.target.checked,
                actionCompleted:
                  snapshot.persistent.preferences.notifications.actionCompleted,
              })
            }
          />
        </label>
      </div>
      <p>Permission: {snapshot.notificationPermission}</p>
      <p>Notification preferences remain local to this Desktop build.</p>
    </>
  );
  const renderSubscriptions = () => (
    <>
      <h2>Subscriptions</h2>
      <p>Local synthetic subscription records only.</p>
      {subscriptions.map((subscription) => (
        <div key={subscription.id} className="settings-subscription-row">
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
        Provider
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
        Plan
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
        Monthly price
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
        Renewal date
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
      <div className="settings-option-list">
        <label className="settings-toggle-row">
          <span>Auto renew</span>
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
      </div>
      <button onClick={addSubscription}>
        {editingSubscriptionId ? "Save subscription" : "Add subscription"}
      </button>
    </>
  );
  const renderStoragePrivacy = () => (
    <>
      <h2>Storage &amp; Privacy</h2>
      <p>
        QuotaLoop stores only validated local Desktop state. No cloud sync or
        external request is enabled.
      </p>
      <button onClick={() => request("clear_local_data_requested", {})}>
        Clear local data
      </button>
    </>
  );
  const renderAdvancedSafety = () => (
    <>
      <h2>Advanced / Safety</h2>
      <h3>API Connections</h3>
      <p>
        OpenRouter free-model access uses the native macOS Keychain or Windows
        Credential Manager.
      </p>
      <p>
        Status:{" "}
        {openrouterKeyStatus?.configured
          ? `Configured (${openrouterKeyStatus.source})`
          : "Not configured"}
      </p>
      <label>
        OpenRouter API key
        <input
          ref={openrouterKeyRef}
          type="password"
          autoComplete="off"
          placeholder="sk-or-…"
          aria-label="OpenRouter API key"
        />
      </label>
      <div className="settings-option-list">
        <button
          disabled={openrouterBusy}
          onClick={() => {
            const key = openrouterKeyRef.current?.value.trim() ?? "";
            if (!key) return;
            setOpenrouterBusy(true);
            void invoke<OpenRouterKeyStatus>("save_openrouter_key", { key })
              .then((status) => {
                setOpenrouterKeyStatus(status);
                if (openrouterKeyRef.current)
                  openrouterKeyRef.current.value = "";
              })
              .catch(() => undefined)
              .finally(() => setOpenrouterBusy(false));
          }}
        >
          Save key
        </button>
        <button
          disabled={openrouterBusy || !openrouterKeyStatus?.configured}
          onClick={() => {
            setOpenrouterBusy(true);
            void invoke("test_openrouter_connection")
              .then(() => undefined)
              .catch(() => undefined)
              .finally(() => setOpenrouterBusy(false));
          }}
        >
          Test connection
        </button>
        <button
          disabled={openrouterBusy || !openrouterKeyStatus?.configured}
          onClick={() => {
            if (!window.confirm("Delete the saved OpenRouter key?")) return;
            setOpenrouterBusy(true);
            void invoke<OpenRouterKeyStatus>("delete_openrouter_key")
              .then(setOpenrouterKeyStatus)
              .catch(() => undefined)
              .finally(() => setOpenrouterBusy(false));
          }}
        >
          Delete key
        </button>
      </div>
      <p>
        The key is never written to localStorage, JSON state, benchmark results,
        logs, or events. Reveal and Copy are intentionally unavailable.
      </p>
    </>
  );
  const content = {
    ai_services: renderServicePreferences,
    model_lab: renderModelLab,
    automation: renderAutomation,
    notifications: renderNotifications,
    subscriptions: renderSubscriptions,
    storage_privacy: renderStoragePrivacy,
    advanced_safety: renderAdvancedSafety,
  }[activeSection]();
  return (
    <div className="settings-layout">
      <nav className="settings-sidebar" aria-label="Settings sections">
        {settingsSections.map((item) => (
          <button
            key={item.id}
            className={activeSection === item.id ? "active" : ""}
            onClick={() => setActiveSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <section className="settings-content" aria-live="polite">
        <div className="settings-pane">{content}</div>
        {feedback && <p role="status">{feedback}</p>}
      </section>
    </div>
  );
}

function SettingsApp() {
  const {
    snapshot,
    servicePreferences,
    authorityUnavailable,
    feedback,
    request,
    retry,
  } = useDesktopClient();
  if (!snapshot?.hydrated)
    return (
      <main className="settings-surface">
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
  return (
    <main className="settings-surface">
      <header className="settings-header">
        <div className="mark" aria-hidden="true">
          <Gauge />
        </div>
        <strong>QuotaLoop Settings</strong>
        <span className="online">LOCAL</span>
      </header>
      <SettingsPanel
        snapshot={snapshot}
        servicePreferences={servicePreferences}
        request={request}
        feedback={feedback}
      />
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
  const fallbackSurface =
    label === "dashboard"
      ? "?surface=dashboard"
      : label === "settings"
        ? "?surface=settings"
        : "?surface=popover";
  const surface = resolveDesktopSurface(
    window.location.search || fallbackSurface,
  );
  if (surface === "dashboard") return <DashboardApp />;
  if (surface === "settings") return <SettingsApp />;
  return <PopoverApp />;
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
