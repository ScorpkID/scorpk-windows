//! "Iniciar con Windows": registra Scorpk en el inicio de sesión del usuario (clave Run de HKCU, sin
//! permisos de administrador). Arranca con `--minimized`, directo a la bandeja, para que "Oye Scorpk"
//! y Ctrl+Alt+Espacio estén listos sin abrir la ventana.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub const MINIMIZED_ARG: &str = "--minimized";

#[tauri::command]
pub fn autostart_status(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|_| "No pude consultar el inicio con Windows.".to_string())
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|_| "No pude cambiar el inicio con Windows.".to_string())
}
