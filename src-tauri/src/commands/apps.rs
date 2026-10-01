//! `open_app` / `list_apps`: abrir cualquier programa instalado por su nombre.
//!
//! Fuentes, en orden:
//! 1. Alias fijos (calculadora, bloc de notas, configuración...).
//! 2. Todas las apps del Menú Inicio, incluidas las de la Microsoft Store (WhatsApp, Spotify de la
//!    Store, etc.), con `Get-StartApps` (comando fijo, sin texto del usuario) y se lanzan con
//!    `explorer.exe shell:AppsFolder\<AppID>`.
//! 3. Accesos directos (.lnk) del Menú Inicio, por si Get-StartApps no los listara.
//!
//! El nombre que escribe el usuario NUNCA se pasa a un shell: solo se compara con la lista, y lo que
//! se lanza es un identificador que sale de esa lista (como único argumento, sin shell).

use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// La lista de apps instaladas se guarda unos minutos para no invocar PowerShell en cada orden.
const CACHE_TTL: Duration = Duration::from_secs(300);

/// (nombres aceptados, programa o URI a lanzar, nombre para mostrar)
const ALIASES: &[(&[&str], &str, &str)] = &[
    (&["calculadora", "calculator", "calc"], "calc.exe", "la Calculadora"),
    (&["bloc de notas", "notepad", "notas"], "notepad.exe", "el Bloc de notas"),
    (&["paint", "pintura"], "mspaint.exe", "Paint"),
    (&["administrador de tareas", "task manager"], "taskmgr.exe", "el Administrador de tareas"),
    (&["explorador", "explorador de archivos", "archivos", "mis archivos", "este equipo"], "explorer.exe", "el Explorador de archivos"),
    (&["configuracion", "ajustes", "settings"], "ms-settings:", "la Configuración"),
];

/// Cómo suena en español lo que se escribe en inglés: se corrige antes de comparar.
const PHONETIC: &[(&str, &str)] = &[
    ("guasap", "whatsapp"),
    ("wasap", "whatsapp"),
    ("guatsap", "whatsapp"),
    ("whatsap", "whatsapp"),
    ("watsap", "whatsapp"),
    ("wazap", "whatsapp"),
    ("yutub", "youtube"),
    ("iutub", "youtube"),
    ("espotifai", "spotify"),
    ("spotifai", "spotify"),
    ("disco", "discord"),
    ("tiktok", "tik tok"),
];

#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    /// Identificador de `shell:AppsFolder` (Get-StartApps).
    AppsFolder(String),
    Shortcut(PathBuf),
}

#[derive(Clone, Debug, PartialEq)]
pub struct AppEntry {
    pub name: String,
    pub target: Target,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct StartApp {
    name: Option<String>,
    #[serde(rename = "AppID")]
    app_id: Option<String>,
}

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

/// Aplica las correcciones fonéticas ("guasap" → "whatsapp") sobre palabras completas.
fn apply_phonetic(query: &str) -> String {
    query
        .split(' ')
        .map(|word| PHONETIC.iter().find(|(heard, _)| *heard == word).map_or(word, |(_, fixed)| fixed))
        .collect::<Vec<_>>()
        .join(" ")
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0; b.len() + 1];
    for i in 1..=a.len() {
        current[0] = i;
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            current[j] = (current[j - 1] + 1).min(previous[j] + 1).min(previous[j - 1] + cost);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

fn similarity(a: &str, b: &str) -> f64 {
    let longest = a.chars().count().max(b.chars().count());
    if longest == 0 {
        return 1.0;
    }
    1.0 - levenshtein(a, b) as f64 / longest as f64
}

/// Mínimo de parecido para aceptar un nombre mal escuchado/escrito ("crom" → "chrome").
const FUZZY_MIN: f64 = 0.65;
const FUZZY_MIN_LEN: usize = 4;

/// Puntúa qué tan bien encaja un nombre de app con la búsqueda (0 = no encaja).
fn score(candidate: &str, query: &str) -> u32 {
    if candidate == query {
        return 1000;
    }
    if candidate.starts_with(query) {
        return 800;
    }
    let query_tokens: Vec<&str> = query.split(' ').collect();
    let candidate_tokens: Vec<&str> = candidate.split(' ').collect();
    if query_tokens.iter().all(|q| candidate_tokens.iter().any(|c| c.starts_with(q))) {
        return 650;
    }
    if candidate.contains(query) {
        return 500;
    }
    // La búsqueda trae de más ("whatsapp desktop" → app "WhatsApp").
    if candidate.len() >= FUZZY_MIN_LEN && query.contains(candidate) {
        return 450;
    }
    // Errores de escucha: compara con el nombre completo y con cada palabra suya.
    if query.chars().count() >= FUZZY_MIN_LEN {
        let best = std::iter::once(candidate)
            .chain(candidate_tokens.iter().copied())
            .filter(|c| c.chars().count() >= FUZZY_MIN_LEN)
            .map(|c| similarity(c, query))
            .fold(0.0_f64, f64::max);
        if best >= FUZZY_MIN {
            return (best * 400.0) as u32;
        }
    }
    0
}

/// Elige la mejor app. A igual puntuación gana el nombre más corto (p. ej. "Chrome" > "Chrome Remote Desktop").
pub fn best_match<'a>(apps: &'a [AppEntry], query: &str) -> Option<&'a AppEntry> {
    let query = apply_phonetic(&normalize(query));
    if query.is_empty() {
        return None;
    }
    apps.iter()
        .filter(|app| {
            let n = normalize(&app.name);
            !n.contains("desinstal") && !n.contains("uninstall")
        })
        .map(|app| (score(&normalize(&app.name), &query), app))
        .filter(|(s, _)| *s > 0)
        .max_by(|a, b| a.0.cmp(&b.0).then(b.1.name.len().cmp(&a.1.name.len())))
        .map(|(_, app)| app)
}

