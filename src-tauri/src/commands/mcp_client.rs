//! Cliente Model Context Protocol (MCP) para Scorpk.
//! Permite que Scorpk se conecte a servidores MCP externos (vía stdio o SSE)
//! para descubrir y ejecutar herramientas externas (Postgres, GitHub, Filesystem, etc.).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    pub server_id: String,
    pub name: String,
    pub description: Option<String>,
    pub input_schema: Value,
}

#[derive(Default)]
pub struct McpClientState {
    pub servers: Mutex<Vec<McpServerConfig>>,
}

fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("mcp_clients.json"))
}

#[tauri::command]
pub fn mcp_get_servers(app: tauri::AppHandle) -> Result<Vec<McpServerConfig>, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let list: Vec<McpServerConfig> = serde_json::from_str(&data).unwrap_or_default();
    Ok(list)
}

#[tauri::command]
pub fn mcp_save_servers(app: tauri::AppHandle, servers: Vec<McpServerConfig>) -> Result<(), String> {
    let path = config_path(&app)?;
    let data = serde_json::to_string_pretty(&servers).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(())
}

/// Ejecuta un servidor MCP por stdio para listar sus herramientas
#[tauri::command]
pub async fn mcp_discover_tools(
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&command);
        cmd.args(&args)
            .envs(&env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn().map_err(|e| format!("No se pudo iniciar el servidor MCP: {e}"))?;

        let mut stdin = child.stdin.take().ok_or("Sin stdin")?;
        let stdout = child.stdout.take().ok_or("Sin stdout")?;
        let mut reader = BufReader::new(stdout);

        // 1. initialize
        let init_req = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "scorpk-desktop",
                    "version": "0.1.5"
                }
            }
        });
        writeln!(stdin, "{}", serde_json::to_string(&init_req).unwrap()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;

        let mut init_resp = String::new();
        reader.read_line(&mut init_resp).map_err(|e| e.to_string())?;

        // 2. notifications/initialized
        let notif = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        writeln!(stdin, "{}", serde_json::to_string(&notif).unwrap()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;

        // 3. tools/list
        let tools_req = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        });
        writeln!(stdin, "{}", serde_json::to_string(&tools_req).unwrap()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;

        let mut tools_resp = String::new();
        reader.read_line(&mut tools_resp).map_err(|e| e.to_string())?;

        let _ = child.kill();

        let parsed: Value = serde_json::from_str(&tools_resp)
            .map_err(|e| format!("Respuesta inválida: {e}. Salida: {tools_resp}"))?;

        let tools = parsed
            .get("result")
            .and_then(|r| r.get("tools"))
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(tools)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ejecuta una herramienta en un servidor MCP
#[tauri::command]
pub async fn mcp_call_tool(
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    name: String,
    arguments: Value,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&command);
        cmd.args(&args)
            .envs(&env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn().map_err(|e| format!("No se pudo iniciar el servidor MCP: {e}"))?;

        let mut stdin = child.stdin.take().ok_or("Sin stdin")?;
        let stdout = child.stdout.take().ok_or("Sin stdout")?;
        let mut reader = BufReader::new(stdout);

        // 1. initialize
        let init_req = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "scorpk-desktop", "version": "0.1.5" }
            }
        });
        writeln!(stdin, "{}", serde_json::to_string(&init_req).unwrap()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;

        let mut init_resp = String::new();
        reader.read_line(&mut init_resp).map_err(|e| e.to_string())?;

        // 2. notifications/initialized
        let notif = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        writeln!(stdin, "{}", serde_json::to_string(&notif).unwrap()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;

        // 3. tools/call
        let call_req = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments
            }
        });
        writeln!(stdin, "{}", serde_json::to_string(&call_req).unwrap()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;

        let mut call_resp = String::new();
        reader.read_line(&mut call_resp).map_err(|e| e.to_string())?;

        let _ = child.kill();

        let parsed: Value = serde_json::from_str(&call_resp)
            .map_err(|e| format!("Error parseando respuesta de tool: {e}"))?;

        if let Some(err) = parsed.get("error") {
            return Err(format!("Error de MCP tool: {err}"));
        }

        let content = parsed
            .get("result")
            .and_then(|r| r.get("content"))
            .and_then(|c| c.as_array());

        if let Some(items) = content {
            let mut texts = Vec::new();
            for item in items {
                if let Some(t) = item.get("text").and_then(|txt| txt.as_str()) {
                    texts.push(t.to_string());
                }
            }
            if !texts.is_empty() {
                return Ok(texts.join("\n"));
            }
        }

        Ok(call_resp)
    })
    .await
    .map_err(|e| e.to_string())?
}
