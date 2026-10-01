//! Motor de voz: un hilo que captura el micrófono (cpal/WASAPI), convierte a 16 kHz y alimenta a Vosk.
//! Si Whisper está instalado, la frase completa de cada orden se vuelve a transcribir con él (mucho
//! más preciso); Vosk queda para "Oye Scorpk", el texto en vivo y detectar cuándo terminaste de hablar.
//!
//! Modos:
//! - Wake: escucha continua buscando "Oye Scorpk" (todo offline).
//! - Command: transcribe lo que dices (parciales y frase final) y lo envía al overlay.
//! - Paused: micrófono ignorado (mientras Scorpk habla o procesa, para que no se oiga a sí mismo).
//! - Idle: sin nada que escuchar → el hilo termina y se libera el micrófono.

use super::{ffi::Session, resample::Resampler, wake, whisper::Whisper};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Sin decir nada tras "Oye Scorpk" (o tras pulsar el micrófono), vuelve a esperar el wake word.
const NO_SPEECH_TIMEOUT: Duration = Duration::from_secs(10);
/// Tope de una frase de comando.
const COMMAND_MAX: Duration = Duration::from_secs(30);
/// Audio guardado de la frase en curso para Whisper (16 kHz): como mucho los últimos 30 s.
const UTTERANCE_MAX: usize = 16_000 * 30;
/// Whisper ocupa ~250 MB de RAM: se descarga si no se usa en este tiempo (se vuelve a cargar en ~0,5 s).
const WHISPER_IDLE: Duration = Duration::from_secs(120);

/// Rutas de Whisper (carpeta con las DLL, archivo del modelo), si está instalado.
pub type WhisperPaths = Option<(PathBuf, PathBuf)>;

/// Whisper cargado bajo demanda. Si falla al cargar, no se reintenta: se sigue con el texto de Vosk.
struct Precise {
    paths: WhisperPaths,
    loaded: Option<Whisper>,
    last_used: Instant,
}

impl Precise {
    /// Carga Whisper si hace falta (al empezar una orden, mientras el usuario aún habla).
    fn preload(&mut self) {
        if self.loaded.is_none() {
            if let Some((dir, model)) = self.paths.as_ref() {
                match Whisper::open(dir, model) {
                    Ok(whisper) => self.loaded = Some(whisper),
                    Err(_) => self.paths = None,
                }
            }
        }
        self.last_used = Instant::now();
    }

    /// Transcribe con Whisper; `None` si no está disponible (entonces vale el texto de Vosk).
    fn transcribe(&mut self, pcm: &[i16]) -> Option<String> {
        self.preload();
        let audio: Vec<f32> = pcm.iter().map(|&s| s as f32 / 32768.0).collect();
        self.loaded.as_mut()?.transcribe(&audio).ok()
    }