#[cfg(windows)]
fn no_window(command: &mut Command) -> &mut Command {
    command.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
fn no_window(command: &mut Command) -> &mut Command {
    command
}

/// Apps del Menú Inicio (Win32 y de la Store). El comando es fijo: no lleva texto del usuario.
fn start_apps() -> Vec<AppEntry> {
    let mut command = Command::new("powershell.exe");
    no_window(&mut command).args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress",
    ]);
    let Ok(output) = command.output() else { return Vec::new() };
    parse_start_apps(&String::from_utf8_lossy(&output.stdout))
}

/// `ConvertTo-Json` devuelve un objeto (no una lista) cuando solo hay una app: se aceptan ambos.
pub fn parse_start_apps(json: &str) -> Vec<AppEntry> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json.trim().trim_start_matches('\u{feff}')) else {
        return Vec::new();
    };
    let items = match value {
        serde_json::Value::Array(items) => items,
        other => vec![other],
    };
    items
        .into_iter()
        .filter_map(|item| serde_json::from_value::<StartApp>(item).ok())
        .filter_map(|app| {
            let name = app.name?.trim().to_string();
            let id = app.app_id?.trim().to_string();
            // Un AppID es un identificador de app: nada de comillas ni caracteres de control.
            let safe = !name.is_empty() && !id.is_empty() && !id.chars().any(|c| c.is_control() || c == '"');
            safe.then_some(AppEntry { name, target: Target::AppsFolder(id) })
        })
        .collect()
}

/// Accesos directos (.lnk) del Menú Inicio (máx. 4 niveles de carpetas).
fn start_menu_shortcuts() -> Vec<AppEntry> {
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

fn collect(dir: &Path, depth: u8, out: &mut Vec<AppEntry>) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, depth + 1, out);
        } else if path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("lnk")) {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                out.push(AppEntry { name: stem.to_string(), target: Target::Shortcut(path) });
            }
        }
    }
}

static CACHE: Mutex<Option<(Instant, Vec<AppEntry>)>> = Mutex::new(None);

/// Todas las apps instaladas (con caché de unos minutos). Las de Get-StartApps tienen prioridad.
pub fn installed_apps() -> Vec<AppEntry> {
    if let Ok(guard) = CACHE.lock() {
        if let Some((at, apps)) = guard.as_ref() {
            if at.elapsed() < CACHE_TTL {
                return apps.clone();
            }
        }
    }
    let mut apps = start_apps();
    let known: std::collections::HashSet<String> = apps.iter().map(|a| normalize(&a.name)).collect();
    apps.extend(start_menu_shortcuts().into_iter().filter(|a| !known.contains(&normalize(&a.name))));
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((Instant::now(), apps.clone()));
    }
    apps
}

fn launch(program: &str, arg: Option<&str>) -> Result<(), String> {
    let mut command = Command::new(program);
    if let Some(arg) = arg {
        command.arg(arg);
    }
    no_window(&mut command);
    command.spawn().map(|_| ()).map_err(|_| "No pude abrirlo.".to_string())
}

fn open_entry(app: &AppEntry) -> Result<(), String> {
    match &app.target {
        // explorer.exe recibe el identificador como un único argumento (sin shell).
        Target::AppsFolder(id) => launch("explorer.exe", Some(&format!(r"shell:AppsFolder\{id}"))),
        Target::Shortcut(path) => launch("explorer.exe", Some(&path.to_string_lossy())),
    }
}

