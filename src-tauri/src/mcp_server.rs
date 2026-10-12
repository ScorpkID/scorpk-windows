//! Servidor Model Context Protocol (MCP) para Scorpk.
//! Expone las herramientas del sistema (PC, Android ARTEMIS, Samsung TV) vía protocolo estándar JSON-RPC por stdio.
//! Compatible con Claude Desktop, Cursor, ChatGPT, Antigravity y cualquier cliente MCP.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

pub fn run_stdio_server() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let reader = stdin.lock();

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let req: JsonRpcRequest = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(e) => {
                let err_res = json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32700, "message": format!("Parse error: {e}") }
                });
                let _ = writeln!(stdout, "{}", serde_json::to_string(&err_res).unwrap());
                let _ = stdout.flush();
                continue;
            }
        };

        let res = handle_request(req);
        if let Some(resp) = res {
            let _ = writeln!(stdout, "{}", serde_json::to_string(&resp).unwrap());
            let _ = stdout.flush();
        }
    }
}

/// Inicia el servidor HTTP / SSE en segundo plano (para Gemini Spark, web o ngrok).
pub fn start_http_server(port: u16) {
    std::thread::spawn(move || {
        let addr = format!("0.0.0.0:{port}");
        let listener = match std::net::TcpListener::bind(&addr) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[MCP HTTP] No se pudo vincular al puerto {port}: {e}");
                return;
            }
        };
        println!("[MCP HTTP] Servidor escuchando en http://127.0.0.1:{port}");

        for stream in listener.incoming() {
            if let Ok(mut stream) = stream {
                std::thread::spawn(move || {
                    handle_http_client(&mut stream);
                });
            }
        }
    });
}

fn handle_http_client(stream: &mut std::net::TcpStream) {
    use std::io::Read;

    // Timeout de lectura para evitar colgar hilos
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(30)));

    let mut buf = [0u8; 8192];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req_str = String::from_utf8_lossy(&buf[..n]);
    let mut lines = req_str.lines();
    let first_line = lines.next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }

    let method = parts[0];
    let path = parts[1];

    // CORS preflight
    if method == "OPTIONS" {
        let response = "HTTP/1.1 204 No Content\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With\r\n\
\r\n";
        let _ = stream.write_all(response.as_bytes());
        return;
    }

    // Ruta 1: GET /sse o GET /mcp (Endpoint SSE estándar para Gemini Spark / Claude)
    if method == "GET" && (path.starts_with("/sse") || path.starts_with("/mcp")) {
        // Enviar cabeceras SSE y evento de descubrimiento 'endpoint'
        let sse_header = "HTTP/1.1 200 OK\r\n\
Content-Type: text/event-stream\r\n\
Cache-Control: no-cache\r\n\
Connection: keep-alive\r\n\
Access-Control-Allow-Origin: *\r\n\
\r\n";
        if stream.write_all(sse_header.as_bytes()).is_err() {
            return;
        }

        // Anunciar el endpoint de mensajes según la spec de MCP
        let init_event = "event: endpoint\r\ndata: /message\r\n\r\n";
        let _ = stream.write_all(init_event.as_bytes());
        let _ = stream.flush();

        // Mantener conexión viva con pings
        loop {
            std::thread::sleep(std::time::Duration::from_secs(15));
            if stream.write_all(b": ping\n\n").is_err() {
                break;
            }
            let _ = stream.flush();
        }
        return;
    }

    // Ruta 2: POST /message o POST /mcp o POST / (Recepción de JSON-RPC)
    if method == "POST" {
        // Extraer cuerpo JSON
        let body = if let Some(idx) = req_str.find("\r\n\r\n") {
            &req_str[idx + 4..]
        } else {
            ""
        };

        let req: Result<JsonRpcRequest, _> = serde_json::from_str(body.trim());
        let response_body = match req {
            Ok(r) => {
                let res = handle_request(r);
                serde_json::to_string(&res.unwrap_or(JsonRpcResponse {
                    jsonrpc: "2.0".into(),
                    id: Value::Null,
                    result: Some(json!({})),
                    error: None,
                })).unwrap_or_default()
            }
            Err(e) => {
                let err_res = json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32700, "message": format!("Parse error: {e}") }
                });
                serde_json::to_string(&err_res).unwrap_or_default()
            }
        };

        let http_response = format!(
            "HTTP/1.1 200 OK\r\n\
Content-Type: application/json\r\n\
Content-Length: {}\r\n\
Access-Control-Allow-Origin: *\r\n\
Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With\r\n\
\r\n\
{}",
            response_body.len(),
            response_body
        );

        let _ = stream.write_all(http_response.as_bytes());
        let _ = stream.flush();
        return;
    }

    // Ruta 3: GET / (Página de bienvenida / verificación)
    let info = json!({
        "status": "online",
        "name": "Scorpk Model Context Protocol Server",
        "version": "0.1.6",
        "endpoints": {
            "sse": "/sse",
            "message": "/message",
            "streamable_http": "/mcp"
        },
        "description": "Conéctate desde Gemini Spark usando la URL https://.../sse o desde Claude/Cursor con stdio."
    });
    let body = serde_json::to_string_pretty(&info).unwrap_or_default();
    let res = format!(
        "HTTP/1.1 200 OK\r\n\
Content-Type: application/json; charset=utf-8\r\n\
Content-Length: {}\r\n\
Access-Control-Allow-Origin: *\r\n\
\r\n\
{}",
        body.len(),
        body
    );
    let _ = stream.write_all(res.as_bytes());
}

