//! Comandos para controlar un televisor Samsung (Tizen) desde Scorpk.
//!
//! Arquitectura:
//! - Wake-on-LAN (encendido) → paquete UDP nativo desde Rust.
//! - Resto de acciones → se ejecuta el script Python `samsung_controller.py` vía `std::process::Command`.
//! - Configuración (IP, MAC, puerto) → archivo JSON en la carpeta de datos de la app.
//! - Token de autorización de la TV → archivo de texto gestionado por samsungtvws.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::Manager;

/// Resultado de un comando de TV que se devuelve al frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TvResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Configuración persistida del televisor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TvConfig {
    pub ip: String,
    pub mac: String,
    pub port: u16,
    pub configured: bool,
}

impl Default for TvConfig {
    fn default() -> Self {
        Self {
            ip: String::new(),
            mac: String::new(),
            port: 8002,
            configured: false,
        }
    }
}

/// Estado de las dependencias de Python.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TvDepsStatus {
    pub python_found: bool,
    pub python_path: Option<String>,
    pub samsungtvws_installed: bool,
}

// ─── Rutas ──────────────────────────────────────────────────────────────────

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo obtener la carpeta de datos: {e}"))
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("samsung_tv_config.json"))
}

fn token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("samsung_tv_token.txt"))
}

fn script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?;
    let path = dir.join("samsung_controller.py");
    // Escribir (o actualizar) el script embebido en la carpeta de datos de la app.
    let script = include_str!("../../../scripts/samsung_controller.py");
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta de datos: {e}"))?;
    std::fs::write(&path, script).map_err(|e| format!("No se pudo escribir el script: {e}"))?;
    Ok(path)
}

// ─── Python ─────────────────────────────────────────────────────────────────

/// Busca un intérprete de Python en el PATH del sistema.
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

