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

// ─── Control de TV Samsung ──────────────────────────────────────────────────

/** Detecta si la frase contiene una referencia al televisor. */
const TV_RE = /\b(tele|televisor|tv|samsung|tivi)\b/;

const TV_APPS: Record<string, string> = {
  netflix: "netflix", nefli: "netflix", neflis: "netflix",
  youtube: "youtube", yutub: "youtube",
  spotify: "spotify", espotifai: "spotify", espotify: "spotify",
  "prime video": "prime_video", "amazon prime": "prime_video", prime: "prime_video",
  disney: "disney", "disney plus": "disney_plus", "disney+": "disney_plus",
  "apple tv": "apple_tv",
  hbo: "hbo", "hbo max": "hbo_max",
  plex: "plex",
  twitch: "twitch",
  deezer: "deezer",
  navegador: "browser", browser: "browser",
  crunchyroll: "crunchyroll",
  tidal: "tidal",
  movistar: "movistar",
};

function parseTv(text: string): ActionRequest | null {
  if (!TV_RE.test(text)) return null;

  // ─ Power ──────────────────────────────────────────────────────────────
  if (/\b(enciende|encender|prende|prender|activa|activar)\b/.test(text)) {
    return act("tv_control", { target: "power", value: "on" }, "Encendiendo la tele");
  }
  if (/\b(apaga|apagar|desactiva|desactivar)\b/.test(text)) {
    return act("tv_control", { target: "power", value: "off" }, "Apagando la tele");
  }

  // ─ Volumen ────────────────────────────────────────────────────────────
  if (/\b(silencia|silenciar|mutea|mutear|quita el sonido)\b/.test(text)) {
    return act("tv_control", { target: "volume", value: "mute" }, "Tele silenciada");
  }
  if (/\b(activa|quita|restablece) el (sonido|silencio)\b|\bdesilencia\b|\bdesmutea\b/.test(text)) {
    return act("tv_control", { target: "volume", value: "unmute" }, "Sonido de la tele activado");
  }
  if (/\b(sube|subir|aumenta|aumentar|mas)\b.*\b(volumen|sonido)\b/.test(text)) {
    return act("tv_control", { target: "volume", value: "up" }, "Volumen de la tele arriba");
  }
  if (/\b(baja|bajar|disminuye|reduce|menos)\b.*\b(volumen|sonido)\b/.test(text)) {
    return act("tv_control", { target: "volume", value: "down" }, "Volumen de la tele abajo");
  }

  // ─ Apps y Búsqueda en la TV ─────────────────────────────────────────
  // Si pide buscar o poner algo específico en la TV (ej. "pon faded en youtube en la tele", "busca lofi en youtube en la tele", "busca musica en la tele")
  const searchMatch = text.match(/\b(?:busca|buscar|pon|poner|reproduce|reproducir)\s+(.+?)\s+(?:en|de)\s+(youtube|netflix|spotify)\b/)
    ?? text.match(/\b(?:en|de)\s+(youtube|netflix|spotify)\s+(?:busca|pon|reproduce)\s+(.+)\b/);
  if (searchMatch) {
    const isFirstApp = TV_APPS[searchMatch[1]] !== undefined;
    const appName = isFirstApp ? searchMatch[1] : searchMatch[2];
    const query = isFirstApp ? searchMatch[2] : searchMatch[1];
    const appValue = TV_APPS[appName] ?? "youtube";
    const cleanQuery = query.replace(/\b(en la tele|en el televisor|en la tv|en tv)\b/g, "").trim();
    return act(
      "tv_control",
      { target: "app", value: appValue, message: cleanQuery },
      `Buscando «${cleanQuery}» en ${appName} en la tele`
    );
  }

  // Búsqueda genérica en la TV ("busca videos de gatitos en la tele")
  const genericSearch = text.match(/\b(?:busca|buscar)\s+(.+?)(?:\s+(?:en la tele|en el televisor|en la tv|en tv))?$/);
  if (genericSearch && !/\b(en google|en internet|en youtube|en netflix)\b/.test(text)) {
    const cleanQuery = genericSearch[1].replace(/\b(en la tele|en el televisor|en la tv|en tv)\b/g, "").trim();
    if (cleanQuery) {
      return act(
        "tv_control",
        { target: "search", value: cleanQuery },
        `Buscando «${cleanQuery}» en la tele`
      );
    }
  }

  // Apertura directa de apps en la TV
  for (const [keyword, appValue] of Object.entries(TV_APPS)) {
    if (text.includes(keyword)) {
      return act("tv_control", { target: "app", value: appValue }, `Abriendo ${keyword} en la tele`);
    }
  }

  // ─ Entradas (HDMI) ────────────────────────────────────────────────────
  const hdmiMatch = text.match(/\bhdmi\s*(\d)\b/);
  if (hdmiMatch) {
    return act("tv_control", { target: "input", value: `hdmi${hdmiMatch[1]}` }, `Cambiando a HDMI ${hdmiMatch[1]}`);
  }
  if (/\b(cambia|cambiar|pon|poner)\b.*\b(entrada|fuente|source)\b/.test(text)) {
    return act("tv_control", { target: "input", value: "hdmi1" }, "Cambiando entrada de la tele");
  }

  // ─ Reproducción multimedia ────────────────────────────────────────────
  if (/\b(pausa|pausar|pon pausa|deten|detener)\b/.test(text)) {
    return act("tv_control", { target: "media", value: "pause" }, "Tele en pausa");
  }
  if (/\b(reproduce|reproducir|continua|reanuda|reanudar|dale play|play|dale)\b/.test(text)) {
    return act("tv_control", { target: "media", value: "play" }, "Reproduciendo en la tele");
  }
  if (/\b(siguiente|proxima|salta|saltar)\b/.test(text)) {
    return act("tv_control", { target: "media", value: "next" }, "Siguiente en la tele");
  }
  if (/\b(anterior|previa|regresa|vuelve)\b/.test(text)) {
    return act("tv_control", { target: "media", value: "previous" }, "Anterior en la tele");
  }

  // ─ Navegación ─────────────────────────────────────────────────────────
  if (/\b(menu|inicio|home)\b/.test(text)) {
    return act("tv_control", { target: "key", value: "home" }, "Inicio de la tele");
  }
  if (/\b(atras|volver|regresa)\b/.test(text)) {
    return act("tv_control", { target: "key", value: "back" }, "Atrás en la tele");
  }

  return null;
}

// ─── Control de Celular / Teléfono (ARTEMIS / ADB) ─────────────────────────

const PHONE_RE = /\b(celular|cel|telefono|movil|smartphone)\b/;

function parsePhone(text: string, rawInput: string): ActionRequest | null {
  // Coincide si menciona celular/cel/teléfono O si pide WhatsApp explícitamente (WhatsApp vive en el celular)
  if (!PHONE_RE.test(text) && !/\bwhatsapp\b/.test(text)) return null;

  // Si pide una acción en el celular, pasar la orden con el texto original (preservando mayúsculas, nombres y signos)
  return act("phone_control", { target: "task", value: rawInput.trim() }, "Enviando orden a tu celular");
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
    parsePhone(text, input) ??
    parseTv(text) ??
    parseTimer(text) ??
    parseVolume(text) ??
    parseBattery(text) ??
    parseMedia(text) ??
    parseWeb(text) ??
    parseOpen(text)
  );
}
