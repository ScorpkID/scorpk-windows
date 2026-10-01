import type { ActionRequest } from "./model";
import { NativeUnavailableError, type BatteryInfo, type NativeBridge } from "./nativeBridge";
import { formatDuration, type TimerService } from "./timerService";

export interface DispatchResult {
  ok: boolean;
  /** "app_not_found": no hay ninguna app con ese nombre (el procesador puede pedirle ayuda a la IA). */
  code?: "app_not_found";
  /** Texto para mostrar al usuario en el chat. */
  text: string;
  /** Texto para leer en voz alta. */
  speech: string;
}

export interface DispatcherDeps {
  native: NativeBridge;
  timers: TimerService;
  /** Abre la URL en el navegador del sistema; false si no se pudo. */
  openUrl: (url: string) => Promise<boolean>;
}

const VOLUME_VALUES = new Set(["up", "down", "mute", "unmute", "max"]);
const MEDIA_VALUES = new Set(["play_pause", "play", "pause", "next", "previous", "stop"]);

const MEDIA_SPEECH: Record<string, string> = {
  play_pause: "Listo",
  play: "Reproduciendo",
  pause: "En pausa",
  next: "Siguiente",
  previous: "Anterior",
  stop: "Detenido",
};

const fail = (text: string): DispatchResult => ({ ok: false, text, speech: text });
const done = (text: string, speech = text): DispatchResult => ({ ok: true, text, speech });

/**
 * Despachador: valida la acción contra una lista blanca (con sus parámetros) y la ejecuta.
 * Nunca construye comandos de shell con texto del usuario o del modelo: los programas se resuelven
 * en Rust y las URL se arman aquí con encodeURIComponent.
 */
export class ActionDispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  async dispatch(request: ActionRequest): Promise<DispatchResult> {
    try {
      switch (request.action) {
        case "open_app":
          return await this.openApp(request);
        case "volume_control":
          return await this.volume(request);
        case "media_control":
          return await this.media(request);
        case "set_timer":
          return this.timer(request);
        case "battery_status":
          return await this.battery();
        case "navigate":
          return await this.openWeb(
            request.parameters.target,
            (q) => `https://www.google.com/maps/dir/?api=1&destination=${q}`,
            "¿A dónde quieres ir?",
            request.feedback_speech || "Abriendo la ruta",
          );
        case "youtube_search":
          return await this.openWeb(
            request.parameters.target,
            (q) => `https://www.youtube.com/results?search_query=${q}`,
            "¿Qué quieres buscar en YouTube?",
            request.feedback_speech || "Buscando en YouTube",
          );
        case "compose_email":
          return await this.composeEmail(request);
        default:
          return fail("Eso todavía no lo puedo hacer en Windows.");
      }
    } catch (error) {
      if (error instanceof NativeUnavailableError) return fail(error.message);
      const detail = typeof error === "string" ? error : error instanceof Error ? error.message : "";
      const result = fail(detail || "No pude completar la acción.");
      if (request.action === "open_app" && detail.startsWith("No encontré")) result.code = "app_not_found";
      return result;
    }
  }

  /** Nombres de los programas instalados (para que la IA elija el que el usuario quiso decir). */
  async listApps(): Promise<string[]> {
    return this.deps.native.invoke<string[]>("list_apps");
  }

  private async openApp(request: ActionRequest): Promise<DispatchResult> {
    const target = request.parameters.target?.trim();
    if (!target) return fail("¿Qué programa quieres que abra?");
    const opened = await this.deps.native.invoke<string>("open_app", { name: target });
    return done(`Listo, abrí ${opened}.`, request.feedback_speech || `Abriendo ${opened}`);
  }

  private async volume(request: ActionRequest): Promise<DispatchResult> {
    const raw = request.parameters.value;
    if (typeof raw === "number" || (typeof raw === "string" && /^\d{1,3}$/.test(raw))) {
      const percent = Math.min(100, Math.max(0, Number(raw)));
      await this.deps.native.invoke("set_volume", { percent });
      return done(`Volumen al ${percent}%.`);
    }
    if (typeof raw !== "string" || !VOLUME_VALUES.has(raw)) return fail("No entendí qué hacer con el volumen.");
    await this.deps.native.invoke("volume_key", { action: raw });
    const texts: Record<string, string> = {
      up: "Subí el volumen.",
      down: "Bajé el volumen.",
      mute: "Listo, silenciado.",
      unmute: "Sonido activado.",
      max: "Volumen al máximo.",
    };
    return done(texts[raw]);
  }

  private async media(request: ActionRequest): Promise<DispatchResult> {
    const value = request.parameters.value;
    if (typeof value !== "string" || !MEDIA_VALUES.has(value)) return fail("No entendí qué hacer con la música.");
    await this.deps.native.invoke("media_key", { action: value });
    return done(`${MEDIA_SPEECH[value]}.`);
  }

  private timer(request: ActionRequest): DispatchResult {
    const raw = request.parameters.value;
    const seconds = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 24 * 3600) {
      return fail("No entendí la duración del temporizador.");
    }
    const label = request.parameters.message?.trim() || null;
    const readable = this.deps.timers.start(Math.round(seconds), label);
    return done(`Listo, te aviso en ${readable}.`, `Temporizador de ${formatDuration(Math.round(seconds))}`);
  }

  private async battery(): Promise<DispatchResult> {
    const info = await this.deps.native.invoke<BatteryInfo>("battery_status");
    if (!info.hasBattery || info.percent === null) return done("Este equipo no tiene batería (está conectado a la corriente).");
    const state = info.charging ? "y se está cargando" : "sin cargador";
    return done(`La batería está al ${info.percent}% ${state}.`);
  }

  private async openWeb(
    target: string | null | undefined,
    build: (encoded: string) => string,
    missing: string,
    speech: string,
  ): Promise<DispatchResult> {
    const query = target?.trim();
    if (!query) return fail(missing);
    const opened = await this.deps.openUrl(build(encodeURIComponent(query.slice(0, 200))));
    return opened ? done(`${speech}.`, speech) : fail("No pude abrir el navegador.");
  }

  private async composeEmail(request: ActionRequest): Promise<DispatchResult> {
    const { target, value, message } = request.parameters;
    const to = target?.trim() ?? "";
    // Solo una dirección de correo simple: evita inyectar cabeceras (Bcc, etc.) por el destinatario.
    if (to && !/^[^\s@,;?&=]+@[^\s@,;?&=]+\.[^\s@,;?&=]+$/.test(to)) {
      return fail("Necesito el correo completo del destinatario.");
    }
    const params = new URLSearchParams();
    if (typeof value === "string" && value.trim()) params.set("subject", value.trim().slice(0, 200));
    if (message?.trim()) params.set("body", message.trim().slice(0, 2000));
    const query = params.toString().replace(/\+/g, "%20");
    const opened = await this.deps.openUrl(`mailto:${encodeURIComponent(to)}${query ? `?${query}` : ""}`);
    return opened
      ? done("Abrí el borrador del correo.", request.feedback_speech || "Abriendo el correo")
      : fail("No pude abrir el programa de correo.");
  }
}
