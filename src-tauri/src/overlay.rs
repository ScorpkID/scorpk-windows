//! Overlay flotante del asistente: ventana sin bordes, transparente y siempre encima, anclada
//! abajo al centro de la pantalla principal. Se abre/cierra con el atajo global o desde la bandeja.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

pub const OVERLAY_LABEL: &str = "overlay";
const WIDTH: f64 = 680.0;
const DEFAULT_HEIGHT: f64 = 96.0;
const MIN_HEIGHT: f64 = 72.0;
const MAX_HEIGHT: f64 = 560.0;
/// Separación (px lógicos) hasta el borde inferior, para no tapar la barra de tareas.
const BOTTOM_MARGIN: f64 = 72.0;
/// Al mostrarse, Windows puede emitir un "sin foco" transitorio: se ignora durante este margen.
const BLUR_GRACE_MS: u64 = 500;

static SHOWN_AT_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Altura válida para la ventana (px lógicos). Pública para poder probarla.
pub fn clamp_height(height: f64) -> f64 {
    if height.is_finite() {
        height.clamp(MIN_HEIGHT, MAX_HEIGHT)
    } else {
        DEFAULT_HEIGHT
    }
}

/// Posición física (x, y) de la esquina superior izquierda para centrar abajo.
pub fn anchor_position(
    monitor_pos: (i32, i32),
    monitor_size: (u32, u32),
    scale: f64,
    logical_height: f64,
) -> (i32, i32) {
    let width = WIDTH * scale;
    let height = logical_height * scale;
    let x = monitor_pos.0 as f64 + (monitor_size.0 as f64 - width) / 2.0;
    let y = monitor_pos.1 as f64 + monitor_size.1 as f64 - height - BOTTOM_MARGIN * scale;
    (x.round() as i32, y.round() as i32)
}

fn place(app: &AppHandle, window: &WebviewWindow, logical_height: f64) -> tauri::Result<()> {
    let height = clamp_height(logical_height);
    window.set_size(LogicalSize::new(WIDTH, height))?;
    if let Some(monitor) = app.primary_monitor()? {
        let pos = monitor.position();
        let size = monitor.size();
        let (x, y) = anchor_position((pos.x, pos.y), (size.width, size.height), monitor.scale_factor(), height);
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

pub fn show(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else { return };
    let _ = place(app, &window, DEFAULT_HEIGHT);
    SHOWN_AT_MS.store(now_ms(), Ordering::Relaxed);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(OVERLAY_LABEL, "overlay-shown", ());
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.hide();
    }
    // Al cerrarse el overlay, la voz vuelve a esperar "Oye Scorpk" (o se apaga si no está activa).
    crate::voice::on_overlay_hidden(app);
}

pub fn toggle(app: &AppHandle) {
    let visible = app
        .get_webview_window(OVERLAY_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        hide(app);
    } else {
        show(app);
    }
}

/// Oculta el overlay al perder el foco (estilo Gemini), salvo justo después de mostrarse.
pub fn on_focus_lost(app: &AppHandle) {
    if now_ms().saturating_sub(SHOWN_AT_MS.load(Ordering::Relaxed)) > BLUR_GRACE_MS {
        hide(app);
    }
}

#[tauri::command]
pub fn overlay_hide(app: AppHandle) {
    hide(&app);
}

/// El frontend ajusta la altura al contenido; la ventana sigue anclada abajo.
#[tauri::command]
pub fn overlay_fit(app: AppHandle, height: f64) -> Result<(), String> {
    let window = app.get_webview_window(OVERLAY_LABEL).ok_or("No hay overlay.")?;
    place(&app, &window, height).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_altura_se_acota() {
        assert_eq!(clamp_height(10.0), MIN_HEIGHT);
        assert_eq!(clamp_height(9999.0), MAX_HEIGHT);
        assert_eq!(clamp_height(200.0), 200.0);
        assert_eq!(clamp_height(f64::NAN), DEFAULT_HEIGHT);
    }

    #[test]
    fn se_ancla_abajo_al_centro() {
        // Monitor 1920x1080 a escala 1: ancho 680 -> x = 620; y = 1080 - 96 - 72 = 912.
        assert_eq!(anchor_position((0, 0), (1920, 1080), 1.0, 96.0), (620, 912));
        // Escala 2 (3840x2160 físicos): todo se duplica.
        assert_eq!(anchor_position((0, 0), (3840, 2160), 2.0, 96.0), (1240, 1824));
        // Segundo monitor a la derecha: respeta su origen.
        assert_eq!(anchor_position((1920, 0), (1920, 1080), 1.0, 96.0), (2540, 912));
    }
}
