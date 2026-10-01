//! Carga dinámica de libvosk.dll (sin enlazar en compilación: la app funciona sin el motor de voz
//! y este se descarga después, verificado). Solo se usa desde el hilo del motor.

use libloading::os::windows::{Library, LOAD_WITH_ALTERED_SEARCH_PATH};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;

type ModelNew = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type Free = unsafe extern "C" fn(*mut c_void);
type RecNew = unsafe extern "C" fn(*mut c_void, f32) -> *mut c_void;
type Accept = unsafe extern "C" fn(*mut c_void, *const i16, c_int) -> c_int;
type Text = unsafe extern "C" fn(*mut c_void) -> *const c_char;
type Reset = unsafe extern "C" fn(*mut c_void);
type LogLevel = unsafe extern "C" fn(c_int);

/// Sesión de reconocimiento: modelo + reconocedor. Libera todo al soltarse.
pub struct Session {
    // La biblioteca debe vivir más que los punteros; por eso va en el struct (y se suelta al final).
    model: *mut c_void,
    rec: *mut c_void,
    model_free: Free,
    rec_free: Free,
    accept: Accept,
    result: Text,
    partial: Text,
    final_result: Text,
    reset: Reset,
    _lib: Library,
}

fn symbol<T: Copy>(lib: &Library, name: &[u8]) -> Result<T, String> {
    // SAFETY: el tipo T corresponde a la firma documentada en vosk_api.h.
    unsafe { lib.get::<T>(name).map(|s| *s).map_err(|e| format!("Falta la función {}: {e}", String::from_utf8_lossy(name))) }
}

impl Session {
    pub fn open(dll: &Path, model_dir: &Path) -> Result<Session, String> {
        // SAFETY: se carga la DLL verificada por SHA-256 en la instalación; ALTERED_SEARCH_PATH hace que
        // sus dependencias (libstdc++, libgcc, libwinpthread) se busquen en su misma carpeta.
        let lib = unsafe { Library::load_with_flags(dll, LOAD_WITH_ALTERED_SEARCH_PATH) }
            .map_err(|e| format!("No pude cargar el motor de voz: {e}"))?;

        let set_log_level: LogLevel = symbol(&lib, b"vosk_set_log_level\0")?;
        let model_new: ModelNew = symbol(&lib, b"vosk_model_new\0")?;
        let model_free: Free = symbol(&lib, b"vosk_model_free\0")?;
        let rec_new: RecNew = symbol(&lib, b"vosk_recognizer_new\0")?;
        let rec_free: Free = symbol(&lib, b"vosk_recognizer_free\0")?;

        let path = CString::new(model_dir.to_string_lossy().as_bytes()).map_err(|_| "Ruta de modelo inválida.".to_string())?;
        // SAFETY: firmas según vosk_api.h; los punteros se comprueban antes de usarse.
        unsafe {
            set_log_level(-1);
            let model = model_new(path.as_ptr());
            if model.is_null() {
                return Err("No pude cargar el modelo de voz.".into());
            }
            let rec = rec_new(model, super::resample::TARGET_RATE as f32);
            if rec.is_null() {
                model_free(model);
                return Err("No pude iniciar el reconocedor de voz.".into());
            }
            Ok(Session {
                model,
                rec,
                model_free,
                rec_free,
                accept: symbol(&lib, b"vosk_recognizer_accept_waveform_s\0")?,
                result: symbol(&lib, b"vosk_recognizer_result\0")?,
                partial: symbol(&lib, b"vosk_recognizer_partial_result\0")?,
                final_result: symbol(&lib, b"vosk_recognizer_final_result\0")?,
                reset: symbol(&lib, b"vosk_recognizer_reset\0")?,
                _lib: lib,
            })
        }
    }

    fn read(&self, f: Text) -> String {
        // SAFETY: el puntero devuelto es una cadena C válida hasta la siguiente llamada al reconocedor.
        unsafe {
            let ptr = f(self.rec);
            if ptr.is_null() {
                return String::new();
            }
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }

    /// Procesa audio 16 kHz. Devuelve `Some(texto)` (puede ser vacío) cuando termina una frase.
    pub fn accept(&mut self, pcm: &[i16]) -> Option<String> {
        if pcm.is_empty() {
            return None;
        }
        // SAFETY: pcm es un bloque válido de `len` muestras de 16 bits.
        let done = unsafe { (self.accept)(self.rec, pcm.as_ptr(), pcm.len() as c_int) };
        (done == 1).then(|| json_field(&self.read(self.result), "text"))
    }

    pub fn partial(&self) -> String {
        json_field(&self.read(self.partial), "partial")
    }

    /// Fuerza el cierre de la frase en curso y devuelve su texto.
    pub fn finish(&mut self) -> String {
        json_field(&self.read(self.final_result), "text")
    }

    pub fn reset(&mut self) {
        // SAFETY: el reconocedor es válido mientras viva la sesión.
        unsafe { (self.reset)(self.rec) }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // SAFETY: se liberan una sola vez, reconocedor antes que modelo.
        unsafe {
            (self.rec_free)(self.rec);
            (self.model_free)(self.model);
        }
    }
}

// La sesión se crea y se usa solo dentro del hilo del motor.
unsafe impl Send for Session {}

fn json_field(raw: &str, field: &str) -> String {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.get(field).and_then(|t| t.as_str()).map(|t| t.trim().to_string()))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::json_field;

    #[test]
    fn lee_los_campos_de_vosk() {
        assert_eq!(json_field(r#"{ "text" : "abre la calculadora" }"#, "text"), "abre la calculadora");
        assert_eq!(json_field(r#"{"partial":"hola"}"#, "partial"), "hola");
        assert_eq!(json_field("basura", "text"), "");
    }
}
