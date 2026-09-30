# Arquitectura Técnica — Scorpk para Windows

Referencia del móvil: `ARCHITECTURE.md` de https://github.com/ScorpkID/scorpk-assistant (el contrato JSON es el mismo).

## 1. Vista general
```text
┌────────────────────────── Tauri (un solo proceso de app) ──────────────────────────┐
│  WebView2 (React + TS)                     │  Núcleo Rust (src-tauri)              │
│  ─ Chat, Overlay, Ajustes, Conectores      │  ─ Comandos nativos (invoke)          │
│  ─ CommandProcessor / Interpreters         │  ─ Atajo global, bandeja, ventanas    │
│  ─ ActionDispatcher (lista blanca)  ──────►│  ─ Acciones de sistema (windows-rs)   │
│  ─ Supabase client, conectores REST        │  ─ Credential Manager (keyring)       │
│                                            │  ─ Wake word (Vosk) + audio           │
└────────────────────────────────────────────┴───────────────────────────────────────┘
        │ HTTPS                                        
        ▼                                              
  scorpk.tech/api/ai/chat  ──►  Fireworks AI (clave solo en el servidor)
  Supabase (Auth, profiles, tasks, user_connectors, subscriptions)
```

## 2. Estructura sugerida del repo
```text
scorpk-windows/
├── CLAUDE.md · REQUERIMIENTOS.md · ARCHITECTURE.md
├── src/                          # Frontend React + TS
│   ├── app/                      # Rutas/pantallas: chat, ajustes, conectores, cuenta, plan
│   ├── overlay/                  # Ventana overlay (segunda ventana de Tauri)
│   ├── domain/
│   │   ├── model/                # ActionRequest, ChatMessage, AiModel, ActionResult
│   │   ├── interpreter/          # SystemPrompt, LocalCommandInterpreter, AiCommandInterpreter
│   │   ├── CommandProcessor.ts   # texto → intérprete → despacho → respuesta
│   │   └── ActionDispatcher.ts   # valida (lista blanca) y llama a Rust o a conectores
│   ├── data/                     # supabase.ts, repositorios (auth, plan, conectores, historial)
│   ├── connectors/               # google/, github/, spotify/ (REST)
│   ├── voice/                    # WakeWordMatcher, STT, TTS (sanitizar Markdown/URLs)
│   ├── update/                   # UpdateGate (bloquea hasta actualizar)
│   └── ui/                       # componentes y tema oscuro
├── src-tauri/
│   ├── src/
│   │   ├── main.rs · lib.rs      # setup, bandeja, atajo global, ventanas
│   │   ├── commands/             # #[tauri::command]: open_app, volume, media, battery, ui_automation, screenshot, input
│   │   ├── wakeword.rs           # Vosk + micrófono
│   │   └── secrets.rs            # keyring (Credential Manager)
│   ├── capabilities/ · tauri.conf.json
│   └── Cargo.toml
└── scripts/                      # release, latest.json
```

## 3. Contrato JSON (idéntico al móvil)
La IA responde **solo** con:
```json
{
  "action": "open_app | media_control | volume_control | spotify_control | set_timer | set_alarm | battery_status | global_action | read_screen | click_node | gesture | calendar_query | calendar_create | drive_search | gmail_inbox | github_query | youtube_search | navigate | compose_email | whatsapp_message | call_contact | respond_chat | unknown",
  "parameters": { "target": "string", "value": "string | number | boolean", "message": "string" },
  "feedback_speech": "Texto breve que Scorpk dirá en voz alta"
}
```
Las acciones exactas están en `ActionRequest.kt` del móvil. Cambios al contrato se anotan aquí y se avisa.
`toggle_flashlight` no aplica en PC (RF-18: responder con aviso).

## 4. Flujo de una orden
1. Entrada (texto, voz tras el atajo, o wake word "Oye Scorpk") → `CommandProcessor`.
2. **Modo Pro**: `AiCommandInterpreter` → `POST /api/ai/chat` (Bearer = access token de Supabase) → JSON.
   **Modo Free / fallo**: `LocalCommandInterpreter` (reglas, sin IA).
3. `ActionDispatcher` valida la acción contra la lista blanca y sus parámetros; si es peligrosa, pide confirmación.
4. Ejecuta: comando Rust (`invoke`) para el sistema, o cliente REST para conectores.
5. Resultado → tarjeta en el chat + `feedback_speech` por TTS.

