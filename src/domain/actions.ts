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
    name: "respond_chat",
    doc: "preguntas, saludos, análisis de archivos o cualquier cosa que no requiera una acción en el PC. message = la respuesta.",
  },
];

export function isSupportedAction(name: string): boolean {
  return SUPPORTED_ACTIONS.some((action) => action.name === name);
}
