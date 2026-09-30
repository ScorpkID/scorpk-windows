mod commands;

use tauri::Manager;

/// Punto de entrada de la app. Las acciones nativas viven en commands/ (ver ARCHITECTURE.md §2 y §5).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Debe ir primero: una segunda ejecución trae al frente la ventana ya abierta.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(commands::login::LoginState::default())
        .invoke_handler(tauri::generate_handler![
            commands::apps::open_app,
            commands::battery::battery_status,
            commands::keys::media_key,
            commands::keys::set_volume,
            commands::keys::volume_key,
            commands::login::login_prepare,
            commands::login::login_wait,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Scorpk");
}
