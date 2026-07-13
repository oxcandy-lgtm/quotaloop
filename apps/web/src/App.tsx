import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import {
  Activity,
  Bell,
  Bot,
  ChevronRight,
  CircleHelp,
  Command,
  CreditCard,
  Gauge,
  History,
  Home,
  Laptop,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Signal,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";
import type {
  ExecutionRecord,
  QuotaAutomationPolicy,
  ResetSignal,
  Subscription,
} from "@quotaloop/contracts";
import {
  createIdempotencyKey,
  defaultAutomationPolicy,
  evaluateAutomation,
} from "@quotaloop/core";
import { providerCatalog } from "@quotaloop/providers";
import { LocalStorageRepository, type AppData } from "@quotaloop/storage";
import {
  PageTitle as SharedPageTitle,
  SettingRow as SharedSettingRow,
  Toggle as SharedToggle,
  NotificationPreferencePanel,
  AIServicePreferenceList,
} from "@quotaloop/ui";

export type RuntimeMode = "demo" | "standalone_web" | "desktop_connected";
export const runtimeMode: RuntimeMode = "standalone_web";

const repo = new LocalStorageRepository();
const initial: AppData = {
  schemaVersion: 2,
  policy: defaultAutomationPolicy(),
  history: [],
  subscriptions: [],
  theme: "system",
  onboardingComplete: false,
  notifications: {
    webEnabled: false,
    desktopEnabled: false,
    actionCompleted: true,
    testNotification: true,
  },
  aiServices: providerCatalog.map((provider) => ({
    serviceId: provider.id,
    enabled: true,
    visibleInQuota: true,
    visibleInModelLab: true,
    allowCatalogAccess: true,
    allowBenchmarkRequests: provider.integrationLevel === "mock",
    favorite: provider.integrationLevel === "mock",
  })),
  credentials: providerCatalog.map((provider) => ({
    providerId: provider.id,
    status: "unavailable" as const,
  })),
  modelLab: { selectedModelIds: [] },
  modelLabHistory: [],
  lastNotificationEventKey: null,
};
const signals: ResetSignal[] = [
  {
    id: "signal-demo-1",
    providerId: "codex-demo",
    confidence: "confirmed",
    eventType: "LIMIT_INCREASED",
    sourceTier: "official",
    summary: "Demo: a published limit update was detected.",
    sourceUrl: "https://example.com/quotaloop-demo",
    publishedAt: "2026-01-15T09:00:00.000Z",
    observedAt: "2026-01-15T09:05:00.000Z",
  },
  {
    id: "signal-demo-2",
    providerId: "gemini-cli",
    confidence: "watch",
    eventType: "QUOTA_INCIDENT",
    sourceTier: "community",
    summary: "Demo: an unconfirmed availability change is being watched.",
    sourceUrl: "https://example.com/quotaloop-watch",
    publishedAt: "2026-01-14T14:00:00.000Z",
    observedAt: "2026-01-14T14:10:00.000Z",
  },
];

const nav = [
  ["/", "Overview", Home],
  ["/providers", "Providers", Bot],
  ["/automation", "Automation", SlidersHorizontal],
  ["/signals", "Signals", Signal],
  ["/history", "History", History],
  ["/devices", "Devices", Laptop],
  ["/subscriptions", "Subscriptions", CreditCard],
  ["/settings", "Settings", Settings],
] as const;

export function App() {
  const [data, setData] = useState(() => repo.load(initial));
  const [help, setHelp] = useState(false);
  const [helpProvider, setHelpProvider] = useState<string | null>(null);
  const save = (next: AppData) => {
    setData(next);
    repo.save(next);
  };
  useEffect(() => {
    document.documentElement.dataset.theme = data.theme;
  }, [data.theme]);
  if (!data.onboardingComplete)
    return (
      <Onboarding
        onComplete={() => save({ ...data, onboardingComplete: true })}
      />
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />{" "}
        <nav>
          {nav.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="privacy-note">
          <ShieldCheck size={16} />
          <span>
            Local mode
            <br />
            <small>Data stays here</small>
          </span>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">LOCAL DASHBOARD</p>
            <h1>QuotaLoop</h1>
          </div>
          <div className="header-actions">
            <span className="agent-status">
              <i />
              Desktop agent not connected
            </span>
            <button className="icon-button" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Open safety help"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <Routes>
          <Route
            path="/"
            element={
              <Overview
                data={data}
                save={save}
                onHelpProvider={setHelpProvider}
              />
            }
          />
          <Route path="/providers" element={<Providers />} />
          <Route
            path="/automation"
            element={<AutomationPage data={data} save={save} />}
          />
          <Route path="/signals" element={<Signals />} />
          <Route
            path="/history"
            element={<HistoryPage records={data.history} />}
          />
          <Route path="/devices" element={<Devices />} />
          <Route
            path="/subscriptions"
            element={<Subscriptions data={data} save={save} />}
          />
          <Route
            path="/settings"
            element={<SettingsPage data={data} save={save} />}
          />
        </Routes>
      </main>
      <MobileNav />
      {help && <SafetyDrawer onClose={() => setHelp(false)} />}
      {helpProvider && (
        <SafetyDrawer
          providerName={helpProvider}
          onClose={() => setHelpProvider(null)}
        />
      )}
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <Gauge size={21} />
      </div>
      <strong>QuotaLoop</strong>
      <span>BETA</span>
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="page-title">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
}

function Overview({
  data,
  save,
  onHelpProvider,
}: {
  data: AppData;
  save: (d: AppData) => void;
  onHelpProvider: (name: string) => void;
}) {
  const navigate = useNavigate();
  const demo = providerCatalog[0]!;
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const now = new Date();
    const quota = await demo.getQuotaStatus();
    const key = createIdempotencyKey(demo.id, "minimal", now);
    const decision = evaluateAutomation({
      policy: data.policy,
      quota,
      authenticated: true,
      canRun: true,
      now,
      todayRuns: data.history.filter(
        (x) => x.startedAt.slice(0, 10) === now.toISOString().slice(0, 10),
      ).length,
      duplicate: data.history.some((x) => x.idempotencyKey === key),
      running: false,
      manualOverride: true,
    });
    const result =
      decision.allowed && demo.runAction
        ? await demo.runAction({
            mode: "minimal",
            idempotencyKey: key,
            timeoutMs: 30_000,
          })
        : null;
    const record: ExecutionRecord = {
      id: crypto.randomUUID(),
      providerId: demo.id,
      startedAt: now.toISOString(),
      completedAt: new Date().toISOString(),
      outcome: result?.ok ? "success" : "blocked",
      reason: result?.summary ?? decision.reason,
      idempotencyKey: key,
    };
    save({ ...data, history: [record, ...data.history] });
    if (
      result?.ok &&
      data.notifications.webEnabled &&
      data.notifications.actionCompleted &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      const notificationKey = `${record.providerId}:${record.idempotencyKey}`;
      if (data.lastNotificationEventKey !== notificationKey) {
        new Notification("QuotaLoop demo action complete", {
          body: "The synthetic provider action completed locally.",
        });
        save({ ...data, lastNotificationEventKey: notificationKey });
      }
    }
    setBusy(false);
  };
  return (
    <section>
      <PageTitle
        eyebrow="OVERVIEW"
        title="Everything in rhythm."
        detail="Your providers, actions, and renewals at a glance."
      />
      <div className="summary-grid">
        <Metric label="Providers ready" value="1" detail="of 3 demo cards" />
        <Metric
          label="Next reset"
          value="2h 14m"
          detail="Codex Demo · synthetic"
        />
        <Metric
          label="Automation"
          value={data.policy.enabled ? "Running" : "Off"}
          detail={
            data.policy.enabled ? "Local schedule unavailable" : "Safe default"
          }
        />
        <Metric label="Agent" value="Not connected" detail="Standalone web" />
      </div>
      <div className="section-head">
        <div>
          <h3>Provider status</h3>
          <p>Current availability and usage windows</p>
        </div>
        <button
          className="button secondary"
          disabled
          title="Connect a desktop agent to refresh local providers"
        >
          <RefreshCw size={15} />
          Refresh all
        </button>
      </div>
      <div className="provider-grid">
        <ProviderCard
          name="Codex"
          state="Ready"
          origin="DEMO"
          session={72}
          weekly={64}
          accent="blue"
          onHelp={() => onHelpProvider("Codex Demo")}
        />
        <ProviderCard
          name="Claude Code"
          state="Detect-only"
          origin="STANDALONE"
          session={null}
          weekly={null}
          accent="orange"
          onHelp={() => onHelpProvider("Claude Code")}
        />
        <ProviderCard
          name="Gemini CLI"
          state="Unavailable"
          origin="STANDALONE"
          session={null}
          weekly={null}
          accent="violet"
          onHelp={() => onHelpProvider("Gemini CLI")}
        />
      </div>
      <div className="two-col">
        <div className="panel">
          <div className="section-head">
            <div>
              <h3>Quick actions</h3>
              <p>Fixed, permission-scoped operations</p>
            </div>
          </div>
          <div className="action-list">
            <button onClick={run} disabled={busy}>
              <span className="action-icon">
                <Play size={17} />
              </span>
              <span>
                <strong>{busy ? "Running…" : "Run minimal action"}</strong>
                <small>Demo provider · no file access</small>
              </span>
              <ChevronRight size={17} />
            </button>
            <button onClick={() => navigate("/automation")}>
              <span className="action-icon">
                <SlidersHorizontal size={17} />
              </span>
              <span>
                <strong>Review automation</strong>
                <small>
                  Currently {data.policy.enabled ? "enabled" : "disabled"}
                </small>
              </span>
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
        <ActivityPanel records={data.history} />
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function ProviderCard({
  name,
  state,
  origin,
  session,
  weekly,
  accent,
  onHelp,
}: {
  name: string;
  state: string;
  origin: string;
  session: number | null;
  weekly: number | null;
  accent: string;
  onHelp?: () => void;
}) {
  return (
    <article className={`provider-card ${accent}`}>
      <div className="provider-top">
        <div className="provider-icon">{name.slice(0, 1)}</div>
        <div>
          <h3>{name}</h3>
          <span className={`state ${state.toLowerCase()}`}>{state}</span>
        </div>
        <span className="origin">{origin}</span>
      </div>
      {session === null ? (
        <div className="unavailable">
          <Command size={20} />
          <strong>Quota unavailable</strong>
          <span>This integration does not expose a verified quota source.</span>
        </div>
      ) : (
        <div className="quota-lines">
          <QuotaLine label="Session" value={session} />
          <QuotaLine label="Weekly" value={weekly!} />
        </div>
      )}
      <footer>
        <span>Updated just now</span>
        <button aria-label={`Help for ${name}`} onClick={onHelp}>
          <CircleHelp size={15} />
        </button>
      </footer>
    </article>
  );
}
function QuotaLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="quota-line">
      <div>
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="progress">
        <i style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
function ActivityPanel({ records }: { records: ExecutionRecord[] }) {
  return (
    <div className="panel">
      <div className="section-head">
        <div>
          <h3>Recent activity</h3>
          <p>Local execution timeline</p>
        </div>
      </div>
      {records.length ? (
        <div className="timeline">
          {records.slice(0, 3).map((r) => (
            <div key={r.id}>
              <i />
              <span>
                <strong>
                  {r.outcome === "success"
                    ? "Action completed"
                    : "Action blocked"}
                </strong>
                <small>
                  {r.providerId} ·{" "}
                  {new Date(r.completedAt).toLocaleTimeString()}
                </small>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Activity />}
          title="No activity yet"
          text="A manual or scheduled action will appear here."
        />
      )}
    </div>
  );
}

function Providers() {
  return (
    <section>
      <PageTitle
        eyebrow="PROVIDERS"
        title="Provider catalog"
        detail="Integration levels reflect only verified local capabilities."
      />
      <AIServicePreferenceList>
        <div className="catalog">
          {providerCatalog.map((p) => (
            <div className="catalog-row" key={p.id}>
              <div className="provider-icon">{p.displayName[0]}</div>
              <div>
                <strong>{p.displayName}</strong>
                <small>
                  {p.integrationLevel.replace("_", " ")} integration
                </small>
              </div>
              <div className="capabilities">
                {Object.entries(p.capabilities)
                  .filter(([, v]) => v)
                  .map(([k]) => (
                    <span key={k}>
                      {k.replace(/[A-Z]/g, (m) => ` ${m.toLowerCase()}`)}
                    </span>
                  ))}
              </div>
              <span
                className={`state ${p.integrationLevel === "mock" ? "mock" : "unavailable"}`}
              >
                {p.integrationLevel}
              </span>
            </div>
          ))}
        </div>
      </AIServicePreferenceList>
    </section>
  );
}

function AutomationPage({
  data,
  save,
}: {
  data: AppData;
  save: (d: AppData) => void;
}) {
  const update = (patch: Partial<QuotaAutomationPolicy>) =>
    save({ ...data, policy: { ...data.policy, ...patch } });
  return (
    <section>
      <PageTitle
        eyebrow="AUTOMATION"
        title="Automatic actions"
        detail="Set when fixed provider actions may run. Automation starts off."
      />
      <div className="settings-layout">
        <div className="panel settings-panel">
          <SettingRow
            title="Enable automation"
            detail="Evaluate providers on the local schedule"
          >
            <Toggle
              value={data.policy.enabled}
              set={(v) => update({ enabled: v })}
            />
          </SettingRow>
          <SettingRow
            title="Pause all actions"
            detail="Keep schedules without running actions"
          >
            <Toggle
              value={data.policy.paused}
              set={(v) => update({ paused: v })}
            />
          </SettingRow>
          <label className="field">
            <span>Action mode</span>
            <select
              value={data.policy.actionMode}
              onChange={(e) =>
                update({ actionMode: e.target.value as "minimal" | "utility" })
              }
            >
              <option value="minimal">Minimal action</option>
              <option value="utility">Utility</option>
            </select>
          </label>
          <label className="field">
            <span>Maximum runs per day</span>
            <input
              type="number"
              min="1"
              max="10"
              value={data.policy.maximumRunsPerDay}
              onChange={(e) =>
                update({ maximumRunsPerDay: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Minimum weekly remaining</span>
            <input
              type="range"
              min="0"
              max="100"
              value={data.policy.minimumRemainingPercent ?? 0}
              onChange={(e) =>
                update({ minimumRemainingPercent: Number(e.target.value) })
              }
            />
            <strong>{data.policy.minimumRemainingPercent}%</strong>
          </label>
        </div>
        <div className="panel safety-card">
          <ShieldCheck />
          <h3>Safe by default</h3>
          <p>
            Only fixed provider actions can run. Repository access, arbitrary
            prompts, and arbitrary shell commands are not available.
          </p>
          <ul>
            <li>Maximum {data.policy.maximumRunsPerDay} runs daily</li>
            <li>Duplicate execution guard</li>
            <li>Fixed actions only; local agent required</li>
            <li>Stops on stale or unknown quota</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
function SettingRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      {children}
    </div>
  );
}
function Toggle({ value, set }: { value: boolean; set: (v: boolean) => void }) {
  return (
    <button
      className={`toggle ${value ? "on" : ""}`}
      role="switch"
      aria-checked={value}
      onClick={() => set(!value)}
    >
      <i />
    </button>
  );
}

function Signals() {
  return (
    <section>
      <PageTitle
        eyebrow="SIGNALS"
        title="Reset intelligence"
        detail="Structured public information, clearly labeled by confidence."
      />
      <div className="signal-list">
        {signals.map((s) => (
          <article key={s.id}>
            <span className={`confidence ${s.confidence}`}>{s.confidence}</span>
            <div>
              <h3>{s.summary}</h3>
              <p>
                {s.providerId} · {s.eventType.replaceAll("_", " ")} ·{" "}
                {s.sourceTier} source
              </p>
            </div>
            <a href={s.sourceUrl} target="_blank" rel="noreferrer">
              Open source
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
function HistoryPage({ records }: { records: ExecutionRecord[] }) {
  return (
    <section>
      <PageTitle
        eyebrow="ACTIVITY"
        title="Execution history"
        detail="A local record of actions and decisions, without raw conversations."
      />
      {records.length ? (
        <div className="history-table">
          {records.map((r) => (
            <div key={r.id}>
              <span className={`state ${r.outcome}`}>{r.outcome}</span>
              <strong>{r.providerId}</strong>
              <span>{r.reason}</span>
              <time>{new Date(r.completedAt).toLocaleString()}</time>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={<History />}
          title="History is empty"
          text="Run a demo minimal action to verify the complete flow."
        />
      )}
    </section>
  );
}
function Devices() {
  return (
    <section>
      <PageTitle
        eyebrow="DEVICES"
        title="Desktop agents"
        detail="Local agents connect web management to fixed CLI operations."
      />
      <div className="device-card">
        <div className="device-icon">
          <Laptop />
        </div>
        <div>
          <h3>This device</h3>
          <p>Standalone web mode · desktop agent not connected</p>
        </div>
        <span className="state unavailable">Not connected</span>
      </div>
      <div className="inline-callout">
        <CircleHelp />
        <span>
          <strong>Remote pairing is not included in this beta.</strong> Cloud
          sync and smartphone remote control remain unavailable.
        </span>
      </div>
    </section>
  );
}

function Subscriptions({
  data,
  save,
}: {
  data: AppData;
  save: (d: AppData) => void;
}) {
  const [open, setOpen] = useState(false);
  const total = useMemo(
    () => data.subscriptions.reduce((n, s) => n + s.monthlyPrice, 0),
    [data],
  );
  const add = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s: Subscription = {
      id: crypto.randomUUID(),
      providerId: String(f.get("provider")),
      plan: String(f.get("plan")),
      monthlyPrice: Number(f.get("price")),
      currency: "USD",
      renewalDate: String(f.get("renewal")),
      autoRenew: true,
      notes: "",
    };
    save({ ...data, subscriptions: [...data.subscriptions, s] });
    setOpen(false);
  };
  return (
    <section>
      <PageTitle
        eyebrow="SUBSCRIPTIONS"
        title="Plans and renewals"
        detail="Private records stored only in this browser."
      />
      <div className="section-head">
        <div>
          <h3>${total.toFixed(2)} monthly</h3>
          <p>{data.subscriptions.length} locally stored plans</p>
        </div>
        <button className="button primary" onClick={() => setOpen(true)}>
          <Plus size={16} />
          Add plan
        </button>
      </div>
      {data.subscriptions.length ? (
        <div className="subscription-list">
          {data.subscriptions.map((s) => (
            <div key={s.id}>
              <div>
                <strong>{s.providerId}</strong>
                <small>
                  {s.plan} · renews {s.renewalDate}
                </small>
              </div>
              <b>${s.monthlyPrice.toFixed(2)}</b>
              <button
                className="icon-button"
                aria-label="Remove plan"
                onClick={() =>
                  save({
                    ...data,
                    subscriptions: data.subscriptions.filter(
                      (x) => x.id !== s.id,
                    ),
                  })
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={<CreditCard />}
          title="No plans added"
          text="Add a plan manually. Demo screenshots never use real subscription data."
        />
      )}
      {open && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={add}>
            <h3>Add subscription</h3>
            <label className="field">
              <span>Provider</span>
              <input name="provider" required placeholder="Example AI" />
            </label>
            <label className="field">
              <span>Plan</span>
              <input name="plan" required placeholder="Individual" />
            </label>
            <label className="field">
              <span>Monthly price</span>
              <input name="price" type="number" min="0" step="0.01" required />
            </label>
            <label className="field">
              <span>Renewal date</span>
              <input name="renewal" type="date" required />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button className="button primary">Save locally</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function SettingsPage({
  data,
  save,
}: {
  data: AppData;
  save: (d: AppData) => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const enableWebNotifications = async () => {
    if (!("Notification" in window)) {
      setNotice("Browser notifications are unavailable in this environment.");
      return;
    }
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission === "granted")
      save({
        ...data,
        notifications: { ...data.notifications, webEnabled: true },
      });
    else {
      save({
        ...data,
        notifications: { ...data.notifications, webEnabled: false },
      });
      setNotice(`Browser permission is ${permission}.`);
    }
  };
  const testNotification = () => {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      setNotice("Enable browser notifications first.");
      return;
    }
    new Notification("QuotaLoop test notification", {
      body: "Notifications are configured for this browser.",
    });
  };
  return (
    <section>
      <SharedPageTitle
        eyebrow="SETTINGS"
        title="Preferences"
        detail="Appearance, notifications, privacy, and local data."
      />
      <div className="settings-layout">
        <div className="panel settings-panel">
          <h3>Appearance</h3>
          <div className="theme-picker">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                className={data.theme === t ? "active" : ""}
                onClick={() => save({ ...data, theme: t })}
                key={t}
              >
                {t === "light" ? <Sun /> : t === "dark" ? <Moon /> : <Laptop />}
                {t}
              </button>
            ))}
          </div>
          <NotificationPreferencePanel>
            <SharedSettingRow
              title="Web notifications"
              detail={
                data.notifications.webEnabled
                  ? "Enabled for this browser"
                  : "Not enabled"
              }
            >
              <SharedToggle
                value={data.notifications.webEnabled}
                set={(v) => {
                  if (v) void enableWebNotifications();
                  else
                    save({
                      ...data,
                      notifications: {
                        ...data.notifications,
                        webEnabled: false,
                      },
                    });
                }}
              />
            </SharedSettingRow>
          </NotificationPreferencePanel>
          <button className="button secondary" onClick={testNotification}>
            Test browser notification
          </button>
          {notice && (
            <p role="status" className="inline-callout">
              {notice}
            </p>
          )}
        </div>
        <div className="panel settings-panel">
          <h3>Safety & privacy</h3>
          <p>
            QuotaLoop stores settings and activity locally. It never stores raw
            CLI conversations or repository contents.
          </p>
          <button
            className="button secondary"
            onClick={() => {
              repo.clear();
              location.reload();
            }}
          >
            Clear local data
          </button>
        </div>
      </div>
    </section>
  );
}

function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}
function MobileNav() {
  return (
    <nav className="mobile-nav">
      {nav.slice(0, 4).map(([to, label, Icon]) => (
        <NavLink key={to} to={to} end={to === "/"}>
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
      <NavLink to="/settings">
        <Settings />
        <span>Settings</span>
      </NavLink>
    </nav>
  );
}
function SafetyDrawer({
  onClose,
  providerName,
}: {
  onClose: () => void;
  providerName?: string;
}) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="drawer"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Safety and privacy"
      >
        <button
          className="icon-button close"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </button>
        <ShieldCheck size={30} />
        <h2>{providerName ? `${providerName} help` : "Safety & privacy"}</h2>
        <p>
          {providerName
            ? "This standalone web app cannot inspect local CLI state. Connect a Desktop Agent to enable verified detection."
            : "QuotaLoop reads only the provider information needed for enabled capabilities."}
        </p>
        <h3>{providerName ? "Current capability" : "Never uploaded"}</h3>
        <p>
          {providerName
            ? "Demo values are synthetic and labeled. Unavailable values are never estimated."
            : "Credentials, repository content, raw conversations, and subscription records remain local in this beta."}
        </p>
        <h3>{providerName ? "Connection" : "Automation behavior"}</h3>
        <p>
          {providerName
            ? "The Desktop Agent is not connected in standalone web mode."
            : "Automation starts off and supports fixed actions only. Unknown or stale quota stops execution."}
        </p>
      </aside>
    </div>
  );
}
function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      icon: <Gauge />,
      title: "Welcome to QuotaLoop",
      text: "A calm, local-first view of AI service availability.",
    },
    {
      icon: <Bot />,
      title: "Choose providers",
      text: "Demo, Codex, Claude Code, and Gemini CLI are ready to configure.",
    },
    {
      icon: <ShieldCheck />,
      title: "Review permissions",
      text: "No repository access, arbitrary prompts, or cloud uploads.",
    },
    {
      icon: <Bell />,
      title: "Stay informed",
      text: "Configure local notifications after opening the dashboard.",
    },
  ];
  const current = steps[step]!;
  return (
    <main className="onboarding">
      <Brand />
      <div className="onboarding-card">
        <div className="onboarding-icon">{current.icon}</div>
        <p className="eyebrow">
          SETUP {step + 1} OF {steps.length}
        </p>
        <h1>{current.title}</h1>
        <p>{current.text}</p>
        <div className="dots">
          {steps.map((_, i) => (
            <i className={i === step ? "active" : ""} key={i} />
          ))}
        </div>
        <button
          className="button primary"
          onClick={() =>
            step === steps.length - 1 ? onComplete() : setStep(step + 1)
          }
        >
          {step === steps.length - 1 ? "Open dashboard" : "Continue"}
          <ChevronRight size={17} />
        </button>
        <small>Automation remains off until you enable it.</small>
      </div>
    </main>
  );
}