/// Comprueba si samsungtvws está instalado en el Python dado.
fn check_samsungtvws(python: &str) -> bool {
    Command::new(python)
        .args(["-c", "import samsungtvws"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Ejecuta el script Python con un JSON de acción y devuelve el resultado parseado.
fn run_script(
    python: &str,
    script: &std::path::Path,
    request_json: &str,
) -> Result<TvResult, String> {
    let output = Command::new(python)
        .arg(script)
        .arg(request_json)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("No se pudo ejecutar el script de Samsung TV: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if stdout.trim().is_empty() {
        return Err(format!(
            "El script no devolvió salida.{}",
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(" Stderr: {stderr}")
            }
        ));
    }

    serde_json::from_str::<TvResult>(stdout.trim())
        .map_err(|e| format!("Respuesta inválida del script: {e}. Stdout: {stdout}"))
}

// ─── Wake-on-LAN ───────────────────────────────────────────────────────────

/// Envía un Magic Packet (Wake-on-LAN) a la dirección MAC indicada.
fn send_wol(mac: &str) -> Result<(), String> {
    let mac_bytes: Vec<u8> = mac
        .split(|c| c == ':' || c == '-')
        .map(|s| u8::from_str_radix(s, 16).map_err(|_| format!("MAC inválida: {mac}")))
        .collect::<Result<Vec<u8>, String>>()?;

    if mac_bytes.len() != 6 {
        return Err(format!("La MAC debe tener 6 octetos, se encontraron {}", mac_bytes.len()));
    }

    // Magic Packet: 6 bytes 0xFF + 16 repeticiones de la MAC (102 bytes).
    let mut packet = vec![0xFFu8; 6];
    for _ in 0..16 {
        packet.extend_from_slice(&mac_bytes);
    }

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("No se pudo crear el socket UDP: {e}"))?;
    socket
        .set_broadcast(true)
        .map_err(|e| format!("No se pudo habilitar broadcast: {e}"))?;
    socket
        .send_to(&packet, "255.255.255.255:9")
        .map_err(|e| format!("No se pudo enviar el paquete WoL: {e}"))?;
    // Enviar también al puerto 7 por compatibilidad.
    let _ = socket.send_to(&packet, "255.255.255.255:7");

    Ok(())
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

/// Ejecuta una acción en el televisor Samsung. El frontend pasa el comando y el valor;
/// este handler resuelve la IP, el token y el intérprete de Python de forma transparente.
#[tauri::command]
pub async fn tv_execute(
    app: tauri::AppHandle,
    command: String,
    value: Option<String>,
) -> Result<TvResult, String> {
    let config = read_config(&app)?;
    if !config.configured {
        return Err("No hay televisor configurado. Ve a Ajustes > Televisor para vincularlo.".into());
    }

    // Encendido: intentar WoL antes de WebSocket.
    if command == "power" && value.as_deref() == Some("on") {
        if !config.mac.is_empty() {
            send_wol(&config.mac)?;
            // Esperar un momento para que la TV arranque la interfaz de red.
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
        // Después del WoL, intentar confirmar con el script (si ya está encendida, no pasa nada).
        match call_script(&app, &config, &command, value.as_deref()) {
            Ok(result) => return Ok(result),
            Err(_) => {
                // La TV puede tardar más en levantar el WS tras un WoL. Devolver éxito optimista.
                return Ok(TvResult {
                    ok: true,
                    message: Some("Paquete de encendido enviado. La TV puede tardar unos segundos.".into()),
                    error: None,
                });
            }
        }
    }

    call_script(&app, &config, &command, value.as_deref())
}

/// Devuelve la configuración actual del televisor.
#[tauri::command]
pub async fn tv_get_config(app: tauri::AppHandle) -> Result<TvConfig, String> {
    read_config(&app)
}

/// Guarda la configuración del televisor (IP y MAC).
#[tauri::command]
pub async fn tv_save_config(
    app: tauri::AppHandle,
    ip: String,
    mac: String,
) -> Result<(), String> {
    let config = TvConfig {
        ip: ip.trim().to_string(),
        mac: mac.trim().to_uppercase(),
        port: 8002,
        configured: true,
    };
    write_config(&app, &config)
}

/// Inicia el proceso de vinculación (pairing) con la TV.
#[tauri::command]
pub async fn tv_pair(app: tauri::AppHandle) -> Result<TvResult, String> {
    let config = read_config(&app)?;
    if config.ip.is_empty() {
        return Err("Primero ingresa la IP del televisor.".into());
    }
    call_script(&app, &config, "pair", None)
}

/// Comprueba si Python y samsungtvws están disponibles.
#[tauri::command]
pub async fn tv_check_deps() -> Result<TvDepsStatus, String> {
    let python = find_python();
    let installed = python
        .as_ref()
        .map(|p| check_samsungtvws(p))
        .unwrap_or(false);

    Ok(TvDepsStatus {
        python_found: python.is_some(),
        python_path: python,
        samsungtvws_installed: installed,
    })
}

/// Instala la librería samsungtvws vía pip.
#[tauri::command]
pub async fn tv_install_deps() -> Result<(), String> {
    let python = find_python().ok_or("No se encontró Python en el sistema.")?;

    let output = Command::new(&python)
        .args(["-m", "pip", "install", "samsungtvws", "--quiet"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("No se pudo ejecutar pip: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("pip falló: {stderr}"))
    }
}

// ─── Helpers internos ───────────────────────────────────────────────────────

fn read_config(app: &tauri::AppHandle) -> Result<TvConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(TvConfig::default());
    }
    let data =
        std::fs::read_to_string(&path).map_err(|e| format!("No se pudo leer la configuración: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("Configuración corrupta: {e}"))
}

fn write_config(app: &tauri::AppHandle, config: &TvConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear la carpeta de datos: {e}"))?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("No se pudo serializar la configuración: {e}"))?;
    let mut file = std::fs::File::create(&path)
        .map_err(|e| format!("No se pudo crear el archivo de configuración: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("No se pudo escribir la configuración: {e}"))?;
    Ok(())
}

fn call_script(
    app: &tauri::AppHandle,
    config: &TvConfig,
    command: &str,
    value: Option<&str>,
) -> Result<TvResult, String> {
    let python = find_python().ok_or("No se encontró Python en el sistema.")?;
    if !check_samsungtvws(&python) {
        return Err("La librería 'samsungtvws' no está instalada. Ve a Ajustes > Televisor para instalarla.".into());
    }

    let script = script_path(app)?;
    let token = token_path(app)?;

    let mut request = serde_json::json!({
        "ip": config.ip,
        "port": config.port,
        "token_file": token.to_string_lossy(),
        "command": command,
    });
    if let Some(v) = value {
        request["value"] = serde_json::Value::String(v.to_string());
    }

    run_script(&python, &script, &request.to_string())
}
