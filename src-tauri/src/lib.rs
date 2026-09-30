/// Punto de entrada de la app. Las acciones nativas (commands/) se añaden en las fases 2-4;
/// ver ARCHITECTURE.md §2 y §5.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .run(tauri::generate_context!())
        .expect("error al iniciar Scorpk");
}
