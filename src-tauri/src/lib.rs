mod commands;
mod overlay;
mod tray;
mod voice;

use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Atajo global para abrir el asistente desde cualquier programa.
fn assistant_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space)
}

/// Punto de entrada de la app. Las acciones nativas viven en commands/ (ver ARCHITECTURE.md §2 y §5).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Debe ir primero: una segunda ejecución trae al frente la ventana ya abierta.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![commands::autostart::MINIMIZED_ARG]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && shortcut == &assistant_shortcut() {
                        overlay::toggle(app);
                    }
                })
                .build(),
        )
        .manage(commands::login::LoginState::default())
        .manage(voice::VoiceState::default())
        .setup(|app| {
            tray::setup(app.handle())?;
            // La ventana principal arranca oculta; se muestra salvo al iniciar con Windows (va a la bandeja).
            if !std::env::args().any(|a| a == commands::autostart::MINIMIZED_ARG) {
                tray::show_main(app.handle());
            }
            // Si otro programa ya usa Ctrl+Alt+Espacio, la app sigue funcionando (por bandeja) sin el atajo.
            if let Err(error) = app.global_shortcut().register(assistant_shortcut()) {
                eprintln!("No se pudo registrar el atajo global: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Cerrar la ventana principal la envía a la bandeja; se sale desde el menú de la bandeja.
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            (overlay::OVERLAY_LABEL, WindowEvent::Focused(false)) => overlay::on_focus_lost(window.app_handle()),
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::ai::ai_chat,
            commands::apps::open_app,
            commands::apps::list_apps,
            commands::autostart::autostart_status,
            commands::autostart::autostart_set,
            commands::battery::battery_status,
            commands::keys::media_key,
            commands::keys::set_volume,
            commands::keys::volume_key,
            commands::login::login_prepare,
            commands::login::login_wait,
            overlay::overlay_hide,
            overlay::overlay_fit,
            overlay::open_voice_settings,
            voice::voice_status,
            voice::voice_install,
            voice::voice_set_wake,
            voice::voice_listen,
            voice::voice_pause,
            voice::voice_resume,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Scorpk");
}
