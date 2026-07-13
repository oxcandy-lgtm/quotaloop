use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    Emitter, Manager, PhysicalPosition, Position, State, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};

mod openrouter;
use openrouter::{
    cancel_openrouter_benchmark, delete_openrouter_key, fetch_openrouter_catalog,
    openrouter_key_status, run_openrouter_benchmark_model, save_openrouter_key,
    test_openrouter_connection, OpenRouterRuntimeState,
};

const DETECTION_TIMEOUT: Duration = Duration::from_secs(2);
const OUTPUT_LIMIT: usize = 16 * 1024;
pub const DETECTABLE_PROVIDER_IDS: &[&str] = &["codex", "claude-code", "gemini-cli", "opencode"];

#[derive(Default)]
struct PopoverBehaviorState {
    auto_hide_suppressed: AtomicBool,
    ignore_next_settings_destroy: AtomicBool,
    settings_recreate_pending: AtomicBool,
    application_quitting: AtomicBool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DetectionState {
    Installed,
    NotInstalled,
    Timeout,
    Failed,
    Unsupported,
}

#[derive(Debug, Clone, Serialize)]
pub struct CliDetection {
    pub provider_id: String,
    pub state: DetectionState,
    pub version: Option<String>,
}

fn provider_executable(provider_id: &str) -> Option<&'static str> {
    if !DETECTABLE_PROVIDER_IDS.contains(&provider_id) {
        return None;
    }
    match provider_id {
        "codex" => Some("codex"),
        "claude-code" => Some("claude"),
        "gemini-cli" => Some("gemini"),
        "opencode" => Some("opencode"),
        _ => None,
    }
}

fn normalize_output(bytes: &[u8]) -> Option<String> {
    let value = String::from_utf8_lossy(&bytes[..bytes.len().min(OUTPUT_LIMIT)]);
    let line = value
        .lines()
        .next()?
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    (!line.is_empty()).then_some(line)
}

fn detect_provider_sync(provider_id: String) -> CliDetection {
    let Some(executable) = provider_executable(&provider_id) else {
        return CliDetection {
            provider_id,
            state: DetectionState::Unsupported,
            version: None,
        };
    };
    let mut child = match Command::new(executable)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => {
            return CliDetection {
                provider_id,
                state: DetectionState::NotInstalled,
                version: None,
            }
        }
    };
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let stdout_thread = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.take(OUTPUT_LIMIT as u64).read_to_end(&mut bytes);
        bytes
    });
    let stderr_thread = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.take(OUTPUT_LIMIT as u64).read_to_end(&mut bytes);
        bytes
    });
    let deadline = Instant::now() + DETECTION_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(Some(status)),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                break Ok(None);
            }
            Err(_) => break Err(()),
        }
    };
    let stdout = stdout_thread.join().unwrap_or_default();
    let _ = stderr_thread.join();
    match status {
        Ok(None) => CliDetection {
            provider_id,
            state: DetectionState::Timeout,
            version: None,
        },
        Ok(Some(status)) if status.success() => CliDetection {
            provider_id,
            state: DetectionState::Installed,
            version: normalize_output(&stdout),
        },
        Ok(Some(_)) | Err(_) => CliDetection {
            provider_id,
            state: DetectionState::Failed,
            version: None,
        },
    }
}

#[tauri::command]
fn detect_provider(provider_id: String) -> CliDetection {
    detect_provider_sync(provider_id)
}

#[tauri::command]
fn get_platform_info() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
fn request_desktop(app: tauri::AppHandle, envelope: serde_json::Value) -> bool {
    app.emit_to("popover", "desktop-requested", envelope)
        .is_ok()
}

#[tauri::command]
fn broadcast_desktop_ack(app: tauri::AppHandle, result: serde_json::Value) {
    let _ = app.emit_to("dashboard", "desktop-ack", &result);
    let _ = app.emit_to("settings", "desktop-ack", &result);
}

#[tauri::command]
fn broadcast_desktop_snapshot(app: tauri::AppHandle, snapshot: serde_json::Value) {
    let _ = app.emit_to("dashboard", "desktop-snapshot", &snapshot);
    let _ = app.emit_to("settings", "desktop-snapshot", &snapshot);
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    show_window(&app, "popover");
}

fn validated_dashboard_section(section: Option<&str>) -> &'static str {
    match section.unwrap_or("overview") {
        "overview" => "overview",
        "providers" => "providers",
        "model_lab" => "model_lab",
        "automation" => "automation",
        "history" => "history",
        "signals" => "signals",
        "subscriptions" => "subscriptions",
        "settings" => "settings",
        _ => "overview",
    }
}

