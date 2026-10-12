//! Descarga e instalación directa de actualizaciones para Windows sin salir al navegador.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

#[derive(Serialize, Clone, Debug)]
pub struct InstallResult {
    pub ok: bool,
    pub message: String,
}

#[tauri::command]
pub async fn download_and_install_update(
    app: tauri::AppHandle,
    download_url: String,
    expected_sha256: String,
) -> Result<InstallResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let temp_dir = std::env::temp_dir();
        let installer_path = temp_dir.join("scorpk_update_setup.exe");

        // 1. Descargar archivo
        let resp = ureq::get(&download_url)
            .timeout(std::time::Duration::from_secs(300))
            .call()
            .map_err(|e| format!("Error al descargar actualización: {e}"))?;

        let mut reader = resp.into_reader();
        let mut file = File::create(&installer_path)
            .map_err(|e| format!("Error creando archivo temporal: {e}"))?;

        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];
        loop {
            let bytes_read = reader
                .read(&mut buffer)
                .map_err(|e| format!("Error leyendo datos: {e}"))?;
            if bytes_read == 0 {
                break;
            }
            file.write_all(&buffer[..bytes_read])
                .map_err(|e| format!("Error escribiendo archivo: {e}"))?;
            hasher.update(&buffer[..bytes_read]);
        }

        // 2. Verificar hash SHA-256
        let calculated_hash = format!("{:x}", hasher.finalize());
        if !calculated_hash.eq_ignore_ascii_case(&expected_sha256) {
            let _ = std::fs::remove_file(&installer_path);
            return Err("El archivo descargado no coincide con el hash oficial de seguridad.".into());
        }

        // 3. Ejecutar instalador silenciosamente y cerrar la app actual para permitir el reemplazo
        Command::new(&installer_path)
            .spawn()
            .map_err(|e| format!("Error iniciando instalador: {e}"))?;

        // Salir de la app para que el instalador de NSIS pueda actualizar los binarios
        std::process::exit(0);
    })
    .await
    .map_err(|e| format!("Fallo en tarea: {e}"))?
}
