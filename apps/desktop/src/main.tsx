import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
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
import { LocalScheduler } from "@quotaloop/automation";
import "./styles.css";

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
type History = {
  id: string;
  providerId: string;
  completedAt: string;
  outcome: "success" | "failed";
  reason: string;
};
const providers = [
  { id: "codex", name: "Codex" },
  { id: "claude-code", name: "Claude Code" },
  { id: "gemini-cli", name: "Gemini CLI" },
  { id: "opencode", name: "OpenCode" },
];
const demo = new MockCodexProvider();

function App() {
  const [detections, setDetections] = useState<Record<string, Detection>>(() =>
    Object.fromEntries(
      providers.map((p) => [p.id, { provider_id: p.id, state: "not_checked" }]),
    ),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [paused, setPaused] = useState(
    () => localStorage.getItem("quotaloop.desktop.paused") === "true",
  );
  const [history, setHistory] = useState<History[]>(
    () =>
      JSON.parse(
        localStorage.getItem("quotaloop.desktop.history") ?? "[]",
      ) as History[],
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [automationEnabled] = useState(false);
  const schedulerRef = useRef<LocalScheduler | null>(null);
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
    setRefreshing(false);
  }, []);
  useEffect(() => {
    void refresh();
    const refreshUnlisten = listen("refresh-providers", () => void refresh());
    const pauseUnlisten = listen<boolean>(
      "automation-state-changed",
      (event) => {
        setPaused(event.payload);
        localStorage.setItem("quotaloop.desktop.paused", String(event.payload));
      },
    );
    return () => {
      void refreshUnlisten.then((unlisten) => unlisten());
      void pauseUnlisten.then((unlisten) => unlisten());
    };
  }, [refresh]);
  useEffect(() => {
    const scheduler = new LocalScheduler(async () => {
      if (automationEnabled && !paused) await refresh();
    }, 60_000);
    schedulerRef.current = scheduler;
    scheduler.start();
    return () => {
      scheduler.stop();
      schedulerRef.current = null;
    };
  }, [automationEnabled, paused, refresh]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible")
        schedulerRef.current?.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const runDemo = async () => {
    setNotice(null);
    const result = await demo.runAction({
      mode: "minimal",
      idempotencyKey: `codex-demo:minimal:${new Date().toISOString().slice(0, 16)}`,
      timeoutMs: 30_000,
    });
    const item: History = {
      id: crypto.randomUUID(),
      providerId: demo.id,
      completedAt: result.completedAt,
      outcome: result.ok ? "success" : "failed",
      reason: result.summary,
    };
    const next = [item, ...history].slice(0, 20);
    setHistory(next);
    localStorage.setItem("quotaloop.desktop.history", JSON.stringify(next));
    try {
      if (
        (await isPermissionGranted()) &&
        localStorage.getItem("quotaloop.desktop.last-notification") !== item.id
      ) {
        await sendNotification({
          title: "QuotaLoop demo action complete",
          body: "Synthetic provider action completed locally.",
        });
        localStorage.setItem("quotaloop.desktop.last-notification", item.id);
      }
    } catch {
      setNotice("Native notification permission is unavailable.");
    }
  };
  const togglePause = async () => {
    const next = await invoke<boolean>("set_automation_paused", {
      paused: !paused,
    });
    setPaused(next);
    localStorage.setItem("quotaloop.desktop.paused", String(next));
  };
  const testNotification = async () => {
    try {
      let permission = await isPermissionGranted();
      if (!permission) permission = (await requestPermission()) === "granted";
      if (permission)
        await sendNotification({
          title: "QuotaLoop test notification",
          body: "Native notifications are configured.",
        });
      else setNotice("Native notification permission was denied.");
    } catch {
      setNotice("Native notifications are unavailable in this environment.");
    }
  };
  const installedCount = Object.values(detections).filter(
    (d) => d.state === "installed",
  ).length;
  return (
    <main className="popover">
      <header>
        <div className="mark">
          <Gauge />
        </div>
        <strong>QuotaLoop</strong>
        <span className="online">LOCAL AGENT</span>
      </header>
      <section className="overall">
        <span>ACTUAL DETECTION</span>
        <strong>
          {installedCount} provider{installedCount === 1 ? "" : "s"} installed
        </strong>
        <small>
          {refreshing ? "Refreshing…" : "Fixed allowlist · no shell"}
        </small>
      </section>
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
            {paused ? "Paused" : "Off by default"}
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
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          className="primary"
          onClick={() => void invoke("show_main_window")}
        >
          <Settings />
          Dashboard
        </button>
        <button onClick={() => void testNotification()}>
          <ShieldCheck />
          Test notification
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
    </main>
  );
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