fn set_auto_hide_suppressed(app: &tauri::AppHandle, suppressed: bool) {
    if let Some(state) = app.try_state::<PopoverBehaviorState>() {
        state
            .auto_hide_suppressed
            .store(suppressed, Ordering::SeqCst);
    }
}

fn set_ignore_next_settings_destroy(app: &tauri::AppHandle, ignore: bool) {
    if let Some(state) = app.try_state::<PopoverBehaviorState>() {
        state
            .ignore_next_settings_destroy
            .store(ignore, Ordering::SeqCst);
    }
}

fn set_application_quitting(app: &tauri::AppHandle, quitting: bool) {
    if let Some(state) = app.try_state::<PopoverBehaviorState>() {
        state.application_quitting.store(quitting, Ordering::SeqCst);
    }
}

fn application_is_quitting(app: &tauri::AppHandle) -> bool {
    app.try_state::<PopoverBehaviorState>()
        .map(|state| state.application_quitting.load(Ordering::SeqCst))
        .unwrap_or(false)
}

fn try_begin_settings_recreation(app: &tauri::AppHandle) -> bool {
    app.try_state::<PopoverBehaviorState>()
        .map(|state| {
            state
                .settings_recreate_pending
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        })
        .unwrap_or(false)
}

fn take_settings_recreation_pending(app: &tauri::AppHandle) -> bool {
    app.try_state::<PopoverBehaviorState>()
        .map(|state| {
            state
                .settings_recreate_pending
                .swap(false, Ordering::SeqCst)
        })
        .unwrap_or(false)
}

fn clear_settings_destroy_marker_state(state: &PopoverBehaviorState) {
    state
        .ignore_next_settings_destroy
        .store(false, Ordering::SeqCst);
    state
        .settings_recreate_pending
        .store(false, Ordering::SeqCst);
}

fn clear_settings_destroy_markers(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<PopoverBehaviorState>() {
        clear_settings_destroy_marker_state(&state);
    }
}

fn clear_settings_suppression_if_closed(app: &tauri::AppHandle) {
    let settings_visible = app
        .get_webview_window("settings")
        .and_then(|settings| settings.is_visible().ok())
        .unwrap_or(false);
    if !settings_visible {
        set_auto_hide_suppressed(app, false);
    }
}

fn open_dashboard_window(app: &tauri::AppHandle, section: Option<&str>) {
    let selected = validated_dashboard_section(section);
    clear_settings_suppression_if_closed(app);
    show_window(app, "dashboard");
    let _ = app.emit_to("dashboard", "section-selected", selected);
}

#[tauri::command]
fn open_dashboard(app: tauri::AppHandle, section: Option<String>) -> Result<(), String> {
    if validated_dashboard_section(section.as_deref()) == "settings" {
        return open_settings_window_internal(&app);
    }
    open_dashboard_window(&app, section.as_deref());
    Ok(())
}

#[tauri::command]
fn set_dashboard_section(
    app: tauri::AppHandle,
    _state: State<'_, PopoverBehaviorState>,
    section: String,
) -> String {
    let selected = validated_dashboard_section(Some(section.as_str()));
    clear_settings_suppression_if_closed(&app);
    selected.to_string()
}

#[derive(Debug, PartialEq, Eq)]
enum SettingsWindowAction {
    DashboardFallback,
    Create,
    FocusExisting,
    DestroyAndCreate,
}

#[derive(Debug, PartialEq, Eq)]
enum SettingsDestroyAction {
    ReleaseOnly,
    RestorePopover,
}

fn settings_window_action(
    is_macos: bool,
    existing: bool,
    visible: Option<bool>,
) -> SettingsWindowAction {
    if !is_macos {
        SettingsWindowAction::DashboardFallback
    } else if existing && visible == Some(true) {
        SettingsWindowAction::FocusExisting
    } else if existing {
        SettingsWindowAction::DestroyAndCreate
    } else {
        SettingsWindowAction::Create
    }
}

fn consume_settings_destroy_action(
    ignore_next_settings_destroy: &AtomicBool,
    application_quitting: &AtomicBool,
) -> SettingsDestroyAction {
    let ignore = ignore_next_settings_destroy.swap(false, Ordering::SeqCst);
    if application_quitting.load(Ordering::SeqCst) || ignore {
        SettingsDestroyAction::ReleaseOnly
    } else {
        SettingsDestroyAction::RestorePopover
    }
}

