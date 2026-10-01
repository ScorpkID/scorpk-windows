# Scorpk para Windows — Guía de Desarrollo para Claude

## Descripción del Proyecto
**Scorpk Asistente para Windows** es la versión de escritorio del asistente de voz y chat Scorpk, que ya
existe en Android. Controla el PC mediante comandos de voz ("Oye Scorpk" o un atajo global) y una
interfaz de chat minimalista en modo oscuro, ejecutando acciones directas en el sistema.

Es **el mismo producto**: misma cuenta, mismo plan, mismo servidor de IA y mismo contrato JSON de acciones.
**IA = plan Pro; comandos locales y conectores = Free.**

- Este repo: `ScorpkID/scorpk-windows`
- App móvil (referencia obligatoria): **https://github.com/ScorpkID/scorpk-assistant**
- Sitio web y servidor de IA: `ScorpkID/scorpk-web` (https://scorpk.tech)

---

## PASO 0 — Estudiar primero la app móvil (obligatorio)
Antes de escribir código, clona y lee el repo de Android. Es la fuente de verdad de cómo funciona Scorpk:

```powershell
git clone https://github.com/ScorpkID/scorpk-assistant ..\scorpk-assistant-ref
```

Lee, en este orden (las rutas son del repo móvil):
1. `CLAUDE.md`, `REQUIREMENTS.md` y `ARCHITECTURE.md` — visión, reglas y contrato JSON.
2. `app/src/main/java/com/scorpk/assistant/domain/model/ActionRequest.kt` — la lista completa de acciones.
3. `.../domain/interpreter/SystemPrompt.kt` — el prompt que recibe la IA (adaptarlo a PC).
4. `.../domain/interpreter/LocalCommandInterpreter.kt` — el intérprete por reglas, sin IA (modo Free).
5. `.../domain/CommandProcessor.kt` — el flujo: texto → intérprete → acción → respuesta al usuario.
6. `.../data/remote/FireworksCommandInterpreter.kt` — cómo se llama al proxy de IA y se tratan los errores 401/402.
7. `.../voice/WakeWordMatcher.kt` — coincidencia difusa de "Oye Scorpk".
8. `.../connectors/` y `.../connectors/api/` — conectores (Drive, Gmail, GitHub, Calendar) por REST.
9. `.../ui/chat/` y `.../ui/overlay/` — el chat y la tarjeta flotante que hay que imitar.
10. `.../update/` — cómo se manejan las actualizaciones obligatorias.

**No copies Kotlin tal cual:** reimplementa la misma lógica en TypeScript/Rust. Si algo del móvil no está
claro, el código de ese repo manda; no inventes un comportamiento distinto sin avisar.

Si cambias el contrato JSON o el prompt, anótalo en `ARCHITECTURE.md` y avisa: el móvil debe seguir siendo compatible.

---

## Stack Tecnológico
- **Shell de escritorio:** Tauri 2 (Rust)
- **UI:** React + TypeScript + Vite + Tailwind (modo oscuro puro)
- **Núcleo nativo:** Rust + crate `windows` (windows-rs)
- **Cuenta/datos:** Supabase (`@supabase/supabase-js`), proyecto `mbrxjeureeerpyqqhylt`
- **IA:** proxy `POST https://scorpk.tech/api/ai/chat` (nunca Fireworks directo)
- **Voz:** Vosk (wake word offline) + Whisper local (transcripción precisa de órdenes), voces del sistema (TTS)
- **Secretos locales:** Windows Credential Manager (crate `keyring`)
- **Updates:** `tauri-plugin-updater` + GitHub Releases

Detalle y justificación en `ARCHITECTURE.md`; alcance y fases en `REQUERIMIENTOS.md`.

---

## Comandos de Terminal (PowerShell)
Requisitos: Rust (rustup), Node 20+, MSVC Build Tools, WebView2.
- **Instalar dependencias:** `npm install`
- **Desarrollo:** `npm run tauri dev`
- **Instalador:** `npm run tauri build`
- **Pruebas Rust:** `cargo test` (dentro de `src-tauri`)
- **Pruebas TS:** `npm test`
- **Tipos:** `npm run typecheck`

---

## Reglas de Codificación
1. **Sin API keys en el cliente.** Nunca pongas Fireworks, Supabase service-role, Stripe ni otras claves en el código ni en el instalador. La IA va por el proxy con `Authorization: Bearer <access_token de Supabase>`. Solo la URL y la anon key públicas de Supabase pueden ir en el cliente.
2. **Modo oscuro puro:** fondo `#000000`, tarjetas `#0D0D11`, bordes `#1C1C24`, texto secundario `#8E8E93`, esquinas 20 px, acentos discretos. Todo el texto visible en español.
3. **Function calling desacoplado:** la IA responde solo con el JSON `{action, parameters, feedback_speech}`; un despachador (`ActionDispatcher`) valida contra una lista blanca y ejecuta. Nunca ejecutes como comando de shell texto que venga del modelo.
4. **Confirmación para acciones peligrosas:** borrar archivos, instalar/desinstalar, ejecutar comandos, enviar correos o mensajes, y simular teclado/mouse.
5. **No bloquear la UI:** toda acción pesada (STT, TTS, red, UI Automation) va en tareas asíncronas o en Rust fuera del hilo de la interfaz.
6. **Tokens de Google/GitHub** solo cifrados en Credential Manager; en `user_connectors.access_token` se guarda `""`, como en Android.
7. **Sin registrar conversaciones:** no guardes ni imprimas el contenido de las órdenes del usuario en logs.
8. **No** simular teclado/mouse sobre apps bancarias ni ventanas de contraseñas, ni añadir funciones pensadas para evadir protecciones de otras apps.
9. **Secretos fuera de git:** `.env`, certificados de firma, llave del updater. Antes de cada push busca `fw_`, `eyJ`, `sk_`, `GOCSPX`.
10. **Toda actualización es obligatoria** (igual que en Android): si hay versión nueva, se instala antes de seguir usando la app.

## Estilo de trabajo
- Entrega por fases, en el orden de `REQUERIMIENTOS.md`; cada fase debe compilar y probarse antes de pasar a la siguiente.
- Commits en español, pequeños y descriptivos. Nunca subas `node_modules`, `target/` ni instaladores.
- Si falta un permiso, una URL de Supabase o un dato del dueño del proyecto, **pregunta**: no lo inventes.
