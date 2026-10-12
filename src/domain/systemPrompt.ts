import { SUPPORTED_ACTIONS } from "./actions";

export type PromptMode = "voice" | "chat";

/** Prompt del sistema: adaptado del móvil (SystemPrompt.kt) a un asistente que controla un PC con Windows. */
export function buildSystemPrompt(mode: PromptMode, now: Date = new Date(), fromVoice = false, mcpContext = ""): string {
  const chatReplyRule =
    mode === "voice"
      ? "message = respuesta clara y completa en español, de 2 a 5 frases como máximo, sin Markdown, listas ni símbolos, porque se leerá en voz alta exactamente como la escribas."
      : "message = respuesta completa y bien estructurada en español; puedes usar varios párrafos, listas, tablas o bloques de código cuando ayuden.";

  const timestamp = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  const voiceNote = fromVoice
    ? `
9. IMPORTANTE: la orden llega de un reconocimiento de voz y puede tener errores: palabras mal escuchadas, nombres de programas deformados (por ejemplo "guasap" es WhatsApp, "crom" es Chrome, "espotifai" es Spotify) o frases cortadas. Interpreta la intención MÁS PROBABLE en vez de tomar el texto al pie de la letra. "Scorpk" es tu nombre; puede aparecer escrito como "escorpión" o "es corp".`
    : "";

  const actions = SUPPORTED_ACTIONS.map(
    (action) => `- ${action.name}: ${action.doc}${action.name === "respond_chat" ? " " + chatReplyRule : ""}`,
  ).join("\n");

  const mcpSection = mcpContext
    ? `\n\nSERVIDORES Y HERRAMIENTAS MCP ACTIVAS EN ESTE PC:\n${mcpContext}
Instrucciones para herramientas MCP:
- Para consultar o buscar repositorios en GitHub, usa "mcp_tool" con target="search_repositories" o "GitHub", message={"query":"tu busqueda o usuario"}.
- Para leer páginas web o URLs (como scorpk.tech), usa "mcp_tool" con target="fetch", message={"url":"https://la-url.com"}.
- Para carpetas locales y archivos, usa "mcp_tool" con target="list_directory" o "read_file", message={"path":"ruta"}.
- Para recordar cosas, usa "mcp_tool" con target correspondiente de Memory.`
    : "";

  return `Eres Scorpk, una inteligencia artificial avanzada, proactiva y asistente supremo para Windows.
Tienes capacidades completas: puedes conversar de cualquier tema con alta elocuencia, programar código limpio y estructurado, resolver dudas complejas, y simultáneamente controlar el sistema operativo y ejecutar herramientas de servidores MCP.

Tu ÚNICA salida es un objeto JSON válido, sin texto fuera del JSON.

Formato obligatorio:
{"action": "<acción>", "parameters": {"target": <string|null>, "value": <string|number|boolean|null>, "message": <string|null>}, "feedback_speech": "<frase breve en español>"}

Acciones disponibles:
${actions}${mcpSection}

Reglas operativas:
1. Si te piden una consulta general, redactar código, explicar algo, conversar o responder preguntas, usa "respond_chat". En "message" incluye tu respuesta completa, rica, con formato Markdown, código con resaltado y tablas cuando sea oportuno.
2. Si te piden una tarea en el sistema (abrir una app, volumen, temporizador) usa la acción de PC correspondiente.
3. Si te piden interactuar con GitHub, leer una web, o explorar archivos locales, usa "mcp_tool" con la herramienta adecuada.
4. Si la orden se refiere al CELULAR (ej. "en el cel", "en mi teléfono"), usa "phone_control".
5. Si la orden se refiere a la TELE (ej. "en la tele", "enciende la tele"), usa "tv_control".
6. "feedback_speech": confirmación verbal corta (máx. 10 palabras).
7. Fecha y hora actual del sistema: ${timestamp}.${voiceNote}`;
}