fn consume_settings_destroy_action_for_app(app: &tauri::AppHandle) -> SettingsDestroyAction {
    app.try_state::<PopoverBehaviorState>()
        .map(|state| {
            consume_settings_destroy_action(
                &state.ignore_next_settings_destroy,
                &state.application_quitting,
            )
        })
        .unwrap_or(SettingsDestroyAction::ReleaseOnly)
}

fn release_settings_suppression(app: &tauri::AppHandle) {
    set_auto_hide_suppressed(app, false);
}

fn restore_popover_after_settings_close(app: &tauri::AppHandle) {
    release_settings_suppression(app);
    if let Some(popover) = app.get_webview_window("popover") {
        let _ = popover.show();
        let _ = popover.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn cleanup_settings_open_failure(app: &tauri::AppHandle) {
    clear_settings_destroy_markers(app);
    restore_popover_after_settings_close(app);
}

#[cfg(target_os = "macos")]
fn focus_settings_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn create_settings_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = match WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html?surface=settings".into()),
    )
    .title("QuotaLoop Settings")
    .inner_size(520.0, 620.0)
    .min_inner_size(480.0, 520.0)
    .max_inner_size(680.0, 760.0)
    .resizable(true)
    .decorations(true)
    .always_on_top(false)
    .visible(false)
    .build()
    {
        Ok(window) => window,
        Err(error) => {
            cleanup_settings_open_failure(app);
            return Err(error.to_string());
        }
    };

    if let Err(error) = focus_settings_window(&window) {
        let _ = window.destroy();
        cleanup_settings_open_failure(app);
        return Err(error);
    }
    Ok(())
}

fn recreate_settings_after_destroy(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        set_auto_hide_suppressed(app, true);
        if let Err(error) = create_settings_window(app) {
            eprintln!("failed to recreate Settings window: {error}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        release_settings_suppression(app);
    }
}

fn open_settings_window_internal(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        open_dashboard_window(app, Some("settings"));
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        set_auto_hide_suppressed(app, true);

        if app
            .try_state::<PopoverBehaviorState>()
            .map(|state| state.settings_recreate_pending.load(Ordering::SeqCst))
            .unwrap_or(false)
        {
            return Ok(());
        }

        let existing = app.get_webview_window("settings");
        let action = settings_window_action(
            true,
            existing.is_some(),
            existing
                .as_ref()
                .and_then(|window| window.is_visible().ok()),
        );
        match action {
            SettingsWindowAction::FocusExisting => {
                if let Some(window) = existing {
                    if let Err(error) = focus_settings_window(&window) {
                        cleanup_settings_open_failure(app);
                        return Err(error);
                    }
                    return Ok(());
                }
            }
            SettingsWindowAction::DestroyAndCreate => {
                if let Some(window) = existing {
                    if !try_begin_settings_recreation(app) {
                        return Ok(());
                    }
                    set_ignore_next_settings_destroy(app, true);
                    if let Err(error) = window.destroy() {
                        cleanup_settings_open_failure(app);
                        return Err(error.to_string());
                    }
                    // The replacement is created by the matching Destroyed event.
                    return Ok(());
                }
            }
            SettingsWindowAction::Create | SettingsWindowAction::DashboardFallback => {}
        }
        create_settings_window(app)
    }
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    open_settings_window_internal(&app)
}

#[tauri::command]
fn get_window_label(window: tauri::Window) -> String {
    window.label().to_string()
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("popover") {
        let _ = window.hide();
    }
}

fn show_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_window(app: &tauri::AppHandle, force_show: bool) {
    if let Some(window) = app.get_webview_window("popover") {
        let visible = window.is_visible().unwrap_or(false);
        if force_show || !visible {
            let _ = window.show();
            let _ = window.set_focus();
        } else {
            let _ = window.hide();
        }
    }
}

