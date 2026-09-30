# Requerimientos — Scorpk para Windows

## 1. Objetivo
Llevar Scorpk Asistente a Windows 10/11: un asistente de voz y chat que entiende órdenes en español,
las interpreta con IA (Pro) o con reglas locales (Free) y las ejecuta en el PC. Debe sentirse como la app
de Android: mismo diseño, misma cuenta, mismo plan.

## 2. Alcance por plan
| Función | Free | Pro |
|---|---|---|
| Comandos locales (abrir programas, volumen, multimedia, temporizador, batería) | ✅ | ✅ |
| Conectores (Google Drive/Gmail/Calendar, GitHub, Spotify) | ✅ | ✅ |
| IA conversacional y comprensión natural de órdenes | ❌ (mostrar pantalla de plan) | ✅ |
| Visión (captura de pantalla a la IA) | ❌ | ✅ |

## 3. Requerimientos funcionales
| ID | Requerimiento |
|---|---|
| RF-01 | Chat en ventana principal con burbujas, tarjetas de acción y listas, como en Android. |
| RF-02 | Invocación por **atajo global** (por defecto `Ctrl+Alt+Espacio`, configurable). |
| RF-03 | Invocación por voz **"Oye Scorpk"** (Vosk offline, coincidencia difusa ≥ 75 %), activable/desactivable desde la bandeja. |
| RF-04 | **Overlay**: tarjeta flotante sin bordes, transparente, siempre encima, con brillo en los bordes al escuchar; entrada por texto o voz; `Esc` cierra. |
| RF-05 | Login con email (en la app) y Google/GitHub (navegador + servidor local 127.0.0.1 con código de traspaso de la web; sin cambios en Supabase). |
| RF-06 | Mostrar el plan del usuario (lectura de `subscriptions`) y enviar a `scorpk.tech/pricing` para suscribirse. |
| RF-07 | Interpretar órdenes con la IA a través del proxy y ejecutarlas con el contrato JSON `{action, parameters, feedback_speech}`. |
| RF-08 | Intérprete local por reglas como respaldo y como modo Free. |
| RF-09 | Acciones de PC: `open_app`, `volume_control`, `media_control`, `spotify_control`, `set_timer`, `set_alarm`, `battery_status`, `global_action`, `navigate`, `youtube_search`, `compose_email`, `respond_chat`. |
| RF-10 | Lectura y control de ventanas: `read_screen` (UI Automation y/o captura), `click_node` y `gesture` (siempre con confirmación). |
| RF-11 | Conectores de cuenta: `drive_search`, `gmail_inbox`, `calendar_query`, `calendar_create`, `github_query`; pantalla para conectar/desconectar cada uno. |
| RF-12 | Respuesta hablada (TTS del sistema, español) de `feedback_speech`, sin Markdown ni URLs leídas en voz alta. |
| RF-13 | Selector de modelo de chat (los 4 permitidos por el proxy); la voz/overlay usa el modelo fijo. |
| RF-14 | Historial de conversaciones local. |
| RF-15 | Bandeja del sistema: Abrir, Escuchando on/off, Salir; opción "Iniciar con Windows". |
| RF-16 | Ajustes: atajo, voz, modelo, conectores, cuenta, enlaces a `/privacy` y `/terms`. |
| RF-17 | **Actualización obligatoria**: al iniciar (y cada ≥ 10 min en uso) consultar `latest.json`; si hay versión nueva, bloquear el uso hasta instalarla. |
| RF-18 | Acciones sin equivalente en PC (linterna, SMS, llamadas) responden con un aviso claro, no fallan en silencio. |

## 4. Requerimientos no funcionales
| ID | Requerimiento |
|---|---|
| RNF-01 | **Seguridad:** ninguna API key en el cliente ni en el instalador; tokens cifrados en Credential Manager. |
| RNF-02 | **Rendimiento:** overlay visible en < 300 ms tras el atajo; reposo con bajo consumo (< 150 MB RAM, CPU ~0 %). |
| RNF-03 | **Privacidad:** no se registra el contenido de las conversaciones; el audio de la wake word se procesa offline. |
| RNF-04 | **Confirmaciones:** acciones destructivas o que simulan teclado/mouse piden confirmación explícita. |
| RNF-05 | **Compatibilidad:** Windows 10 (21H2+) y 11, x64; ARM64 opcional. |
| RNF-06 | **Distribución:** instalador NSIS/MSI **firmado** con certificado de firma de código para evitar avisos de SmartScreen. |
| RNF-07 | **Idioma y diseño:** español; modo oscuro puro (`#000000` / `#0D0D11` / `#1C1C24`). |
| RNF-08 | **Robustez:** ningún error de una acción debe cerrar la app; se muestra un mensaje y se sigue. |

## 5. Dependencias externas (las gestiona el dueño del proyecto)
- Vercel: el correo de cada tester en `AI_PRO_EMAILS` para probar la IA sin suscripción.
- Google Cloud: los conectores de Google usan el mismo cliente OAuth; los permisos de Gmail/Drive siguen en verificación.
- Certificado de firma de código y llave del updater de Tauri.

## 6. Fases de entrega
1. **Base:** proyecto Tauri, login Supabase, chat con IA por el proxy, pantalla "requiere Pro".
2. **Comandos locales:** intérprete Free + `open_app`, `volume_control`, `media_control`, temporizador, batería.
3. **Overlay y voz:** atajo global, STT/TTS, "Oye Scorpk".
4. **Control de pantalla:** `read_screen`, captura, `click_node` con confirmaciones.
5. **Conectores:** Google, GitHub, Spotify.
6. **Release:** instalador firmado, autoactualización obligatoria, página de descarga en `scorpk.tech/assistant`.

## 7. Criterios de aceptación
- Compila con `npm run tauri build` y funciona en Windows 10 y 11.
- Sin secretos en el repo ni en el instalador (búsqueda de `fw_`, `eyJ`, `sk_`, `GOCSPX`).
- Usuario sin sesión → ve el login; Free → usa comandos locales; sin Pro al usar IA → ve la pantalla de plan (error 402 manejado).
- Las acciones peligrosas siempre piden confirmación.
- Una versión nueva publicada obliga a actualizar antes de usar la app.
