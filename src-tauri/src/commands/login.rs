//! Login con el navegador (Google, GitHub o correo) sin tocar la configuración de Supabase.
//!
//! Es el mismo flujo que usa el CLI de Scorpk:
//! 1. La app abre un servidor local efímero en 127.0.0.1:<puerto libre>.
//! 2. Se abre `https://scorpk.tech/login?from=cli&callback=http://127.0.0.1:<puerto>/callback`.
//! 3. Tras iniciar sesión, la web redirige a ese callback con `?handoff=<código de un solo uso>`.
//! 4. El código se canjea en `/api/vscode/handoff/consume` (se hace aquí, en Rust, porque esa ruta no
//!    tiene CORS) y el frontend recibe la sesión. Nunca viajan tokens por la URL, solo el código.

use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

const LOGIN_URL: &str = "https://scorpk.tech/login";
const CONSUME_URL: &str = "https://scorpk.tech/api/vscode/handoff/consume";
const WAIT_TIMEOUT: Duration = Duration::from_secs(300);

const DONE_PAGE: &str = "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><title>Scorpk</title>\
<body style=\"margin:0;background:#000;color:#f2f2f7;font-family:Segoe UI,sans-serif;display:flex;\
align-items:center;justify-content:center;height:100vh;text-align:center\">\
<div><h1 style=\"font-weight:600\">¡Listo!</h1>\
<p style=\"color:#8e8e93\">Ya iniciaste sesión. Puedes cerrar esta pestaña y volver a Scorpk.</p></div></body></html>";

/// Receptor del código de traspaso que entregará el servidor local.
#[derive(Default)]
pub struct LoginState(Mutex<Option<mpsc::Receiver<Result<String, String>>>>);

#[derive(Serialize)]
pub struct LoginStart {
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginTokens {
    pub access_token: String,
    pub refresh_token: String,
}

/// Extrae el código de `GET /callback?handoff=<64 hex> HTTP/1.1`. Solo acepta esa forma exacta.
pub fn parse_handoff(request_line: &str) -> Option<String> {
    let target = request_line.split_whitespace().nth(1)?;
    let query = target.strip_prefix("/callback?")?;
    let code = query.split('&').find_map(|pair| pair.strip_prefix("handoff="))?;
    let valid = code.len() == 64 && code.chars().all(|c| c.is_ascii_hexdigit());
    valid.then(|| code.to_string())
}

fn handle(mut stream: TcpStream) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = [0u8; 2048];
    let read = stream.read(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf[..read]);
    let code = parse_handoff(text.lines().next()?);

    let (status, body) = if code.is_some() { ("200 OK", DONE_PAGE) } else { ("404 Not Found", "") };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    code
}

/// Atiende peticiones hasta recibir un callback válido o agotar el tiempo.
fn serve(listener: TcpListener, tx: mpsc::Sender<Result<String, String>>) {
    let _ = listener.set_nonblocking(true);
    let started = Instant::now();
    loop {
        if started.elapsed() > WAIT_TIMEOUT {
            let _ = tx.send(Err("Se agotó el tiempo para iniciar sesión. Inténtalo de nuevo.".into()));
            return;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(code) = handle(stream) {
                    let _ = tx.send(Ok(code));
                    return;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => {
                let _ = tx.send(Err("No se pudo esperar el inicio de sesión.".into()));
                return;
            }
        }
    }
}

/// Paso 1: abre el servidor local y devuelve la URL de login que el frontend debe abrir.
#[tauri::command]
pub fn login_prepare(state: State<LoginState>) -> Result<LoginStart, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "No pude preparar el inicio de sesión.".to_string())?;
    let port = listener.local_addr().map_err(|_| "No pude preparar el inicio de sesión.".to_string())?.port();
    let (tx, rx) = mpsc::channel();
    *state.0.lock().map_err(|_| "Estado interno inválido.".to_string())? = Some(rx);
    std::thread::spawn(move || serve(listener, tx));

    let callback = format!("http%3A%2F%2F127.0.0.1%3A{port}%2Fcallback");
    Ok(LoginStart { url: format!("{LOGIN_URL}?from=cli&callback={callback}") })
}

fn consume(code: &str) -> Result<LoginTokens, String> {
    let failure = || "No pude completar el inicio de sesión. Inténtalo de nuevo.".to_string();
    let response = ureq::post(CONSUME_URL)
        .timeout(Duration::from_secs(15))
        .send_json(ureq::json!({ "code": code }))
        .map_err(|_| failure())?;
    let body: serde_json::Value = response.into_json().map_err(|_| failure())?;
    let access = body.get("access_token").and_then(|v| v.as_str()).ok_or_else(failure)?;
    let refresh = body.get("refresh_token").and_then(|v| v.as_str()).ok_or_else(failure)?;
    Ok(LoginTokens { access_token: access.to_string(), refresh_token: refresh.to_string() })
}

/// Paso 2: espera el callback del navegador, canjea el código y devuelve la sesión.
#[tauri::command]
pub async fn login_wait(state: State<'_, LoginState>) -> Result<LoginTokens, String> {
    let receiver = state
        .0
        .lock()
        .map_err(|_| "Estado interno inválido.".to_string())?
        .take()
        .ok_or_else(|| "No hay un inicio de sesión en curso.".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let code = receiver.recv().map_err(|_| "Se canceló el inicio de sesión.".to_string())??;
        consume(&code)
    })
    .await
    .map_err(|_| "Falló el inicio de sesión.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const CODE: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn acepta_solo_el_callback_con_codigo_valido() {
        assert_eq!(parse_handoff(&format!("GET /callback?handoff={CODE} HTTP/1.1")), Some(CODE.to_string()));
        assert_eq!(parse_handoff(&format!("GET /callback?x=1&handoff={CODE} HTTP/1.1")), Some(CODE.to_string()));
    }

    #[test]
    fn el_servidor_local_entrega_el_codigo_y_ignora_otras_peticiones() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || serve(listener, tx));

        let request = |path: &str| {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            response
        };

        // Una petición cualquiera (p. ej. el favicon) no cierra el servidor ni produce código.
        assert!(request("/favicon.ico").starts_with("HTTP/1.1 404"));
        assert!(rx.try_recv().is_err());

        let ok = request(&format!("/callback?handoff={CODE}"));
        assert!(ok.starts_with("HTTP/1.1 200"));
        assert!(ok.contains("Ya iniciaste sesión"));
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(), Ok(CODE.to_string()));
    }

    #[test]
    fn rechaza_rutas_y_codigos_raros() {
        assert_eq!(parse_handoff("GET /favicon.ico HTTP/1.1"), None);
        assert_eq!(parse_handoff(&format!("GET /otra?handoff={CODE} HTTP/1.1")), None);
        assert_eq!(parse_handoff("GET /callback?handoff=corto HTTP/1.1"), None);
        assert_eq!(parse_handoff(&format!("GET /callback?handoff={}zz HTTP/1.1", &CODE[..62])), None);
        assert_eq!(parse_handoff(""), None);
    }
}
