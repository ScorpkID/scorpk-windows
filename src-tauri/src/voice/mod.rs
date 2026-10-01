//! Voz: "Oye Scorpk" y dictado de comandos, 100 % en el equipo (Vosk offline).
//! El audio no sale del PC. El motor y el modelo se descargan la primera vez (ver installer.rs).

mod engine;
mod ffi;
mod installer;
mod resample;
pub mod wake;

use engine::{Cmd, Engine};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct VoiceState {
    engine: Mutex<Option<Engine>>,
    /// Si el usuario quiere "Oye Scorpk" activo (lo aplica el frontend al iniciar).
    wake: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub installed: bool,
    pub running: bool,
    pub wake_enabled: bool,
}

fn voice_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("voice")).map_err(|_| "No encuentro la carpeta de datos.".to_string())
}

/// Envía una orden al motor; si no está corriendo, lo arranca (siempre que esté instalado).
fn send(app: &AppHandle, state: &VoiceState, cmd: Cmd) -> Result<(), String> {
    let dir = voice_dir(app)?;
    let mut guard = state.engine.lock().map_err(|_| "Estado de voz inválido.".to_string())?;
    if let Some(engine) = guard.as_ref() {
        if engine.is_alive() && engine.tx.send(clone_cmd(&cmd)).is_ok() {
            return Ok(());
        }
        *guard = None;
    }

    let wake_on = *state.wake.lock().map_err(|_| "Estado de voz inválido.".to_string())?;
    let start_listening = matches!(cmd, Cmd::Listen);
    // Sin motor en marcha, solo estas órdenes tienen sentido: escuchar ya, o activar el wake word.
    let should_start = start_listening || matches!(cmd, Cmd::WakeEnabled(true)) || (wake_on && matches!(cmd, Cmd::Resume));
    if !should_start {
        return Ok(());
    }
    if !installer::is_installed(&dir) {
        return Err("Falta descargar el motor de voz.".into());
    }
    *guard = Some(Engine::spawn(app.clone(), installer::dll_path(&dir), installer::model_dir(&dir), wake_on, start_listening));
    Ok(())
}

fn clone_cmd(cmd: &Cmd) -> Cmd {
    match cmd {
        Cmd::WakeEnabled(on) => Cmd::WakeEnabled(*on),
        Cmd::Listen => Cmd::Listen,
        Cmd::Pause => Cmd::Pause,
        Cmd::Resume => Cmd::Resume,
        Cmd::Stop => Cmd::Stop,
    }
}

/// Lo llama el overlay al ocultarse: vuelve a esperar "Oye Scorpk".
pub fn on_overlay_hidden(app: &AppHandle) {
    if let Some(state) = app.try_state::<VoiceState>() {
        let _ = send(app, &state, Cmd::Resume);
    }
}

#[tauri::command]
pub fn voice_status(app: AppHandle, state: State<VoiceState>) -> Result<VoiceStatus, String> {
    let installed = installer::is_installed(&voice_dir(&app)?);
    let running = state.engine.lock().map(|g| g.as_ref().is_some_and(|e| e.is_alive())).unwrap_or(false);
    let wake_enabled = state.wake.lock().map(|g| *g).unwrap_or(false);
    Ok(VoiceStatus { installed, running, wake_enabled })
}

/// Descarga e instala el motor y el modelo (≈55 MB), emitiendo `voice-install` {stage, percent}.
#[tauri::command]
pub async fn voice_install(app: AppHandle) -> Result<(), String> {
    let dir = voice_dir(&app)?;
    let emitter = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        installer::install(&dir, |stage, percent| {
            let _ = emitter.emit("voice-install", serde_json::json!({ "stage": stage, "percent": percent }));
        })
    })
    .await
    .map_err(|_| "Falló la instalación.".to_string())?
}

#[tauri::command]
pub fn voice_set_wake(app: AppHandle, state: State<VoiceState>, enabled: bool) -> Result<(), String> {
    *state.wake.lock().map_err(|_| "Estado de voz inválido.".to_string())? = enabled;
    send(&app, &state, Cmd::WakeEnabled(enabled))
}

#[tauri::command]
pub fn voice_listen(app: AppHandle, state: State<VoiceState>) -> Result<(), String> {
    send(&app, &state, Cmd::Listen)
}

#[tauri::command]
pub fn voice_pause(app: AppHandle, state: State<VoiceState>) -> Result<(), String> {
    send(&app, &state, Cmd::Pause)
}

#[tauri::command]
pub fn voice_resume(app: AppHandle, state: State<VoiceState>) -> Result<(), String> {
    send(&app, &state, Cmd::Resume)
}

/// Prueba de humo (manual): `SCORPK_VOICE_DIR` con libvosk.dll y model-es, y `SCORPK_TEST_WAV` con un
/// WAV PCM 16 bits mono 16 kHz. Ejecutar con `cargo test vosk_reconoce -- --ignored --nocapture`.
#[cfg(test)]
mod tests {
    use super::*;

    fn pcm_from_wav(bytes: &[u8]) -> Vec<i16> {
        let data_at = bytes.windows(4).position(|w| w == b"data").expect("chunk data") + 8;
        bytes[data_at..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
    }

    #[test]
    #[ignore]
    fn vosk_reconoce_un_wav_generado_con_sapi() {
        let dir = PathBuf::from(std::env::var("SCORPK_VOICE_DIR").expect("SCORPK_VOICE_DIR"));
        // Ejercita también el instalador real: descarga, verifica SHA-256 y extrae si aún no está.
        installer::install(&dir, |stage, p| if p % 25 == 0 { println!("instalando {stage}: {p}%") }).expect("instalar");
        assert!(installer::is_installed(&dir));
        let wav = std::fs::read(std::env::var("SCORPK_TEST_WAV").expect("SCORPK_TEST_WAV")).unwrap();
        let mut session = ffi::Session::open(&installer::dll_path(&dir), &installer::model_dir(&dir)).expect("abrir Vosk");
        let pcm = pcm_from_wav(&wav);
        let mut texts = Vec::new();
        for block in pcm.chunks(3200) {
            if let Some(t) = session.accept(block) {
                texts.push(t);
            }
        }
        texts.push(session.finish());
        let heard = texts.join(" ");
        println!("VOSK OYÓ: «{heard}»");
        let wake = wake::find(&heard);
        println!("WAKE: {wake:?}");
        assert!(!heard.trim().is_empty(), "Vosk no reconoció nada");
    }
}
