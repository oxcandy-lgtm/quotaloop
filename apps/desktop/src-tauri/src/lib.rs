use serde::Serialize;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, PhysicalPosition, Position, WindowEvent};

const DETECTION_TIMEOUT: Duration = Duration::from_secs(2);
const OUTPUT_LIMIT: usize = 16 * 1024;

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
fn set_automation_paused(app: tauri::AppHandle, paused: bool) -> bool {
    let _ = app.emit("automation-state-changed", paused);
    paused
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    show_window(&app, "popover");
}

#[tauri::command]
fn open_dashboard(app: tauri::AppHandle) {
    show_window(&app, "dashboard");
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
            "open" => show_window(app, "dashboard"),
            "refresh" => {
                let _ = app.emit("refresh-providers", ());
            }
            "pause" => {
                let _ = app.emit("automation-pause-requested", ());
            }
            "quit" => app.exit(0),
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
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_platform_info,
            set_automation_paused,
            show_main_window,
            open_dashboard,
            get_window_label,
            hide_main_window,
            detect_provider
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
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run QuotaLoop");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn allowlist_is_fixed() {
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
}
