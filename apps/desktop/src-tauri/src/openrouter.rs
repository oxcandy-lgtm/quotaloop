use chrono::{SecondsFormat, Utc};
use futures_util::StreamExt;
use keyring::Entry;
use reqwest::{Client, StatusCode};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

pub const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const OPENROUTER_SERVICE: &str = "app.quotaloop.desktop";
const OPENROUTER_ACCOUNT: &str = "openrouter-api-key";
const ENV_KEY: &str = "OPENROUTER_API_KEY";
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;
const MAX_SSE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct OpenRouterRuntimeState {
    pub cancel_requested: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeySource {
    Keychain,
    Environment,
    None,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct KeyStatus {
    pub configured: bool,
    pub source: KeySource,
    pub last_four: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SseParseResult {
    pub text: String,
    pub usage: Option<Value>,
    pub saw_done: bool,
}

fn sanitized_error(status: Option<StatusCode>) -> String {
    match status {
        Some(StatusCode::UNAUTHORIZED) => "OpenRouter authentication failed (401).".into(),
        Some(StatusCode::FORBIDDEN) => "OpenRouter access was denied (403).".into(),
        Some(StatusCode::PAYMENT_REQUIRED) => {
            "OpenRouter requires an eligible free-tier account (402).".into()
        }
        Some(StatusCode::TOO_MANY_REQUESTS) => "OpenRouter rate limit reached (429).".into(),
        Some(status) if status.is_server_error() => "OpenRouter server error; retry later.".into(),
        Some(status) => format!("OpenRouter request failed ({})", status.as_u16()),
        None => "OpenRouter request failed.".into(),
    }
}

fn validate_key(key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.len() < 12 || trimmed.len() > 512 || trimmed.contains(char::is_whitespace) {
        return Err("OpenRouter key format is invalid.".into());
    }
    if !trimmed.starts_with("sk-or-") {
        return Err("OpenRouter key format is invalid.".into());
    }
    Ok(())
}

fn keyring_entry() -> Result<Entry, String> {
    Entry::new(OPENROUTER_SERVICE, OPENROUTER_ACCOUNT)
        .map_err(|_| "Native secret storage is unavailable.".into())
}

fn keyring_key() -> Result<Option<String>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let entry = keyring_entry()?;
        match entry.get_password() {
            Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
            Ok(_) => Ok(None),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("Native secret storage is unavailable.".into()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(None)
    }
}

fn current_key() -> Result<(String, KeySource), String> {
    match keyring_key()? {
        Some(value) => return Ok((value, KeySource::Keychain)),
        None => {}
    }
    if let Ok(value) = std::env::var(ENV_KEY) {
        validate_key(&value)?;
        return Ok((value, KeySource::Environment));
    }
    Err("OpenRouter API key is not configured.".into())
}

fn status_for(value: Option<(String, KeySource)>) -> KeyStatus {
    match value {
        Some((key, source)) => KeyStatus {
            configured: true,
            source,
            last_four: key
                .chars()
                .rev()
                .take(4)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>()
                .into(),
        },
        None => KeyStatus {
            configured: false,
            source: KeySource::None,
            last_four: None,
        },
    }
}

pub fn parse_sse_events(input: &str) -> Result<SseParseResult, String> {
    if input.len() > MAX_SSE_BYTES {
        return Err("OpenRouter response exceeded the safety limit.".into());
    }
    let mut text = String::new();
    let mut usage = None;
    let mut saw_done = false;
    for line in input.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(':') || !line.starts_with("data:") {
            continue;
        }
        let data = line.trim_start_matches("data:").trim();
        if data == "[DONE]" {
            saw_done = true;
            continue;
        }
        let value: Value = serde_json::from_str(data)
            .map_err(|_| "OpenRouter returned an invalid stream event.".to_string())?;
        if value.get("error").is_some() {
            return Err("OpenRouter returned an error while streaming.".into());
        }
        if let Some(next) = value
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
        {
            text.push_str(next);
            if text.len() > 1_000_000 {
                return Err("OpenRouter response exceeded the safety limit.".into());
            }
        }
        if let Some(next_usage) = value.get("usage") {
            usage = Some(next_usage.clone());
        }
    }
    if !saw_done {
        return Err("OpenRouter stream ended before completion.".into());
    }
    Ok(SseParseResult {
        text,
        usage,
        saw_done,
    })
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .user_agent("QuotaLoop/0.1")
        .build()
        .map_err(|_| "OpenRouter HTTPS client could not be initialized.".into())
}

async fn bounded_response(response: reqwest::Response) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(sanitized_error(Some(response.status())));
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| sanitized_error(None))?;
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            return Err("OpenRouter response exceeded the safety limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn get_json(path: &str) -> Result<Value, String> {
    let (key, _) = current_key()?;
    let url = match path {
        "/key" | "/models" => format!("{OPENROUTER_BASE_URL}{path}"),
        _ => return Err("OpenRouter endpoint is not allowlisted.".into()),
    };
    let response = build_client()?
        .get(url)
        .bearer_auth(key)
        .header("X-OpenRouter-Title", "QuotaLoop")
        .send()
        .await
        .map_err(|_| sanitized_error(None))?;
    let body = bounded_response(response).await?;
    serde_json::from_slice(&body).map_err(|_| "OpenRouter returned invalid JSON.".into())
}

#[tauri::command]
pub fn openrouter_key_status() -> KeyStatus {
    status_for(current_key().ok())
}

#[tauri::command]
pub fn save_openrouter_key(key: String) -> Result<KeyStatus, String> {
    validate_key(&key)?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        keyring_entry()?
            .set_password(key.trim())
            .map_err(|_| "Native secret storage is unavailable.".to_string())?;
        return Ok(status_for(Some((
            key.trim().to_string(),
            KeySource::Keychain,
        ))));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Native secret storage is unavailable on this platform.".into())
    }
}

