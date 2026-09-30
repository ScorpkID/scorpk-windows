//! Volumen y multimedia mediante teclas multimedia del sistema (funcionan con cualquier reproductor).
//! Acepta solo valores de una lista fija; cualquier otro texto se rechaza.

#[cfg(windows)]
mod imp {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_MEDIA_NEXT_TRACK,
        VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_MEDIA_STOP, VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP,
    };

    pub fn tap(key: VIRTUAL_KEY) {
        let down = KEYBD_EVENT_FLAGS(KEYEVENTF_EXTENDEDKEY.0);
        let up = KEYBD_EVENT_FLAGS(KEYEVENTF_EXTENDEDKEY.0 | KEYEVENTF_KEYUP.0);
        // SAFETY: keybd_event solo inyecta una pulsación de tecla multimedia; no toca memoria del proceso.
        unsafe {
            keybd_event(key.0 as u8, 0, down, 0);
            keybd_event(key.0 as u8, 0, up, 0);
        }
    }

    pub fn volume_up() {
        tap(VK_VOLUME_UP)
    }
    pub fn volume_down() {
        tap(VK_VOLUME_DOWN)
    }
    pub fn mute_toggle() {
        tap(VK_VOLUME_MUTE)
    }
    pub fn play_pause() {
        tap(VK_MEDIA_PLAY_PAUSE)
    }
    pub fn next() {
        tap(VK_MEDIA_NEXT_TRACK)
    }
    pub fn previous() {
        tap(VK_MEDIA_PREV_TRACK)
    }
    pub fn stop() {
        tap(VK_MEDIA_STOP)
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn volume_up() {}
    pub fn volume_down() {}
    pub fn mute_toggle() {}
    pub fn play_pause() {}
    pub fn next() {}
    pub fn previous() {}
    pub fn stop() {}
}

/// Cada pulsación de volumen mueve 2 puntos porcentuales en Windows.
const STEP: u32 = 2;

#[tauri::command]
pub fn volume_key(action: String) -> Result<(), String> {
    match action.as_str() {
        "up" => (0..5).for_each(|_| imp::volume_up()),
        "down" => (0..5).for_each(|_| imp::volume_down()),
        // La tecla de silencio alterna; "unmute" y "mute" comparten acción (Windows no expone el estado por tecla).
        "mute" | "unmute" => imp::mute_toggle(),
        "max" => (0..50).for_each(|_| imp::volume_up()),
        _ => return Err("Acción de volumen no válida.".into()),
    }
    Ok(())
}

/// Fija un porcentaje aproximado: baja al mínimo y sube en pasos de 2 %.
#[tauri::command]
pub fn set_volume(percent: u32) -> Result<(), String> {
    if percent > 100 {
        return Err("El volumen debe estar entre 0 y 100.".into());
    }
    (0..50).for_each(|_| imp::volume_down());
    (0..(percent / STEP)).for_each(|_| imp::volume_up());
    Ok(())
}

#[tauri::command]
pub fn media_key(action: String) -> Result<(), String> {
    match action.as_str() {
        // Sin API para "solo play" o "solo pausa" por tecla: ambas alternan.
        "play_pause" | "play" | "pause" => imp::play_pause(),
        "next" => imp::next(),
        "previous" => imp::previous(),
        "stop" => imp::stop(),
        _ => return Err("Acción multimedia no válida.".into()),
    }
    Ok(())
}
