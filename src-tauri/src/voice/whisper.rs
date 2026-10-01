//! Transcripción precisa de órdenes con Whisper (whisper.cpp b5130), cargado dinámicamente como Vosk.
//!
//! Vosk sigue escuchando "Oye Scorpk" y detecta cuándo terminas de hablar; luego Whisper transcribe
//! esa frase completa, con mucha más precisión que el modelo pequeño de Vosk. Todo en el equipo.
//!
//! ABI: `whisper_full` y `whisper_init_from_file_with_params` reciben structs grandes *por valor*.
//! En Windows x64 un struct de más de 8 bytes se pasa como puntero a una copia hecha por quien llama,
//! así que pasar el puntero de `*_default_params_by_ref` es equivalente (y no hace falta conocer el
//! struct completo, solo su prefijo). Al abrir se comprueban los valores por defecto conocidos: si la
//! DLL no es la versión esperada, se rechaza en vez de escribir en campos equivocados.

use libloading::os::windows::{Library, LOAD_WITH_ALTERED_SEARCH_PATH};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;

/// Prefijo de `struct whisper_full_params` (whisper.h, b5130). Solo se leen/escriben estos campos.
#[repr(C)]
struct FullParams {
    strategy: c_int,
    n_threads: c_int,
    n_max_text_ctx: c_int,
    offset_ms: c_int,
    duration_ms: c_int,
    translate: bool,
    no_context: bool,
    no_timestamps: bool,
    single_segment: bool,
    print_special: bool,
    print_progress: bool,
    print_realtime: bool,
    print_timestamps: bool,
    token_timestamps: bool,
    thold_pt: f32,
    thold_ptsum: f32,
    max_len: c_int,
    split_on_word: bool,
    max_tokens: c_int,
    debug_mode: bool,
    audio_ctx: c_int,
    tdrz_enable: bool,
    suppress_regex: *const c_char,
    initial_prompt: *const c_char,
    carry_initial_prompt: bool,
    prompt_tokens: *const i32,
    prompt_n_tokens: c_int,
    language: *const c_char,
    detect_language: bool,
    suppress_blank: bool,
    suppress_nst: bool,
    temperature: f32,
    max_initial_ts: f32,
    length_penalty: f32,
    temperature_inc: f32,
    entropy_thold: f32,
    logprob_thold: f32,
    no_speech_thold: f32,
}

/// Prefijo de `struct whisper_context_params`: solo `use_gpu`.
#[repr(C)]
struct ContextParams {
    use_gpu: bool,
}

type LoadBackends = unsafe extern "C" fn(*const c_char);
type LogCallback = unsafe extern "C" fn(c_int, *const c_char, *mut c_void);
type LogSet = unsafe extern "C" fn(Option<LogCallback>, *mut c_void);
type ContextDefaults = unsafe extern "C" fn() -> *mut ContextParams;
type FreeContextParams = unsafe extern "C" fn(*mut ContextParams);
type InitFromFile = unsafe extern "C" fn(*const c_char, *mut ContextParams) -> *mut c_void;
type FullDefaults = unsafe extern "C" fn(c_int) -> *mut FullParams;
type FreeParams = unsafe extern "C" fn(*mut FullParams);
type Full = unsafe extern "C" fn(*mut c_void, *mut FullParams, *const f32, c_int) -> c_int;
type NSegments = unsafe extern "C" fn(*mut c_void) -> c_int;
type SegmentText = unsafe extern "C" fn(*mut c_void, c_int) -> *const c_char;
type SegmentNoSpeech = unsafe extern "C" fn(*mut c_void, c_int) -> f32;
type Free = unsafe extern "C" fn(*mut c_void);

/// Contexto que orienta a Whisper hacia órdenes cortas en español (mejora nombres de apps y verbos).
const PROMPT: &str = "Órdenes para Scorpk, un asistente de Windows: abre Chrome, sube el volumen, \
pon un temporizador de cinco minutos, pausa la música, abre la calculadora, busca en YouTube.";

/// Frases que Whisper "inventa" con silencio o ruido (vienen de subtítulos de su entrenamiento).
const HALLUCINATIONS: &[&str] =
    &["amara.org", "subtítulos", "subtitulos", "suscríbete", "suscribete", "gracias por ver", "¡gracias!", "música de fondo"];

unsafe extern "C" fn quiet_log(_level: c_int, _text: *const c_char, _user: *mut c_void) {}

pub struct Whisper {
    ctx: *mut c_void,
    full_defaults: FullDefaults,
    free_params: FreeParams,
    full: Full,
    n_segments: NSegments,
    segment_text: SegmentText,
    no_speech: SegmentNoSpeech,
    free: Free,
    threads: c_int,
    prompt: CString,
    language: CString,
    // Las bibliotecas deben vivir más que el contexto (se sueltan después, en orden de declaración).
    _lib: Library,
    _ggml: Library,
}