    fn unload_if_idle(&mut self) {
        if self.loaded.is_some() && self.last_used.elapsed() > WHISPER_IDLE {
            self.loaded = None;
        }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Mode {
    Idle,
    Wake,
    Command,
    Paused,
}

pub enum Cmd {
    /// Activa o desactiva la escucha de "Oye Scorpk".
    WakeEnabled(bool),
    /// Empieza a transcribir un comando ahora (botón de micrófono).
    Listen,
    Pause,
    /// Vuelve a esperar el wake word (o se apaga si no está activo).
    Resume,
    Stop,
}

pub struct Engine {
    pub tx: mpsc::Sender<Cmd>,
    pub alive: Arc<AtomicBool>,
}

impl Engine {
    pub fn spawn(app: AppHandle, dll: PathBuf, model: PathBuf, whisper: WhisperPaths, wake_enabled: bool, start_listening: bool) -> Engine {
        let (tx, rx) = mpsc::channel();
        let alive = Arc::new(AtomicBool::new(true));
        let flag = alive.clone();
        std::thread::spawn(move || {
            if let Err(message) = run(&app, &dll, &model, whisper, rx, wake_enabled, start_listening) {
                let _ = app.emit("voice-error", message);
            }
            flag.store(false, Ordering::Relaxed);
        });
        Engine { tx, alive }
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }
}

/// Mezcla a mono y entrega bloques f32 por el canal. Corre en el hilo de audio: debe ser rápido.
fn build_stream(audio_tx: mpsc::Sender<Vec<f32>>) -> Result<(Stream, u32), String> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("No encuentro ningún micrófono.")?;
    let config = device.default_input_config().map_err(|_| "No pude leer la configuración del micrófono.".to_string())?;
    let channels = config.channels() as usize;
    let rate = config.sample_rate().0;
    let format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();
    let error_callback = |e| eprintln!("Error de audio: {e}");

    fn mono<T: Copy>(data: &[T], channels: usize, convert: impl Fn(T) -> f32) -> Vec<f32> {
        data.chunks(channels.max(1)).map(|frame| frame.iter().map(|&s| convert(s)).sum::<f32>() / frame.len() as f32).collect()
    }

    let stream = match format {
        SampleFormat::F32 => {
            let tx = audio_tx.clone();
            device.build_input_stream(&stream_config, move |d: &[f32], _| { let _ = tx.send(mono(d, channels, |s| s)); }, error_callback, None)
        }
        SampleFormat::I16 => {
            let tx = audio_tx.clone();
            device.build_input_stream(&stream_config, move |d: &[i16], _| { let _ = tx.send(mono(d, channels, |s| s as f32 / 32768.0)); }, error_callback, None)
        }
        SampleFormat::U16 => {
            let tx = audio_tx.clone();
            device.build_input_stream(&stream_config, move |d: &[u16], _| { let _ = tx.send(mono(d, channels, |s| (s as f32 - 32768.0) / 32768.0)); }, error_callback, None)
        }
        _ => return Err("Formato de micrófono no soportado.".into()),
    }
    .map_err(|_| "No pude abrir el micrófono. Revisa que esté permitido en Configuración > Privacidad > Micrófono.".to_string())?;
    stream.play().map_err(|_| "No pude iniciar el micrófono.".to_string())?;
    Ok((stream, rate))
}

fn run(
    app: &AppHandle,
    dll: &std::path::Path,
    model: &std::path::Path,
    whisper: WhisperPaths,
    rx: mpsc::Receiver<Cmd>,
    wake_enabled: bool,
    start_listening: bool,
) -> Result<(), String> {
    let mut session = Session::open(dll, model)?;
    let mut precise = Precise { paths: whisper, loaded: None, last_used: Instant::now() };
    let mut utterance: Vec<i16> = Vec::new();
    let (audio_tx, audio_rx) = mpsc::channel();
    let (stream, rate) = build_stream(audio_tx)?;
    let _keep_stream_alive = &stream; // cpal::Stream no es Send: vive y muere en este hilo.

    let mut resampler = Resampler::new(rate);
    let mut pcm: Vec<i16> = Vec::new();
    let mut wake_on = wake_enabled;
    let mut mode = if start_listening { Mode::Command } else if wake_on { Mode::Wake } else { Mode::Idle };
    let mut command_started = Instant::now();
    let mut heard_speech = false;
    let _ = app.emit("voice-ready", ());

    loop {
        // Órdenes desde la app.
        while let Ok(cmd) = rx.try_recv() {
            let previous = mode;
            match cmd {
                Cmd::Stop => return Ok(()),
                Cmd::WakeEnabled(on) => {
                    wake_on = on;
                    if on && mode == Mode::Idle {
                        mode = Mode::Wake;
                    } else if !on && mode == Mode::Wake {
                        mode = Mode::Idle;
                    }
                }
                Cmd::Listen => mode = Mode::Command,
                Cmd::Pause => mode = Mode::Paused,
                Cmd::Resume => mode = if wake_on { Mode::Wake } else { Mode::Idle },
            }
            if mode != previous {
                session.reset();
                resampler.reset();
                utterance.clear();
                command_started = Instant::now();
                heard_speech = false;
                if mode == Mode::Command {
                    precise.preload();
                }
            }
            if mode == Mode::Idle {
                return Ok(()); // nada que escuchar: se libera el micrófono
            }
        }

        let chunk = match audio_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => chunk,
            Err(mpsc::RecvTimeoutError::Timeout) => Vec::new(),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("Se perdió el micrófono.".into()),
        };

        // Tiempos de espera del modo comando.
        if mode == Mode::Command {
            let elapsed = command_started.elapsed();
            if (!heard_speech && elapsed > NO_SPEECH_TIMEOUT) || elapsed > COMMAND_MAX {
                let _ = app.emit("voice-timeout", ());
                mode = if wake_on { Mode::Wake } else { Mode::Idle };
                session.reset();
                resampler.reset();
                utterance.clear();
                if mode == Mode::Idle {
                    return Ok(());
                }
                continue;
            }
        }
        if mode == Mode::Wake {
            precise.unload_if_idle();
        }
        if chunk.is_empty() || matches!(mode, Mode::Idle | Mode::Paused) {
            continue;
        }

        pcm.clear();
        resampler.process(&chunk, &mut pcm);
        utterance.extend_from_slice(&pcm);
        if utterance.len() > UTTERANCE_MAX {
            utterance.drain(..utterance.len() - UTTERANCE_MAX);
        }
        let finished = session.accept(&pcm);

        match mode {
            Mode::Wake => {
                let text = finished.clone().unwrap_or_else(|| session.partial());
                if let Some(found) = wake::find(&text) {
                    session.reset();
                    resampler.reset();
                    crate::overlay::show(app);
                    let _ = app.emit("voice-wake", ());
                    if finished.is_some() && !found.remainder.is_empty() {
                        // "Oye Scorpk abre la calculadora" dicho de corrido: la orden ya viene en la misma frase.
                        let _ = app.emit("voice-transcribing", ());
                        let order = precise
                            .transcribe(&utterance)
                            .and_then(|t| wake::find(&t))
                            .map(|m| m.remainder)
                            .filter(|r| !r.is_empty())
                            .unwrap_or(found.remainder);
                        let _ = app.emit("voice-final", order);
                        mode = Mode::Paused;
                    } else {
                        mode = Mode::Command;
                        precise.preload();
                        command_started = Instant::now();
                        heard_speech = false;
                    }
                    utterance.clear();
                } else if finished.is_some() {
                    session.reset();
                    utterance.clear();
                }
            }
            Mode::Command => {
                if let Some(vosk_text) = finished {
                    if vosk_text.is_empty() {
                        utterance.clear(); // ruido o silencio: no arrastrarlo a la orden
                        continue;
                    }
                    let _ = app.emit("voice-transcribing", ());
                    match precise.transcribe(&utterance) {
                        // Whisper no oyó una orden clara: era ruido (Vosk a veces "inventa" palabras).
                        Some(text) if text.is_empty() => {
                            let _ = app.emit("voice-timeout", ());
                            mode = if wake_on { Mode::Wake } else { Mode::Idle };
                        }
                        Some(text) => {
                            let _ = app.emit("voice-final", text);
                            mode = Mode::Paused; // la app procesa, habla y luego pide Resume
                        }
                        None => {
                            let _ = app.emit("voice-final", vosk_text);
                            mode = Mode::Paused;
                        }
                    }
                    session.reset();
                    resampler.reset();
                    utterance.clear();
                    if mode == Mode::Idle {
                        return Ok(());
                    }
                } else {
                    let partial = session.partial();
                    if !partial.is_empty() {
                        heard_speech = true;
                        let _ = app.emit("voice-partial", partial);
                    }
                }
            }
            Mode::Idle | Mode::Paused => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual: `cargo test micro_captura -- --ignored --nocapture`. Abre el micrófono por defecto 1 s.
    #[test]
    #[ignore]
    fn micro_captura_audio_real() {
        let (tx, rx) = mpsc::channel();
        let (stream, rate) = build_stream(tx).expect("abrir micrófono");
        let _keep = &stream;
        let mut samples = 0usize;
        let mut peak = 0f32;
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(1) {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(100)) {
                samples += chunk.len();
                peak = chunk.iter().fold(peak, |p, s| p.max(s.abs()));
            }
        }
        println!("MIC: {rate} Hz, {samples} muestras en 1 s, pico {peak:.4}");
        assert!(samples as u32 > rate / 2, "el micrófono no entregó audio");
    }
}