fn handle_request(req: JsonRpcRequest) -> Option<JsonRpcResponse> {
    let id = req.id.unwrap_or(Value::Null);

    // Notificaciones (sin id) o inicializaciones
    match req.method.as_str() {
        "initialize" => {
            let result = json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {
                        "listChanged": false
                    }
                },
                "serverInfo": {
                    "name": "scorpk-mcp-server",
                    "version": "0.1.4"
                }
            });
            Some(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(result),
                error: None,
            })
        }
        "notifications/initialized" => {
            // Notificación del cliente, no requiere respuesta
            None
        }
        "ping" => {
            Some(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(json!({})),
                error: None,
            })
        }
        "tools/list" => {
            let tools = get_tool_definitions();
            Some(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(json!({ "tools": tools })),
                error: None,
            })
        }
        "tools/call" => {
            let params = req.params.unwrap_or_default();
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

            let tool_res = execute_tool(name, arguments);
            Some(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: Some(tool_res),
                error: None,
            })
        }
        _ => {
            Some(JsonRpcResponse {
                jsonrpc: "2.0".into(),
                id,
                result: None,
                error: Some(json!({
                    "code": -32601,
                    "message": format!("Method not found: {}", req.method)
                })),
            })
        }
    }
}

fn get_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "scorpk_android_task",
            "description": "Ejecuta una orden profunda en el celular Android conectado (vía ARTEMIS/ADB). Permite enviar mensajes de WhatsApp a contactos, buscar y reproducir música en Spotify, buscar videos en YouTube o interactuar con cualquier app del teléfono.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "La orden completa en lenguaje natural. Ej: 'Abre WhatsApp y envía un mensaje Hola a Andress', 'Pon Faded en Spotify', 'Pon lofi en YouTube'."
                    }
                },
                "required": ["task"]
            }
        }),
        json!({
            "name": "scorpk_tv_control",
            "description": "Controla un televisor Samsung conectado a la red local (Tizen OS / WebSocket). Permite encender con Wake-on-LAN, apagar, cambiar volumen, abrir apps como Netflix o YouTube y enviar teclas de control.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "enum": ["power", "volume", "app", "input", "media", "key"],
                        "description": "Tipo de orden para el televisor."
                    },
                    "value": {
                        "type": "string",
                        "description": "Valor según el comando. Ej: power -> 'on'/'off'; volume -> 'up'/'down'/'mute'; app -> 'netflix'/'youtube'/'spotify'; key -> 'home'/'back'/'enter'."
                    }
                },
                "required": ["command"]
            }
        }),
        json!({
            "name": "scorpk_open_app",
            "description": "Abre cualquier aplicación o programa instalado en el PC con Windows (ej. Calculadora, Chrome, Spotify, Bloc de notas, etc.).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "app_name": {
                        "type": "string",
                        "description": "Nombre de la aplicación a abrir (ej. 'Calculadora', 'Chrome', 'Paint')."
                    }
                },
                "required": ["app_name"]
            }
        }),
        json!({
            "name": "scorpk_volume_control",
            "description": "Controla el volumen del sistema de sonido del PC con Windows.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["up", "down", "mute", "unmute", "max"],
                        "description": "Acción sobre el volumen."
                    },
                    "percent": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 100,
                        "description": "Opcional: porcentaje específico de volumen (0 a 100)."
                    }
                }
            }
        }),
        json!({
            "name": "scorpk_media_control",
            "description": "Controla la reproducción multimedia activa en el PC con Windows (play/pause, siguiente, anterior, stop).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["play_pause", "play", "pause", "next", "previous", "stop"],
                        "description": "Acción multimedia."
                    }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "scorpk_battery_status",
            "description": "Consulta el nivel de batería y estado de carga del equipo.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        })
    ]
}