fn symbol<T: Copy>(lib: &Library, name: &[u8]) -> Result<T, String> {
    // SAFETY: el tipo T corresponde a la firma de whisper.h / ggml-backend.h (b5130).
    unsafe { lib.get::<T>(name).map(|s| *s).map_err(|_| "El motor de voz preciso está incompleto.".to_string()) }
}

/// Comprueba que los valores por defecto coincidan con los de b5130 (si no, el struct no es el esperado).
fn layout_ok(p: &FullParams) -> bool {
    // SAFETY: `language` por defecto apunta a una cadena estática de la DLL ("en").
    let language = (!p.language.is_null()).then(|| unsafe { CStr::from_ptr(p.language) }.to_bytes() == b"en");
    p.strategy == 0
        && p.n_max_text_ctx == 16384
        && p.max_tokens == 0
        && language == Some(true)
        && (p.temperature_inc - 0.2).abs() < 1e-6
        && (p.entropy_thold - 2.4).abs() < 1e-6
        && (p.no_speech_thold - 0.6).abs() < 1e-6
}

impl Whisper {
    /// `dir` contiene whisper.dll y sus DLL de ggml; `model` es el archivo ggml del modelo.
    pub fn open(dir: &Path, model: &Path) -> Result<Whisper, String> {
        let fail = |_| "No pude cargar el reconocimiento de voz preciso.".to_string();
        // SAFETY: DLL verificadas por SHA-256 al instalar; ALTERED_SEARCH_PATH resuelve sus dependencias
        // (ggml-base, runtime de Visual C++) en su misma carpeta.
        let ggml = unsafe { Library::load_with_flags(dir.join("ggml.dll"), LOAD_WITH_ALTERED_SEARCH_PATH) }.map_err(fail)?;
        let lib = unsafe { Library::load_with_flags(dir.join("whisper.dll"), LOAD_WITH_ALTERED_SEARCH_PATH) }.map_err(fail)?;

        let load_backends: LoadBackends = symbol(&ggml, b"ggml_backend_load_all_from_path\0")?;
        let log_set: LogSet = symbol(&lib, b"whisper_log_set\0")?;
        let context_defaults: ContextDefaults = symbol(&lib, b"whisper_context_default_params_by_ref\0")?;
        let free_context_params: FreeContextParams = symbol(&lib, b"whisper_free_context_params\0")?;
        let init: InitFromFile = symbol(&lib, b"whisper_init_from_file_with_params\0")?;
        let full_defaults: FullDefaults = symbol(&lib, b"whisper_full_default_params_by_ref\0")?;
        let free_params: FreeParams = symbol(&lib, b"whisper_free_params\0")?;

        let dir_c = CString::new(dir.to_string_lossy().as_bytes()).map_err(|_| "Ruta inválida.".to_string())?;
        let model_c = CString::new(model.to_string_lossy().as_bytes()).map_err(|_| "Ruta inválida.".to_string())?;

        // SAFETY: firmas de b5130; cada puntero se comprueba antes de usarse y se libera una vez.
        unsafe {
            log_set(Some(quiet_log), std::ptr::null_mut());
            // ggml elige la DLL de CPU más rápida para este procesador (AVX2, AVX-512…) de esta carpeta.
            load_backends(dir_c.as_ptr());

            let probe = full_defaults(0);
            if probe.is_null() {
                return Err("No pude iniciar el reconocimiento de voz preciso.".into());
            }
            let compatible = layout_ok(&*probe);
            free_params(probe);
            if !compatible {
                return Err("La versión del reconocimiento de voz preciso no es compatible.".into());
            }

            let cparams = context_defaults();
            if cparams.is_null() {
                return Err("No pude iniciar el reconocimiento de voz preciso.".into());
            }
            (*cparams).use_gpu = false;
            let ctx = init(model_c.as_ptr(), cparams);
            free_context_params(cparams);
            if ctx.is_null() {
                return Err("No pude cargar el modelo de voz preciso.".into());
            }

            let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(2, 8) as c_int;
            Ok(Whisper {
                ctx,
                full_defaults,
                free_params,
                full: symbol(&lib, b"whisper_full\0")?,
                n_segments: symbol(&lib, b"whisper_full_n_segments\0")?,
                segment_text: symbol(&lib, b"whisper_full_get_segment_text\0")?,
                no_speech: symbol(&lib, b"whisper_full_get_segment_no_speech_prob\0")?,
                free: symbol(&lib, b"whisper_free\0")?,
                threads,
                prompt: CString::new(PROMPT).unwrap_or_default(),
                language: CString::new("es").unwrap_or_default(),
                _lib: lib,
                _ggml: ggml,
            })
        }
    }

