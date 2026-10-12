//! Comandos Tauri para el control de dispositivos móviles Android vía Google ARTEMIS / ADB.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneDevice {
    pub serial: String,
    pub state: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhoneResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub devices: Option<Vec<PhoneDevice>>,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo obtener la carpeta de datos: {e}"))
}

fn script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?;
    let path = dir.join("artemis_bridge.py");
    let script = include_str!("../../../scripts/artemis_bridge.py");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
    std::fs::write(&path, script).map_err(|e| format!("No se pudo escribir el script: {e}"))?;
    Ok(path)
}

fn find_python() -> Option<String> {
    for name in ["python", "python3", "py"] {
        if Command::new(name)
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some(name.to_string());
        }
    }
    None
}

fn run_bridge(app: &tauri::AppHandle, request_json: &str) -> Result<PhoneResult, String> {
    let python = find_python().ok_or("No se encontró Python en el sistema.")?;
    let script = script_path(app)?;

    let output = Command::new(&python)
        .arg(&script)
        .arg(request_json)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("Error ejecutando puente ARTEMIS: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("El script no devolvió salida. Stderr: {stderr}"));
    }

    serde_json::from_str::<PhoneResult>(stdout.trim())
        .map_err(|e| format!("Respuesta inválida: {e}. Salida: {stdout}"))
}

/// Lista los dispositivos conectados por ADB.
#[tauri::command]
pub async fn phone_list_devices(app: tauri::AppHandle) -> Result<PhoneResult, String> {
    let req = serde_json::json!({ "command": "list_devices" });
    run_bridge(&app, &req.to_string())
}

/// Conecta inalámbricamente a un teléfono vía ADB (IP y puerto).
#[tauri::command]
pub async fn phone_connect_wireless(app: tauri::AppHandle, host: String, port: u16) -> Result<PhoneResult, String> {
    let req = serde_json::json!({
        "command": "connect",
        "host": host.trim(),
        "port": port
    });
    run_bridge(&app, &req.to_string())
}

/// Ejecuta una tarea en lenguaje natural en el teléfono vía ARTEMIS / ADB.
#[tauri::command]
pub async fn phone_run_task(app: tauri::AppHandle, task: String, serial: Option<String>) -> Result<PhoneResult, String> {
    let mut req = serde_json::json!({
        "command": "run_task",
        "task": task.trim()
    });
    if let Some(s) = serial {
        if !s.trim().is_empty() {
            req["serial"] = serde_json::Value::String(s.trim().to_string());
        }
    }
    run_bridge(&app, &req.to_string())
}
