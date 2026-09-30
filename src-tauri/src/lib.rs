mod commands;

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

/// Punto de entrada de la app. Las acciones nativas viven en commands/ (ver ARCHITECTURE.md §2 y §5).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Debe ir primero: si se abre scorpk://... con la app ya abierta, el enlace se reenvía a la
        // instancia en marcha (en vez de abrir una segunda ventana) y se trae la ventana al frente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            // En desarrollo y en instalaciones portables el esquema scorpk:// no está registrado
            // por el instalador: se registra al arrancar para que el login de Google/GitHub vuelva.
            #[cfg(windows)]
            app.deep_link().register_all()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::apps::open_app,
            commands::battery::battery_status,
            commands::keys::media_key,
            commands::keys::set_volume,
            commands::keys::volume_key,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Scorpk");
}
