import type { ActionRequest } from "./model";

/**
 * Intérprete local por reglas (modo Free, sin IA ni red). Entiende las órdenes más comunes en
 * español y devuelve el mismo contrato JSON que la IA. Devuelve null si no reconoce la orden.
 */

const act = (
  action: string,
  params: { target?: string | null; value?: string | number | boolean | null; message?: string | null },
  speech: string,
): ActionRequest => ({
  action,
  parameters: { target: params.target ?? null, value: params.value ?? null, message: params.message ?? null },
  feedback_speech: speech,
});

/** Minúsculas, sin tildes, sin signos y con espacios simples. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quita el tratamiento inicial ("oye scorpk", "por favor", "scorpk"...) de una orden. */
function stripCourtesy(text: string): string {
  return text
    .replace(/^(oye|hey|hola)\s+scorpk\s*/, "")
    .replace(/^scorpk\s*/, "")
    .replace(/^(por favor|porfa|puedes|podrias|me puedes|me podrias)\s+/, "")
    .replace(/\s+(por favor|porfa)$/, "")
    .trim();
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  quince: 15, veinte: 20, treinta: 30, cuarenta: 40, "cuarenta y cinco": 45, cincuenta: 50, sesenta: 60,
  media: 0.5, medio: 0.5,
};

function parseAmount(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+([.,]\d+)?$/.test(trimmed)) return Number(trimmed.replace(",", "."));
  return NUMBER_WORDS[trimmed] ?? null;
}

const UNIT_SECONDS: Record<string, number> = {
  segundo: 1, segundos: 1, seg: 1, s: 1,
  minuto: 60, minutos: 60, min: 60, m: 60,
  hora: 3600, horas: 3600, h: 3600,
};

function parseTimer(text: string): ActionRequest | null {
  if (!/^(pon(er|me)?|crea|inicia|activa|programa)?\s*(un |el )?(temporizador|timer|cuenta regresiva)\b/.test(text)) return null;
  // "temporizador de 10 minutos", "temporizador de media hora", "timer 30 segundos"
  const match = text.match(/(?:de |por |para )?(\d+(?:[.,]\d+)?|cuarenta y cinco|[a-z]+)\s*(segundos?|seg|minutos?|min|horas?)\b/);
  if (!match) return null;
  const amount = parseAmount(match[1]);
  const unit = UNIT_SECONDS[match[2]];
  if (amount === null || !unit) return null;
  const seconds = Math.round(amount * unit);
  if (seconds <= 0) return null;
  return act("set_timer", { value: seconds }, "Temporizador iniciado");
}

function parseVolume(text: string): ActionRequest | null {
  if (/\b(silencia|silenciar|mutea|mutear|quita el sonido)\b/.test(text)) {
    return act("volume_control", { value: "mute" }, "Listo, silenciado");
  }
  if (/\b(activa|quita|restablece) el (sonido|silencio)\b|\bdesilencia\b|\bdesmutea\b/.test(text)) {
    return act("volume_control", { value: "unmute" }, "Sonido activado");
  }
  const percent = text.match(/\bvolumen\b.*?\b(\d{1,3})\s*(?:%|por ciento)?/) ?? text.match(/\b(?:al|a)\s+(\d{1,3})\s*(?:%|por ciento)\b/);
  if (percent && /\bvolumen\b|\bsonido\b/.test(text)) {
    const value = Math.min(100, Number(percent[1]));
    return act("volume_control", { value }, `Volumen al ${value}%`);
  }
  if (/\bvolumen\b.*\b(maximo|al maximo|al tope)\b|\b(maximo|al maximo) (el )?volumen\b/.test(text)) {
    return act("volume_control", { value: "max" }, "Volumen al máximo");
  }
  if (/\b(sube|subir|aumenta|aumentar|mas)\b.*\b(volumen|sonido)\b|\bmas (alto|fuerte)\b/.test(text)) {
    return act("volume_control", { value: "up" }, "Volumen arriba");
  }
  if (/\b(baja|bajar|disminuye|reduce|menos)\b.*\b(volumen|sonido)\b|\bmas (bajo|suave)\b/.test(text)) {
    return act("volume_control", { value: "down" }, "Volumen abajo");
  }
  return null;
}

function parseMedia(text: string): ActionRequest | null {
  if (/\b(siguiente|proxima|salta|saltar|pasa la|pasar la)\b/.test(text)) {
    return act("media_control", { value: "next" }, "Siguiente");
  }
  if (/\b(anterior|previa|regresa|vuelve)\b.*\b(cancion|tema|pista)\b|^(cancion |tema )?anterior$/.test(text)) {
    return act("media_control", { value: "previous" }, "Anterior");
  }
  if (/^(pausa|pausar|pon pausa|deten|detener|para)( la)?( musica| cancion| video| reproduccion)?$/.test(text)) {
    return act("media_control", { value: "pause" }, "En pausa");
  }
  if (/^(reproduce|reproducir|continua|reanuda|reanudar|dale play|play|dale)( la)?( musica| cancion| video| reproduccion)?$/.test(text)) {
    return act("media_control", { value: "play" }, "Reproduciendo");
  }
  return null;
}

function parseBattery(text: string): ActionRequest | null {
  if (/\b(bateria|carga)\b/.test(text) && /\b(cuanta|cuanto|como|que|nivel|estado|tengo|queda|esta)\b/.test(text)) {
    return act("battery_status", {}, "Revisando la batería");
  }
  return null;
}

function parseWeb(text: string): ActionRequest | null {
  const youtube = text.match(/^(?:busca|buscar|pon|reproduce)\s+(.+?)\s+en\s+youtube$/) ?? text.match(/^youtube\s+(.+)$/);
  if (youtube) return act("youtube_search", { target: youtube[1] }, "Buscando en YouTube");

  const route = text.match(/^(?:llevame|ruta|navega|navegar|como llego|indicaciones)\s+(?:(?:a|al|hasta|para)\s+)?(.+)$/);
  if (route && route[1]) return act("navigate", { target: route[1] }, "Abriendo la ruta");
  return null;
}

function parseOpen(text: string): ActionRequest | null {
  const match = text.match(/^(?:abre|abrir|abreme|lanza|lanzar|inicia|iniciar|ejecuta|ejecutar|arranca)\s+(?:la |el |los |las |mi )?(?:aplicacion |app |programa )?(?:de )?(.+)$/);
  if (!match) return null;
  const target = match[1].trim();
  if (!target || target.length > 60) return null;
  return act("open_app", { target }, `Abriendo ${target}`);
}

/** Devuelve la acción que corresponde a la orden, o null si las reglas no la entienden. */
export function interpretLocally(input: string): ActionRequest | null {
  const text = stripCourtesy(normalize(input));
  if (!text) return null;
  return (
    parseTimer(text) ??
    parseVolume(text) ??
    parseBattery(text) ??
    parseMedia(text) ??
    parseWeb(text) ??
    parseOpen(text)
  );
}