    /// Transcribe audio mono a 16 kHz (f32 en -1..1). Devuelve "" si no hay voz clara.
    pub fn transcribe(&mut self, audio: &[f32]) -> Result<String, String> {
        if audio.len() < 16_000 / 4 {
            return Ok(String::new()); // menos de 0,25 s: no es una orden
        }
        // Whisper rinde mal con audio de menos de 1 s: se rellena con silencio.
        let mut padded;
        let samples = if audio.len() < 16_000 + 1_600 {
            padded = audio.to_vec();
            padded.resize(16_000 + 1_600, 0.0);
            &padded[..]
        } else {
            audio
        };

        // SAFETY: parámetros nuevos por llamada (whisper_full puede modificar su copia) y liberados al final.
        unsafe {
            let params = (self.full_defaults)(0);
            if params.is_null() {
                return Err("No pude transcribir.".into());
            }
            let p = &mut *params;
            p.n_threads = self.threads;
            p.no_context = true;
            p.no_timestamps = true;
            p.single_segment = true;
            p.print_special = false;
            p.print_progress = false;
            p.print_realtime = false;
            p.print_timestamps = false;
            p.language = self.language.as_ptr();
            p.detect_language = false;
            p.initial_prompt = self.prompt.as_ptr();
            p.suppress_blank = true;
            p.suppress_nst = true;
            p.audio_ctx = audio_ctx(samples.len());

            let status = (self.full)(self.ctx, params, samples.as_ptr(), samples.len() as c_int);
            (self.free_params)(params);
            if status != 0 {
                return Err("No pude transcribir.".into());
            }

            let mut text = String::new();
            for i in 0..(self.n_segments)(self.ctx) {
                if (self.no_speech)(self.ctx, i) > 0.6 {
                    continue;
                }
                let ptr = (self.segment_text)(self.ctx, i);
                if !ptr.is_null() {
                    text.push_str(&CStr::from_ptr(ptr).to_string_lossy());
                }
            }
            Ok(clean(&text))
        }
    }
}

/// Whisper codifica siempre 30 s (1500 posiciones, 50 por segundo). Para órdenes cortas basta con la
/// duración real más un margen: el codificador trabaja varias veces menos.
fn audio_ctx(samples: usize) -> c_int {
    let seconds = samples as f32 / 16_000.0;
    let ctx = ((seconds + 1.0) * 50.0).ceil() as c_int;
    (((ctx + 63) / 64) * 64).clamp(256, 1500)
}

/// Quita espacios, alucinaciones típicas y textos que solo son ruido ("[música]", "...").
pub fn clean(raw: &str) -> String {
    let text = raw.trim();
    let lower = text.to_lowercase();
    if HALLUCINATIONS.iter().any(|h| lower.contains(h)) {
        return String::new();
    }
    if text.starts_with('[') || text.starts_with('(') || !text.chars().any(char::is_alphanumeric) {
        return String::new();
    }
    text.to_string()
}

impl Drop for Whisper {
    fn drop(&mut self) {
        // SAFETY: el contexto se libera una sola vez, antes que las bibliotecas.
        unsafe { (self.free)(self.ctx) }
    }
}

// Se crea y usa solo dentro del hilo del motor de voz.
unsafe impl Send for Whisper {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limpia_alucinaciones_y_ruido() {
        assert_eq!(clean("  Abre la calculadora. "), "Abre la calculadora.");
        assert_eq!(clean("Subtítulos realizados por la comunidad de Amara.org"), "");
        assert_eq!(clean("[Música]"), "");
        assert_eq!(clean(" ... "), "");
    }

    /// Manual: `SCORPK_WHISPER_DIR` (DLL + ggml-small-q5_1.bin) y `SCORPK_TEST_WAV` (16 kHz mono 16 bits).
    /// `cargo test whisper_transcribe -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn whisper_transcribe_un_wav() {
        let dir = std::path::PathBuf::from(std::env::var("SCORPK_WHISPER_DIR").expect("SCORPK_WHISPER_DIR"));
        let wav = std::fs::read(std::env::var("SCORPK_TEST_WAV").expect("SCORPK_TEST_WAV")).unwrap();
        let data_at = wav.windows(4).position(|w| w == b"data").expect("chunk data") + 8;
        let audio: Vec<f32> =
            wav[data_at..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
        let started = std::time::Instant::now();
        let mut whisper = Whisper::open(&dir, &dir.join("ggml-small-q5_1.bin")).expect("abrir Whisper");
        println!("CARGA: {:?}", started.elapsed());
        for _ in 0..2 {
            let started = std::time::Instant::now();
            let text = whisper.transcribe(&audio).expect("transcribir");
            println!("WHISPER ({:.1} s de audio) en {:?}: «{text}»", audio.len() as f32 / 16_000.0, started.elapsed());
            assert!(!text.is_empty());
        }
    }
}
