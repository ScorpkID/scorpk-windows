mod commands;

/// Punto de entrada de la app. Las acciones nativas viven en commands/ (ver ARCHITECTURE.md §2 y §5).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
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
