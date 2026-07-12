export type NotificationPreferences = {
  enabled: boolean;
  actionCompleted: boolean;
};
export function shouldDeliverNotification(input: {
  preferences: NotificationPreferences;
  permission: boolean;
  eventKey: string;
  lastEventKey: string | null;
}): boolean {
  return (
    input.preferences.enabled &&
    input.preferences.actionCompleted &&
    input.permission &&
    input.eventKey !== input.lastEventKey
  );
}
