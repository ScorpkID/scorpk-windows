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
    name: "respond_chat",
    doc: "preguntas, saludos, análisis de archivos o cualquier cosa que no requiera una acción en el PC. message = la respuesta.",
  },
];

export function isSupportedAction(name: string): boolean {
  return SUPPORTED_ACTIONS.some((action) => action.name === name);
}