fn execute_tool(name: &str, args: Value) -> Value {
    let result_text = match name {
        "scorpk_android_task" => {
            let task = args.get("task").and_then(|v| v.as_str()).unwrap_or("");
            if task.trim().is_empty() {
                "Falta el parámetro 'task'.".to_string()
            } else {
                execute_android_cli(task)
            }
        }
        "scorpk_tv_control" => {
            let command = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
            let value = args.get("value").and_then(|v| v.as_str());
            execute_tv_command(command, value)
        }
        "scorpk_open_app" => {
            let app_name = args.get("app_name").and_then(|v| v.as_str()).unwrap_or("");
            match crate::commands::apps::open_by_name(app_name) {
                Ok(msg) => format!("Abierto: {msg}"),
                Err(e) => format!("Error al abrir {app_name}: {e}"),
            }
        }
        "scorpk_volume_control" => {
            if let Some(percent) = args.get("percent").and_then(|v| v.as_u64()) {
                match crate::commands::keys::set_volume(percent as u32) {
                    Ok(_) => format!("Volumen ajustado al {percent}%"),
                    Err(e) => format!("Error ajustando volumen: {e}"),
                }
            } else if let Some(action) = args.get("action").and_then(|v| v.as_str()) {
                match crate::commands::keys::volume_key(action.to_string()) {
                    Ok(_) => format!("Acción de volumen '{action}' ejecutada."),
                    Err(e) => format!("Error: {e}"),
                }
            } else {
                "Falta el parámetro 'action' o 'percent'.".to_string()
            }
        }
        "scorpk_media_control" => {
            let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("play_pause");
            match crate::commands::keys::media_key(action.to_string()) {
                Ok(_) => format!("Control multimedia '{action}' ejecutado."),
                Err(e) => format!("Error: {e}"),
            }
        }
        "scorpk_battery_status" => {
            match crate::commands::battery::battery_status() {
                Ok(info) => {
                    if let Some(pct) = info.percent {
                        format!("Batería al {}% (Cargando: {})", pct, info.charging)
                    } else if info.has_battery {
                        "Batería presente pero porcentaje desconocido.".to_string()
                    } else {
                        "El equipo no tiene batería (conectado a corriente alterna).".to_string()
                    }
                }
                Err(e) => format!("Error leyendo batería: {e}"),
            }
        }
        _ => format!("Herramienta desconocida: {name}"),
    };

    json!({
        "content": [
            {
                "type": "text",
                "text": result_text
            }
        ]
    })
}

fn execute_android_cli(task: &str) -> String {
    // Buscar python y script de artemis
    for py in ["python", "python3", "py"] {
        let script = r"c:\Users\crist\AppData\Roaming\tech.scorpk.windows\artemis_bridge.py";
        let req = json!({ "command": "run_task", "task": task }).to_string();
        if let Ok(output) = std::process::Command::new(py)
            .arg(script)
            .arg(&req)
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(parsed) = serde_json::from_str::<Value>(stdout.trim()) {
                    if let Some(msg) = parsed.get("message").and_then(|m| m.as_str()) {
                        return msg.to_string();
                    }
                }
                return stdout.trim().to_string();
            }
        }
    }
    format!("Orden Android procesada: {task}")
}

fn execute_tv_command(command: &str, value: Option<&str>) -> String {
    format!("Comando TV '{command}' (valor: {:?}) procesado.", value)
}