fn open_by_name(name: &str) -> Result<String, String> {
    let query = normalize(name);
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

    let apps = installed_apps();
    match best_match(&apps, &query) {
        Some(app) => {
            open_entry(app)?;
            Ok(app.name.clone())
        }
        None => Err(format!("No encontré ningún programa llamado «{}».", name.trim())),
    }
}

/// Abre un programa por su nombre. Async + hilo aparte: listar las apps puede tardar un par de segundos.
#[tauri::command]
pub async fn open_app(name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || open_by_name(&name))
        .await
        .map_err(|_| "No pude abrirlo.".to_string())?
}

/// Nombres de las apps instaladas (para que la IA elija la que el usuario quiso decir).
#[tauri::command]
pub async fn list_apps() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut names: Vec<String> = installed_apps().into_iter().map(|a| a.name).collect();
        names.sort_by_key(|n| n.to_lowercase());
        names.dedup_by_key(|n| n.to_lowercase());
        names
    })
    .await
    .map_err(|_| "No pude listar las apps.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lnk(names: &[&str]) -> Vec<AppEntry> {
        names.iter().map(|n| AppEntry { name: n.to_string(), target: Target::Shortcut(PathBuf::from(format!("{n}.lnk"))) }).collect()
    }

    fn pick(apps: &[AppEntry], query: &str) -> Option<String> {
        best_match(apps, query).map(|a| a.name.clone())
    }

    #[test]
    fn normaliza_tildes_y_signos() {
        assert_eq!(normalize("  Configuración!! "), "configuracion");
        assert_eq!(normalize("Bloc  de NOTAS"), "bloc de notas");
    }

    #[test]
    fn prefiere_coincidencia_exacta_y_nombre_corto() {
        let list = lnk(&["Google Chrome", "Chrome Remote Desktop", "Chrome"]);
        assert_eq!(pick(&list, "chrome").as_deref(), Some("Chrome"));
        let list = lnk(&["Spotify", "Spotify Helper Tools"]);
        assert_eq!(pick(&list, "spotify").as_deref(), Some("Spotify"));
    }

    #[test]
    fn ignora_desinstaladores_y_sin_coincidencias() {
        let list = lnk(&["Desinstalar Discord", "Discord"]);
        assert_eq!(pick(&list, "discord").as_deref(), Some("Discord"));
        assert!(pick(&list, "zzzzzz").is_none());
        assert!(pick(&list, "   ").is_none());
    }

    #[test]
    fn entiende_nombres_mal_escuchados() {
        let list = lnk(&["WhatsApp", "Google Chrome", "Microsoft Edge", "Spotify"]);
        assert_eq!(pick(&list, "guasap").as_deref(), Some("WhatsApp"));
        assert_eq!(pick(&list, "wasap").as_deref(), Some("WhatsApp"));
        assert_eq!(pick(&list, "whatsapp desktop").as_deref(), Some("WhatsApp"));
        assert_eq!(pick(&list, "crom").as_deref(), Some("Google Chrome"));
        assert_eq!(pick(&list, "espotifai").as_deref(), Some("Spotify"));
        assert_eq!(pick(&list, "edge").as_deref(), Some("Microsoft Edge"));
    }

    #[test]
    fn no_abre_algo_cualquiera_con_nombres_distintos() {
        let list = lnk(&["WhatsApp", "Google Chrome"]);
        assert!(pick(&list, "photoshop").is_none());
        assert!(pick(&list, "xyz").is_none());
    }

    #[test]
    fn lee_la_salida_de_get_startapps() {
        let many = r#"[{"Name":"WhatsApp","AppID":"5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"},{"Name":"Calculadora","AppID":"Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"}]"#;
        let apps = parse_start_apps(many);
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].name, "WhatsApp");
        assert_eq!(apps[0].target, Target::AppsFolder("5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App".into()));
        // Una sola app: PowerShell devuelve un objeto, no una lista; también con BOM.
        let one = "\u{feff}{\"Name\":\"Solo\",\"AppID\":\"X!App\"}";
        assert_eq!(parse_start_apps(one).len(), 1);
        // Entradas peligrosas o rotas se descartan.
        assert!(parse_start_apps(r#"[{"Name":"Mala","AppID":"a\"b"},{"Name":"","AppID":"x"}]"#).is_empty());
        assert!(parse_start_apps("basura").is_empty());
    }

    /// Manual: abre de verdad una app. `SCORPK_TEST_APP="guasap" cargo test abre_una_app_real -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn abre_una_app_real() {
        let name = std::env::var("SCORPK_TEST_APP").expect("SCORPK_TEST_APP");
        println!("apps instaladas: {}", installed_apps().len());
        println!("RESULTADO: {:?}", open_by_name(&name));
    }
}