#[tauri::command]
pub fn delete_openrouter_key() -> Result<KeyStatus, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let entry = keyring_entry()?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(status_for(None)),
            Err(_) => Err("Native secret storage is unavailable.".into()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err("Native secret storage is unavailable on this platform.".into())
    }
}

#[tauri::command]
pub async fn test_openrouter_connection() -> Result<Value, String> {
    let result = get_json("/key").await?;
    Ok(json!({
        "ok": true,
        "valid": result.get("data").is_some(),
        "credits": result.get("data").and_then(|data| data.get("limit")).and_then(Value::as_f64).is_some(),
    }))
}

#[tauri::command]
pub async fn fetch_openrouter_catalog() -> Result<Value, String> {
    get_json("/models").await
}

#[tauri::command]
pub async fn run_openrouter_benchmark_model(
    model_id: String,
    run_id: String,
    manifest: Value,
    state: State<'_, OpenRouterRuntimeState>,
) -> Result<Value, String> {
    if !model_id.contains('/') || model_id.contains("openrouter/") || !model_id.ends_with(":free") {
        return Err("Only allowlisted free OpenRouter models may run.".into());
    }
    let (key, _) = current_key()?;
    state.cancel_requested.store(false, Ordering::SeqCst);
    let cases = manifest.get("cases").cloned().unwrap_or_else(|| json!([]));
    let prompt = format!(
        "Run each numbered task and return a JSON array with id and answer only. Tasks: {}",
        cases
    );
    let response = build_client()?
        .post(format!("{OPENROUTER_BASE_URL}/chat/completions"))
        .bearer_auth(key)
        .header("Content-Type", "application/json")
        .header("X-OpenRouter-Title", "QuotaLoop")
        .json(&json!({
            "model": model_id,
            "messages": [
                {"role": "system", "content": manifest.get("systemPrompt").and_then(Value::as_str).unwrap_or("Answer concisely.")},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0,
            "max_tokens": 700,
            "stream": true
        }))
        .send()
        .await
        .map_err(|_| sanitized_error(None))?;
    if !response.status().is_success() {
        return Err(sanitized_error(Some(response.status())));
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        if state.cancel_requested.load(Ordering::SeqCst) {
            return Err("OpenRouter benchmark cancelled.".into());
        }
        let chunk = chunk.map_err(|_| sanitized_error(None))?;
        if bytes.len() + chunk.len() > MAX_SSE_BYTES {
            return Err("OpenRouter response exceeded the safety limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let parsed = parse_sse_events(&String::from_utf8_lossy(&bytes))?;
    Ok(json!({
        "id": run_id,
        "modelId": model_id,
        "modelName": model_id,
        "manifestId": manifest.get("manifestId").and_then(Value::as_str).unwrap_or("quotaloop.openrouter.free-benchmark.v1"),
        "catalogHash": manifest.get("catalogHash").and_then(Value::as_str).unwrap_or(""),
        "completedAt": chrono_like_now(),
        "outcome": "success",
        "metrics": {"correctness": 0, "instructionFollowing": 0, "ttftMs": null, "totalLatencyMs": null, "throughputTokensPerSecond": null, "tokenUsage": {"prompt": null, "completion": null, "total": null}, "overallScore": 0},
        "caseScores": [],
        "answerText": parsed.text
    }))
}

fn chrono_like_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[tauri::command]
pub fn cancel_openrouter_benchmark(state: State<'_, OpenRouterRuntimeState>) -> Result<(), String> {
    state.cancel_requested.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_parser_collects_content_and_usage_without_exposing_headers() {
        let parsed = parse_sse_events(
            ": comment\ndata: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: {\"usage\":{\"total_tokens\":2}}\n\ndata: [DONE]\n",
        )
        .unwrap();
        assert_eq!(parsed.text, "ok");
        assert!(parsed.usage.is_some());
        assert!(parsed.saw_done);
    }

    #[test]
    fn sse_parser_rejects_missing_done_and_errors() {
        assert!(parse_sse_events("data: {\"choices\":[]}").is_err());
        assert!(parse_sse_events("data: {\"error\":{}}\ndata: [DONE]").is_err());
    }

    #[test]
    fn key_status_never_contains_a_full_secret() {
        let status = status_for(Some(("sk-or-abcdef123456".into(), KeySource::Environment)));
        assert_eq!(status.last_four.as_deref(), Some("3456"));
    }
}
