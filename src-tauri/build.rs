use std::path::{Path, PathBuf};

/// Runtime de Visual C++ (redistribuible) que necesita whisper.cpp. Se copia desde las Build Tools a
/// `vcrt/` (ignorada por git) y viaja en el instalador como recurso. Ver src/voice/installer.rs.
const VC_RUNTIME: &[(&str, &str)] = &[
    ("CRT", "msvcp140.dll"),
    ("CRT", "vcruntime140.dll"),
    ("CRT", "vcruntime140_1.dll"),
    ("OpenMP", "vcomp140.dll"),
];

/// Busca `VC/Redist/MSVC/<versión>/x64` en las instalaciones de Visual Studio / Build Tools.
fn redist_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("VCToolsRedistDir") {
        return Some(PathBuf::from(dir).join("x64"));
    }
    let mut found: Vec<PathBuf> = Vec::new();
    for root in [r"C:\Program Files (x86)\Microsoft Visual Studio", r"C:\Program Files\Microsoft Visual Studio"] {
        let Ok(versions) = std::fs::read_dir(root) else { continue };
        for version in versions.flatten() {
            let Ok(editions) = std::fs::read_dir(version.path()) else { continue };
            for edition in editions.flatten() {
                let Ok(redists) = std::fs::read_dir(edition.path().join(r"VC\Redist\MSVC")) else { continue };
                found.extend(redists.flatten().map(|r| r.path().join("x64")).filter(|p| p.is_dir()));
            }
        }
    }
    found.sort();
    found.pop()
}

fn find_dll(x64: &Path, kind: &str, name: &str) -> Option<PathBuf> {
    // Las carpetas se llaman Microsoft.VC143.CRT, Microsoft.VC145.OpenMP, etc.
    std::fs::read_dir(x64)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("Microsoft.VC") && n.ends_with(kind)))
        .map(|p| p.join(name))
        .find(|p| p.is_file())
}

fn copy_vc_runtime() {
    let out = Path::new("vcrt");
    if VC_RUNTIME.iter().all(|(_, name)| out.join(name).is_file()) {
        return;
    }
    let x64 = redist_dir().expect("No encuentro el runtime redistribuible de Visual C++ (instala las Build Tools de C++).");
    std::fs::create_dir_all(out).expect("crear vcrt/");
    for (kind, name) in VC_RUNTIME {
        let source = find_dll(&x64, kind, name).unwrap_or_else(|| panic!("Falta {name} en {}", x64.display()));
        std::fs::copy(&source, out.join(name)).expect("copiar runtime de Visual C++");
    }
}

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        copy_vc_runtime();
    }
    tauri_build::build()
}