### Errores del proxy
| Código | Significado | Acción de la app |
|---|---|---|
| 401 | Sin sesión / vencida | Mostrar login |
| 402 | Requiere Pro | Pantalla de plan → `scorpk.tech/pricing` |
| 429 | Demasiadas peticiones | Esperar y avisar |
| 502 / 504 | IA caída | Usar intérprete local y avisar |

Modelos permitidos (lista blanca del servidor): `accounts/fireworks/models/gpt-oss-120b` (voz/defecto),
`deepseek-v4p1-flash`, `glm-5p3-flash` (visión), `glm-5p3`.

## 5. Acciones de PC ↔ implementación nativa
| Acción | Implementación |
|---|---|
| `open_app` | Resolver nombre → `App Paths` / Menú Inicio / `shell:AppsFolder` (UWP) y lanzar; URLs con el navegador por defecto |
| `media_control`, `spotify_control` | Teclas multimedia (`SendInput`) + GlobalSystemMediaTransportControls (WinRT) para "qué suena"; Spotify por URI `spotify:` |
| `volume_control` | Core Audio `IAudioEndpointVolume` |
| `set_timer`, `set_alarm` | Temporizador propio en la app + notificación toast |
| `battery_status` | `GetSystemPowerStatus` |
| `read_screen` | UI Automation (árbol de la ventana activa) y/o captura (Graphics Capture) → modelo de visión |
| `click_node`, `gesture` | UI Automation `InvokePattern`; alternativa `SendInput`; siempre con confirmación |
| `global_action` | Atajos del sistema (minimizar, escritorio, bloquear, capturar) |
| Conectores | REST desde el frontend con tokens leídos de Credential Manager |

## 6. Datos y cuenta
- **Login** (email, Google, GitHub): flujo de traspaso de la web, el mismo del CLI — **no requiere cambios en Supabase**.
  1. Rust (`commands/login.rs`) abre un servidor local efímero en `127.0.0.1:<puerto libre>`.
  2. Se abre `https://scorpk.tech/login?from=cli&callback=http://127.0.0.1:<puerto>/callback` en el navegador del sistema.
  3. Tras el login, la web redirige a `/callback?handoff=<código de un solo uso, 64 hex>`.
  4. Rust canjea el código en `POST /api/vscode/handoff/consume` (se hace en Rust porque esa ruta no tiene CORS) y el frontend fija la sesión con `supabase.auth.setSession`.
  Solo el código viaja por la URL (vive 120 s y se borra al primer uso). El correo+contraseña también funciona directo en la app.
- **Tablas**: `profiles`, `tasks`, `user_connectors`, `subscriptions`. El plan Pro es `plan = 'pro'` con `status ∈ {active, trialing}`.
- **Tokens** de Google/GitHub: solo en Credential Manager; en la tabla va `access_token = ""`.
- **Historial** local (SQLite vía `tauri-plugin-sql` o archivo JSON cifrado).

## 7. Interfaz
- Ventana principal (chat, conectores, ajustes, cuenta) y **ventana overlay** separada (sin bordes, transparente, `alwaysOnTop`, `skipTaskbar`).
- Overlay: aparece con el atajo/wake word; brillo en bordes mientras escucha; texto o voz; `Esc` cierra.
- Bandeja: Abrir · Escuchando on/off · Salir.
- Tema: `#000000` fondo, `#0D0D11` tarjetas, `#1C1C24` bordes, `#8E8E93` texto secundario, 20 px de esquinas.

## 8. Seguridad
- Permisos de Tauri mínimos (`capabilities`): solo los comandos propios; sin `shell`/`fs` abiertos al frontend.
- CSP estricta; el WebView solo carga recursos locales y los dominios necesarios (`scorpk.tech`, Supabase, APIs de Google/GitHub).
- El dispatcher nunca concatena texto del modelo en una línea de comandos.
- Confirmación para: borrar, instalar/desinstalar, ejecutar, enviar, simular entrada.
- Sin registro del contenido de las conversaciones.

## 9. Actualizaciones y distribución
- `tauri-plugin-updater` con `latest.json` (p. ej. `https://scorpk.tech/windows/latest.json`) y binarios en GitHub Releases `windows-vX.Y.Z`.
- **Toda versión nueva es obligatoria**: `UpdateGate` bloquea el uso hasta instalar (mismo criterio que Android).
- Instalador NSIS/MSI firmado con certificado de firma de código; la actualización se verifica con la llave pública del updater.
- Cuando esté lista, el dueño añade la pestaña de Windows en `scorpk.tech/assistant`.