fn should_auto_hide_on_focus_loss(
    is_macos: bool,
    window_label: &str,
    focused: bool,
    auto_hide_suppressed: bool,
) -> bool {
    is_macos && !focused && window_label == "popover" && !auto_hide_suppressed
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuBuilder::new(app)
        .text("open", "Open QuotaLoop")
        .text("refresh", "Refresh providers")
        .text("pause", "Pause/resume automation")
        .separator()
        .text("quit", "Quit")
        .build()?;
    let handle = app.handle().clone();
    TrayIconBuilder::new()
        .icon(
            app.default_window_icon()
                .cloned()
                .expect("generated app icon"),
        )
        .menu(&open)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => open_dashboard_window(app, None),
            "refresh" => {
                let _ = app.emit_to("popover", "tray-refresh-requested", ());
            }
            "pause" => {
                let _ = app.emit_to("popover", "tray-pause-requested", ());
            }
            "quit" => {
                set_application_quitting(app, true);
                clear_settings_destroy_markers(app);
                set_auto_hide_suppressed(app, false);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                position,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = handle.get_webview_window("popover") {
                    let _ = window.set_position(Position::Physical(PhysicalPosition::new(
                        (position.x as i32).saturating_sub(190),
                        position.y as i32 + 8,
                    )));
                    toggle_window(&handle, false);
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PopoverBehaviorState::default())
        .manage(OpenRouterRuntimeState::default())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_platform_info,
            request_desktop,
            broadcast_desktop_ack,
            broadcast_desktop_snapshot,
            show_main_window,
            open_dashboard,
            open_settings_window,
            set_dashboard_section,
            get_window_label,
            hide_main_window,
            detect_provider,
            openrouter_key_status,
            save_openrouter_key,
            delete_openrouter_key,
            test_openrouter_connection,
            fetch_openrouter_catalog,
            run_openrouter_benchmark_model,
            cancel_openrouter_benchmark
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "settings" {
                match event {
                    WindowEvent::CloseRequested { .. } => {
                        return;
                    }
                    WindowEvent::Destroyed => {
                        let app = window.app_handle();
                        let action = consume_settings_destroy_action_for_app(&app);
                        if take_settings_recreation_pending(&app) && !application_is_quitting(&app)
                        {
                            release_settings_suppression(&app);
                            recreate_settings_after_destroy(&app);
                        } else {
                            match action {
                                SettingsDestroyAction::RestorePopover => {
                                    restore_popover_after_settings_close(&app)
                                }
                                SettingsDestroyAction::ReleaseOnly => {
                                    release_settings_suppression(&app)
                                }
                            }
                        }
                        return;
                    }
                    _ => {}
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "dashboard" {
                    let settings_visible = window
                        .app_handle()
                        .get_webview_window("settings")
                        .and_then(|settings| settings.is_visible().ok())
                        .unwrap_or(false);
                    if !settings_visible {
                        set_auto_hide_suppressed(&window.app_handle(), false);
                    }
                }
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(target_os = "macos")]
            if let WindowEvent::Focused(false) = event {
                let suppressed = window
                    .app_handle()
                    .state::<PopoverBehaviorState>()
                    .auto_hide_suppressed
                    .load(Ordering::SeqCst);
                if should_auto_hide_on_focus_loss(
                    cfg!(target_os = "macos"),
                    window.label(),
                    false,
                    suppressed,
                ) {
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run QuotaLoop");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;
    #[test]
    fn allowlist_is_fixed() {
        assert_eq!(
            DETECTABLE_PROVIDER_IDS,
            &["codex", "claude-code", "gemini-cli", "opencode"]
        );
        assert_eq!(provider_executable("codex"), Some("codex"));
        assert_eq!(provider_executable("claude-code"), Some("claude"));
    }
    #[test]
    fn unsupported_provider_is_rejected() {
        assert_eq!(provider_executable("custom-shell"), None);
        assert_eq!(
            detect_provider_sync("custom-shell".into()).state,
            DetectionState::Unsupported
        );
    }
    #[test]
    fn macos_focus_loss_hides_only_an_unsuppressed_popover() {
        assert!(should_auto_hide_on_focus_loss(
            true, "popover", false, false
        ));
        assert!(!should_auto_hide_on_focus_loss(
            true, "popover", false, true
        ));
        assert!(!should_auto_hide_on_focus_loss(
            true,
            "dashboard",
            false,
            false
        ));
        assert!(!should_auto_hide_on_focus_loss(
            true, "popover", true, false
        ));
    }
    #[test]
    fn non_macos_focus_loss_does_not_hide_the_popover() {
        assert!(!should_auto_hide_on_focus_loss(
            false, "popover", false, false
        ));
    }
    #[test]
    fn dashboard_section_allowlist_does_not_control_settings_lifecycle() {
        assert_eq!(validated_dashboard_section(Some("settings")), "settings");
        assert_eq!(validated_dashboard_section(Some("model_lab")), "model_lab");
        assert_eq!(validated_dashboard_section(Some("unexpected")), "overview");
        assert_eq!(validated_dashboard_section(None), "overview");
    }
    #[test]
    fn settings_window_lifecycle_is_platform_and_visibility_aware() {
        assert_eq!(
            settings_window_action(false, false, None),
            SettingsWindowAction::DashboardFallback
        );
        assert_eq!(
            settings_window_action(true, false, None),
            SettingsWindowAction::Create
        );
        assert_eq!(
            settings_window_action(true, true, Some(true)),
            SettingsWindowAction::FocusExisting
        );
        assert_eq!(
            settings_window_action(true, true, Some(false)),
            SettingsWindowAction::DestroyAndCreate
        );
        assert_eq!(
            settings_window_action(true, true, None),
            SettingsWindowAction::DestroyAndCreate
        );
    }
    #[test]
    fn settings_user_close_consumes_no_internal_marker_and_restores_popover() {
        let marker = AtomicBool::new(false);
        let quitting = AtomicBool::new(false);
        assert_eq!(
            consume_settings_destroy_action(&marker, &quitting),
            SettingsDestroyAction::RestorePopover
        );
        assert!(should_auto_hide_on_focus_loss(
            true, "popover", false, false
        ));
    }

    #[test]
    fn internal_recreate_marker_is_consumed_once_then_normal_close_restores() {
        let marker = AtomicBool::new(true);
        let quitting = AtomicBool::new(false);
        assert_eq!(
            consume_settings_destroy_action(&marker, &quitting),
            SettingsDestroyAction::ReleaseOnly
        );
        assert!(!marker.load(Ordering::SeqCst));
        assert_eq!(
            consume_settings_destroy_action(&marker, &quitting),
            SettingsDestroyAction::RestorePopover
        );
    }

    #[test]
    fn internal_destroy_marker_survives_later_state_changes_until_destroyed_event() {
        let marker = Arc::new(AtomicBool::new(false));
        let quitting = Arc::new(AtomicBool::new(false));
        let unrelated_state = Arc::new(AtomicBool::new(true));
        let ready = Arc::new(Barrier::new(2));
        let thread_marker = Arc::clone(&marker);
        let thread_quitting = Arc::clone(&quitting);
        let thread_ready = Arc::clone(&ready);
        let handle = thread::spawn(move || {
            while !thread_marker.load(Ordering::SeqCst) {
                thread::yield_now();
            }
            thread_ready.wait();
            consume_settings_destroy_action(&thread_marker, &thread_quitting)
        });

        marker.store(true, Ordering::SeqCst);
        unrelated_state.store(false, Ordering::SeqCst);
        unrelated_state.store(true, Ordering::SeqCst);
        ready.wait();

        assert_eq!(
            handle.join().expect("destroy event thread should finish"),
            SettingsDestroyAction::ReleaseOnly
        );
        assert!(!marker.load(Ordering::SeqCst));
    }

    #[test]
    fn two_destroy_reads_after_one_internal_marker_are_deterministic() {
        let marker = AtomicBool::new(true);
        let quitting = AtomicBool::new(false);
        assert_eq!(
            consume_settings_destroy_action(&marker, &quitting),
            SettingsDestroyAction::ReleaseOnly
        );
        assert_eq!(
            consume_settings_destroy_action(&marker, &quitting),
            SettingsDestroyAction::RestorePopover
        );
    }

    #[test]
    fn application_quit_forces_release_only_and_consumes_marker() {
        let marker = AtomicBool::new(true);
        let quitting = AtomicBool::new(true);
        assert_eq!(
            consume_settings_destroy_action(&marker, &quitting),
            SettingsDestroyAction::ReleaseOnly
        );
        assert!(!marker.load(Ordering::SeqCst));
    }

    #[test]
    fn settings_open_failure_clears_suppression_and_destroy_markers() {
        let state = PopoverBehaviorState::default();
        state.auto_hide_suppressed.store(true, Ordering::SeqCst);
        state
            .ignore_next_settings_destroy
            .store(true, Ordering::SeqCst);
        state
            .settings_recreate_pending
            .store(true, Ordering::SeqCst);

        clear_settings_destroy_marker_state(&state);
        state.auto_hide_suppressed.store(false, Ordering::SeqCst);

        assert!(!state.auto_hide_suppressed.load(Ordering::SeqCst));
        assert!(!state.ignore_next_settings_destroy.load(Ordering::SeqCst));
        assert!(!state.settings_recreate_pending.load(Ordering::SeqCst));
    }
}
