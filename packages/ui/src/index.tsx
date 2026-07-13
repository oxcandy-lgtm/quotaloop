import type { ReactNode } from "react";

export function PageTitle({
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
export function SettingRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
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
export function Toggle({
  value,
  set,
}: {
  value: boolean;
  set: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => set(!value)}
    >
      {value ? "On" : "Off"}
    </button>
  );
}
export function ProviderStatus({
  name,
  state,
  detail,
}: {
  name: string;
  state: string;
  detail: string;
}) {
  return (
    <div className="provider-status">
      <strong>{name}</strong>
      <span>{state}</span>
      <small>{detail}</small>
    </div>
  );
}
export function HistoryList({ children }: { children: ReactNode }) {
  return <div className="history-list">{children}</div>;
}
export function SubscriptionList({ children }: { children: ReactNode }) {
  return <div className="subscription-list">{children}</div>;
}
export function AIServicePreferenceList({ children }: { children: ReactNode }) {
  return <div className="ai-service-list">{children}</div>;
}
export function NotificationPreferencePanel({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="notification-preferences">{children}</div>;
}
