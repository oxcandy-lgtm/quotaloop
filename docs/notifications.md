# Notifications

The desktop shell integrates the Tauri notification permission path and the web application can use the browser Notification API after explicit permission. Notification preferences are local. Native delivery requires interactive OS permission and is verified using the manual QA checklist.

The settings screen provides an explicit browser/native test action. Demo action completion is sent only when enabled and is deduplicated by the local idempotency key. Denied or unavailable permission is shown as a status message.
