//! Descarga e instalación del motor de voz: Vosk + modelo en español ("Oye Scorpk" y detección de
//! fin de frase) y Whisper + modelo small (transcripción precisa de la orden).
//!
//! Nada se instala sin verificar: cada archivo se comprueba con un SHA-256 fijado aquí y se
//! extrae solo lo necesario (DLL por nombre fijo, y el modelo sin salirse de su carpeta).
//! Se guarda en la carpeta de datos de la app, no en el instalador (que queda ligero).

use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const VOSK_URL: &str = "https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-win64-0.3.45.zip";
const VOSK_SHA256: &str = "f1dcc9cca460630f81ea8f71794f69c80bed6556d2a4e6237b5785e1d2dff34b";
const VOSK_SIZE: u64 = 14_882_445;

const MODEL_URL: &str = "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip";
const MODEL_SHA256: &str = "09b239888f633ef2f0b4e09736e3d9936acfd810bc65d53fad45261762c6511f";
const MODEL_SIZE: u64 = 39_817_833;

const WHISPER_URL: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip";
const WHISPER_SHA256: &str = "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c";
const WHISPER_SIZE: u64 = 8_573_270;

const WHISPER_MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin";
const WHISPER_MODEL_SHA256: &str = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb";
const WHISPER_MODEL_SIZE: u64 = 190_085_487;
const WHISPER_MODEL_FILE: &str = "ggml-small-q5_1.bin";

/// Las únicas DLL que se extraen del zip de Vosk.
const ALLOWED_DLLS: &[&str] = &["libvosk.dll", "libstdc++-6.dll", "libgcc_s_seh-1.dll", "libwinpthread-1.dll"];

/// Las únicas DLL que se extraen del zip de whisper.cpp (ggml elige la de CPU que corresponda).
const WHISPER_DLLS: &[&str] = &[
    "whisper.dll",
    "ggml.dll",
    "ggml-base.dll",
    "ggml-cpu-alderlake.dll",
    "ggml-cpu-cannonlake.dll",
    "ggml-cpu-cascadelake.dll",
    "ggml-cpu-haswell.dll",
    "ggml-cpu-icelake.dll",
    "ggml-cpu-sandybridge.dll",
    "ggml-cpu-skylakex.dll",
    "ggml-cpu-sse42.dll",
    "ggml-cpu-x64.dll",
];

/// Runtime de Visual C++ que necesita whisper.cpp; viaja en el instalador (carpeta de recursos `vcrt`)
/// y se copia junto a whisper.dll, por si el equipo no tiene instalado el redistribuible.
const VC_RUNTIME: &[&str] = &["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll", "vcomp140.dll"];

pub fn dll_path(dir: &Path) -> PathBuf {
    dir.join("vosk").join("libvosk.dll")
}

pub fn model_dir(dir: &Path) -> PathBuf {
    dir.join("model-es")
}

pub fn is_installed(dir: &Path) -> bool {
    dll_path(dir).is_file() && model_dir(dir).join("am").join("final.mdl").is_file()
}

pub fn whisper_dir(dir: &Path) -> PathBuf {
    dir.join("whisper")
}

pub fn whisper_model(dir: &Path) -> PathBuf {
    whisper_dir(dir).join(WHISPER_MODEL_FILE)
}

pub fn is_whisper_installed(dir: &Path) -> bool {
    whisper_dir(dir).join("whisper.dll").is_file() && whisper_model(dir).is_file()
}

/// Descarga `url` a `dest`, verificando tamaño máximo y SHA-256. `on_progress` recibe 0..=100.
fn download(url: &str, dest: &Path, expected_sha: &str, expected_size: u64, mut on_progress: impl FnMut(u8)) -> Result<(), String> {
    let response = ureq::get(url)
        .timeout(std::time::Duration::from_secs(600))
        .call()
        .map_err(|_| "No pude descargar el motor de voz. Revisa tu internet.".to_string())?;
    let mut reader = response.into_reader();
    let part = dest.with_extension("part");
    let mut file = File::create(&part).map_err(|e| format!("No pude guardar la descarga: {e}"))?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut total: u64 = 0;
    let mut last_percent = 255u8;
    loop {
        let read = reader.read(&mut buffer).map_err(|_| "Se cortó la descarga.".to_string())?;
        if read == 0 {
            break;
        }
        total += read as u64;
        // Tope de seguridad: nunca más de lo esperado (+1 MB de margen).
        if total > expected_size + 1_048_576 {
            let _ = fs::remove_file(&part);
            return Err("La descarga es más grande de lo esperado.".into());
        }
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read]).map_err(|e| format!("No pude guardar la descarga: {e}"))?;
        let percent = ((total * 100) / expected_size.max(1)).min(100) as u8;
        if percent != last_percent {
            last_percent = percent;
            on_progress(percent);
        }
    }
    drop(file);

    let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if actual != expected_sha {
        let _ = fs::remove_file(&part);
        return Err("La descarga no coincide con la huella esperada; se descartó por seguridad.".into());
    }
    fs::rename(&part, dest).map_err(|e| format!("No pude terminar la descarga: {e}"))
}

fn extract_dlls(zip_path: &Path, out_dir: &Path, allowed: &[&str]) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(File::open(zip_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let mut found = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // Solo el nombre de archivo, y solo si está en la lista: nada de rutas del zip.
        let Some(name) = entry.name().rsplit(['/', '\\']).next().map(str::to_string) else { continue };
        if !allowed.contains(&name.as_str()) {
            continue;
        }
        let mut out = File::create(out_dir.join(&name)).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        found += 1;
    }
    if found == allowed.len() {
        Ok(())
    } else {
        Err("El paquete del motor de voz está incompleto.".into())
    }
}

