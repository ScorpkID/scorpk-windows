//! Llamada al proxy de IA (`https://scorpk.tech/api/ai/chat`) desde Rust.
//!
//! La ventana de la app (WebView) no puede llamar al proxy directamente: el servidor no envía
//! cabeceras CORS y el navegador bloquea la petición ("No pude conectarme"). Rust no tiene esa
//! restricción. El destino está fijo aquí: el frontend solo aporta el token de sesión y el cuerpo,
//! así que este comando no sirve para llamar a otros sitios.

use serde::Serialize;
use std::time::Duration;

const PROXY_URL: &str = "https://scorpk.tech/api/ai/chat";
/// Igual que el servidor (MAX_BODY_CHARS): las imágenes en base64 pueden ser grandes.
const MAX_BODY_BYTES: usize = 8_000_000;
const TIMEOUT: Duration = Duration::from_secs(75);

#[derive(Serialize, Debug)]
pub struct AiResponse {
    pub status: u16,
    pub body: String,
}

/// El token solo puede contener caracteres de un JWT: evita inyectar cabeceras.
fn valid_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() < 8192
        && token.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '=' | '+' | '/'))
}

fn post(token: &str, body: &str) -> Result<AiResponse, String> {
    if !valid_token(token) {
        return Err("Sesión inválida.".into());
    }
    if body.len() > MAX_BODY_BYTES {
        return Err("La petición es demasiado grande.".into());
    }
    let result = ureq::post(PROXY_URL)
        .timeout(TIMEOUT)
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .set("Accept", "application/json")
        .send_string(body);

    match result {
        Ok(response) => {
            let status = response.status();
            Ok(AiResponse { status, body: response.into_string().map_err(|_| "network".to_string())? })
        }
        // Una respuesta HTTP de error (401, 402, 429...) NO es un fallo de red: se devuelve para interpretarla.
        Err(ureq::Error::Status(status, response)) => {
            Ok(AiResponse { status, body: response.into_string().unwrap_or_default() })
        }
        Err(_) => Err("network".into()),
    }
}

#[tauri::command]
pub async fn ai_chat(token: String, body: String) -> Result<AiResponse, String> {
    tauri::async_runtime::spawn_blocking(move || post(&token, &body))
        .await
        .map_err(|_| "network".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_token_solo_admite_caracteres_de_jwt() {
        assert!(valid_token("eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl"));
        assert!(!valid_token(""));
        assert!(!valid_token("abc\r\nX-Evil: 1"));
        assert!(!valid_token("con espacio"));
    }

    #[test]
    fn rechaza_cuerpos_gigantes_y_tokens_invalidos_sin_red() {
        assert_eq!(post("a b", "{}").unwrap_err(), "Sesión inválida.");
        assert_eq!(post("abc", &"x".repeat(MAX_BODY_BYTES + 1)).unwrap_err(), "La petición es demasiado grande.");
    }

    /// Manual (usa internet): sin sesión válida el servidor responde 401, y eso debe llegar como respuesta, no como fallo de red.
    #[test]
    #[ignore]
    fn un_401_llega_como_respuesta() {
        let response = post("token-falso", "{}").expect("debería haber respuesta HTTP");
        assert_eq!(response.status, 401);
    }
}
