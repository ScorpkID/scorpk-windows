//! `open_app`: abre un programa por su nombre.
//!
//! 1. Alias fijos (calculadora, bloc de notas, configuración...).
//! 2. Accesos directos del Menú Inicio (.lnk), elegidos por coincidencia de nombre.
//!
//! Se lanza con `explorer.exe <ruta>` o con un .exe de una lista fija: el nombre que escribe el
//! usuario NUNCA se pasa a un shell.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// (nombres aceptados, programa o URI a lanzar, nombre para mostrar)
const ALIASES: &[(&[&str], &str, &str)] = &[
    (&["calculadora", "calculator", "calc"], "calc.exe", "la Calculadora"),
    (&["bloc de notas", "notepad", "notas"], "notepad.exe", "el Bloc de notas"),
    (&["paint", "pintura"], "mspaint.exe", "Paint"),
    (&["administrador de tareas", "task manager"], "taskmgr.exe", "el Administrador de tareas"),
    (&["explorador", "explorador de archivos", "archivos", "mis archivos", "este equipo"], "explorer.exe", "el Explorador de archivos"),
    (&["configuracion", "ajustes", "settings"], "ms-settings:", "la Configuración"),
];

/// Minúsculas, sin tildes y solo letras/números/espacios simples.
pub fn normalize(text: &str) -> String {
    let mapped: String = text
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect();
    mapped.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Puntúa qué tan bien encaja un nombre de acceso directo con la búsqueda (0 = no encaja).
fn score(candidate: &str, query: &str) -> u8 {
    if candidate == query {
        3
    } else if candidate.starts_with(query) {
        2
    } else if candidate.contains(query) {
        1
    } else {
        0
    }
}

/// Elige el mejor acceso directo. A igual puntuación gana el nombre más corto (p. ej. "Chrome" > "Chrome Remote Desktop").
pub fn best_match(candidates: &[(String, PathBuf)], query: &str) -> Option<(String, PathBuf)> {
    let query = normalize(query);
    if query.is_empty() {
        return None;
    }
    candidates
        .iter()
        .filter(|(name, _)| {
            let n = normalize(name);
            !n.contains("desinstal") && !n.contains("uninstall")
        })
        .map(|(name, path)| (score(&normalize(name), &query), name, path))
        .filter(|(s, _, _)| *s > 0)
        .max_by(|a, b| a.0.cmp(&b.0).then(b.1.len().cmp(&a.1.len())))
        .map(|(_, name, path)| (name.clone(), path.clone()))
}

/// Recorre las carpetas del Menú Inicio (máx. 4 niveles) y junta los .lnk.
fn start_menu_shortcuts() -> Vec<(String, PathBuf)> {
    let mut roots = Vec::new();
    for var in ["ProgramData", "APPDATA"] {
        if let Ok(base) = std::env::var(var) {
            roots.push(Path::new(&base).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
    }
    let mut found = Vec::new();
    for root in roots {
        collect(&root, 0, &mut found);
    }
    found
}

fn collect(dir: &Path, depth: u8, out: &mut Vec<(String, PathBuf)>) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, depth + 1, out);
        } else if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                out.push((stem.to_string(), path));
            }
        }
    }
}

fn launch(program: &str, arg: Option<&str>) -> Result<(), String> {
    let mut command = Command::new(program);
    if let Some(arg) = arg {
        command.arg(arg);
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().map(|_| ()).map_err(|_| "No pude abrirlo.".to_string())
}

#[tauri::command]
pub fn open_app(name: String) -> Result<String, String> {
    let query = normalize(&name);
    if query.is_empty() || query.len() > 60 {
        return Err("No entendí qué programa abrir.".into());
    }

    if let Some((_, program, display)) = ALIASES.iter().find(|(names, _, _)| names.contains(&query.as_str())) {
        if program.ends_with(':') {
            launch("explorer.exe", Some(program))?;
        } else {
            launch(program, None)?;
        }
        return Ok(display.to_string());
    }

    let shortcuts = start_menu_shortcuts();
    match best_match(&shortcuts, &query) {
        Some((display, path)) => {
            // explorer.exe abre el acceso directo sin interpretar el nombre como comando.
            launch("explorer.exe", Some(&path.to_string_lossy()))?;
            Ok(display)
        }
        None => Err(format!("No encontré ningún programa llamado «{}».", name.trim())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn items(names: &[&str]) -> Vec<(String, PathBuf)> {
        names.iter().map(|n| (n.to_string(), PathBuf::from(format!("{n}.lnk")))).collect()
    }

    #[test]
    fn normaliza_tildes_y_signos() {
        assert_eq!(normalize("  Configuración!! "), "configuracion");
        assert_eq!(normalize("Bloc  de NOTAS"), "bloc de notas");
    }

    #[test]
    fn prefiere_coincidencia_exacta_y_nombre_corto() {
        let list = items(&["Google Chrome", "Chrome Remote Desktop", "Chrome"]);
        assert_eq!(best_match(&list, "chrome").unwrap().0, "Chrome");
        let list = items(&["Spotify", "Spotify Helper Tools"]);
        assert_eq!(best_match(&list, "spotify").unwrap().0, "Spotify");
    }

    #[test]
    fn ignora_desinstaladores_y_sin_coincidencias() {
        let list = items(&["Desinstalar Discord", "Discord"]);
        assert_eq!(best_match(&list, "discord").unwrap().0, "Discord");
        assert!(best_match(&list, "zzz").is_none());
        assert!(best_match(&list, "   ").is_none());
    }
}