/// Extrae el modelo quitando la carpeta raíz ("vosk-model-small-es-0.42/").
fn extract_model(zip_path: &Path, out_dir: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(File::open(zip_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // enclosed_name rechaza rutas absolutas y con "..": evita escribir fuera de out_dir.
        let Some(path) = entry.enclosed_name() else { continue };
        let relative: PathBuf = path.components().skip(1).collect();
        if relative.as_os_str().is_empty() {
            continue;
        }
        let target = out_dir.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = File::create(&target).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Instala el motor y el modelo. `progress(etapa, porcentaje)` con etapa "motor" o "modelo".
pub fn install(dir: &Path, mut progress: impl FnMut(&str, u8)) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("No pude crear la carpeta de voz: {e}"))?;

    if !dll_path(dir).is_file() {
        let zip = dir.join("vosk-win64.zip");
        download(VOSK_URL, &zip, VOSK_SHA256, VOSK_SIZE, |p| progress("motor", p))?;
        let vosk_dir = dir.join("vosk");
        let _ = fs::remove_dir_all(&vosk_dir);
        let result = extract_dlls(&zip, &vosk_dir, ALLOWED_DLLS);
        let _ = fs::remove_file(&zip);
        result?;
    }

    if !model_dir(dir).join("am").join("final.mdl").is_file() {
        let zip = dir.join("model-es.zip");
        download(MODEL_URL, &zip, MODEL_SHA256, MODEL_SIZE, |p| progress("modelo", p))?;
        // Se extrae a una carpeta temporal y se renombra al final: nunca queda un modelo a medias.
        let tmp = dir.join("model-es.tmp");
        let _ = fs::remove_dir_all(&tmp);
        let result = extract_model(&zip, &tmp);
        let _ = fs::remove_file(&zip);
        result?;
        let _ = fs::remove_dir_all(model_dir(dir));
        fs::rename(&tmp, model_dir(dir)).map_err(|e| format!("No pude terminar la instalación: {e}"))?;
    }
    Ok(())
}

/// Instala Whisper (motor + modelo small, ~200 MB). `vc_runtime` es la carpeta de recursos con el
/// runtime de Visual C++. `progress(etapa, porcentaje)` con etapa "preciso-motor" o "preciso-modelo".
pub fn install_whisper(dir: &Path, vc_runtime: &Path, mut progress: impl FnMut(&str, u8)) -> Result<(), String> {
    let wdir = whisper_dir(dir);
    if !wdir.join("whisper.dll").is_file() {
        fs::create_dir_all(dir).map_err(|e| format!("No pude crear la carpeta de voz: {e}"))?;
        let zip = dir.join("whisper-bin-x64.zip");
        download(WHISPER_URL, &zip, WHISPER_SHA256, WHISPER_SIZE, |p| progress("preciso-motor", p))?;
        // Se extrae a una carpeta temporal: whisper.dll (la que marca "instalado") nunca queda a medias.
        let tmp = dir.join("whisper.tmp");
        let _ = fs::remove_dir_all(&tmp);
        let result = extract_dlls(&zip, &tmp, WHISPER_DLLS).and_then(|_| copy_vc_runtime(vc_runtime, &tmp));
        let _ = fs::remove_file(&zip);
        result?;
        let model = whisper_model(dir);
        let kept_model = dir.join(WHISPER_MODEL_FILE);
        if model.is_file() {
            let _ = fs::rename(&model, &kept_model); // no volver a bajar 190 MB si solo faltaban las DLL
        }
        let _ = fs::remove_dir_all(&wdir);
        fs::rename(&tmp, &wdir).map_err(|e| format!("No pude terminar la instalación: {e}"))?;
        if kept_model.is_file() {
            let _ = fs::rename(&kept_model, &model);
        }
    }

    if !whisper_model(dir).is_file() {
        let part = wdir.join("modelo.descarga");
        download(WHISPER_MODEL_URL, &part, WHISPER_MODEL_SHA256, WHISPER_MODEL_SIZE, |p| progress("preciso-modelo", p))?;
        fs::rename(&part, whisper_model(dir)).map_err(|e| format!("No pude terminar la instalación: {e}"))?;
    }
    Ok(())
}

fn copy_vc_runtime(from: &Path, to: &Path) -> Result<(), String> {
    for name in VC_RUNTIME {
        fs::copy(from.join(name), to.join(name)).map_err(|_| "Falta el runtime de Visual C++ en la instalación de Scorpk.".to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rutas_y_estado() {
        let dir = std::env::temp_dir().join("scorpk-voice-test-none");
        assert!(!is_installed(&dir));
        assert!(dll_path(&dir).ends_with("vosk/libvosk.dll") || dll_path(&dir).ends_with(r"vosk\libvosk.dll"));
    }

    /// Manual: instala Whisper de verdad en `SCORPK_VOICE_DIR` usando el runtime de `vcrt/`.
    /// `cargo test instala_whisper -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn instala_whisper_real() {
        let dir = PathBuf::from(std::env::var("SCORPK_VOICE_DIR").expect("SCORPK_VOICE_DIR"));
        install_whisper(&dir, Path::new("vcrt"), |stage, p| if p % 25 == 0 { println!("{stage}: {p}%") }).expect("instalar Whisper");
        assert!(is_whisper_installed(&dir));
        for name in WHISPER_DLLS.iter().chain(VC_RUNTIME) {
            assert!(whisper_dir(&dir).join(name).is_file(), "falta {name}");
        }
    }

    #[test]
    fn las_huellas_fijadas_son_sha256_validos() {
        for sha in [VOSK_SHA256, MODEL_SHA256, WHISPER_SHA256, WHISPER_MODEL_SHA256] {
            assert_eq!(sha.len(), 64);
            assert!(sha.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        }
    }
}
