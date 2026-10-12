/**
 * Registro de acciones que esta versión sabe ejecutar. El prompt de la IA se construye SOLO con
 * estas, para que el modelo no invente acciones que todavía no existen. Cada fase añade entradas
 * aquí (y su ejecución en ActionDispatcher).
 */
export interface SupportedAction {
  name: string;
  /** Descripción para el prompt del sistema. */
  doc: string;
}

export const SUPPORTED_ACTIONS: SupportedAction[] = [
  {
    name: "open_app",
    doc: 'abrir un programa del PC. target = nombre del programa tal como lo dijo el usuario (ej. "Chrome", "Spotify", "Calculadora").',
  },
  {
    name: "media_control",
    doc: 'value = "play_pause" | "play" | "pause" | "next" | "previous" | "stop". Controla la música o el video que suena en el PC.',
  },
  {
    name: "volume_control",
    doc: 'value = "up" | "down" | "mute" | "unmute" | "max" | número entero 0-100 (porcentaje).',
  },
  {
    name: "set_timer",
    doc: "value = duración total en segundos (entero); message = etiqueta o null.",
  },
  {
    name: "battery_status",
    doc: "consultar la batería del equipo. Sin parámetros.",
  },
  {
    name: "navigate",
    doc: "abrir Google Maps con una ruta. target = lugar o dirección.",
  },
  {
    name: "youtube_search",
    doc: "buscar en YouTube. target = qué buscar.",
  },
  {
    name: "compose_email",
    doc: "redactar un correo en el programa de correo. target = destinatario (correo) o null; value = asunto; message = cuerpo.",
  },
  {
    name: "tv_control",
    doc: 'controlar un televisor Samsung conectado a la red local. target = "power" | "volume" | "app" | "search" | "input" | "media" | "key". Según target: power → value = "on" | "off"; volume → value = "up" | "down" | "mute" | "unmute"; app → value = nombre de la app ("netflix", "youtube", "spotify", "prime_video", "disney", "apple_tv", "browser", "hbo", "twitch", "plex"), si el usuario además pide buscar o poner algo específico incluye message = qué buscar (ej. "faded", "lofi"); search → value = término de búsqueda a escribir en la app de video activa en la tele; input → value = "hdmi1" | "hdmi2" | "hdmi3" | "hdmi4" | "tv"; media → value = "play" | "pause" | "stop" | "next" | "previous"; key → value = "home" | "back" | "menu" | "up" | "down" | "left" | "right" | "enter". Palabras clave del usuario: "tele", "televisor", "tv", "Samsung".',
  },
  {
    name: "phone_control",
    doc: 'controlar o ejecutar tareas en el celular Android conectado (vía ADB/ARTEMIS). target = "task" | "app". value = la orden completa en lenguaje natural tal como la pide el usuario (ej. "abre whatsapp y envía un mensaje a mamá", "pide un Uber a mi casa", "abre Instagram", "toma una foto"). Úsalo SIEMPRE que el usuario mencione "celular", "teléfono", "móvil", "cel", o pida interactuar con una app de su celular.',
  },
  {
    name: "mcp_tool",
    doc: 'ejecutar una herramienta de un servidor MCP conectado (ej. filesystem, github, postgres). target = nombre de la herramienta (ej. "list_directory", "read_file", "write_file", etc.); message = JSON o parámetros para la herramienta (ej. ruta de carpeta o archivo). Úsalo cuando el usuario pida listar archivos, leer archivos, consultar bases de datos o usar herramientas de servidores MCP externos.',
  },
  {
    name: "respond_chat",
    doc: "preguntas, saludos, análisis de archivos o cualquier cosa que no requiera una acción en el PC. message = la respuesta.",
  },
];

export function isSupportedAction(name: string): boolean {
  return SUPPORTED_ACTIONS.some((action) => action.name === name);
}
