use serde::Serialize;
use tauri::{Manager, WindowEvent};

#[derive(Serialize)]
struct CliDetection {
    provider_id: String,
    installed: bool,
    version: Option<String>,
}

#[tauri::command]
fn detect_provider(provider_id: String) -> CliDetection {
    let executable = match provider_id.as_str() {
        "codex" => Some("codex"),
        "claude-code" => Some("claude"),
        "gemini-cli" => Some("gemini"),
        "opencode" => Some("opencode"),
        _ => None,
    };
    let output = executable.and_then(|name| {
        std::process::Command::new(name)
            .arg("--version")
            .output()
            .ok()
    });
    let installed = output
        .as_ref()
        .is_some_and(|result| result.status.success());
    let version = output.and_then(|result| {
        let value = String::from_utf8_lossy(&result.stdout)
            .trim()
            .chars()
            .take(120)
            .collect::<String>();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    });
    CliDetection {
        provider_id,
        installed,
        version,
    }
}

#[tauri::command]
fn get_platform_info() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_platform_info,
            show_main_window,
            hide_main_window,
            detect_provider
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run QuotaLoop");
}
