import type { ActionRequest } from "./model";
import { NativeUnavailableError, type BatteryInfo, type NativeBridge, type PhoneResult, type TvResult, type McpServerConfig } from "./nativeBridge";
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
        case "tv_control":
          return await this.tvControl(request);
        case "phone_control":
          return await this.phoneControl(request);
        case "mcp_tool":
          return await this.mcpTool(request);
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

  private async tvControl(request: ActionRequest): Promise<DispatchResult> {
    const command = request.parameters.target?.trim();
    const value = typeof request.parameters.value === "string" ? request.parameters.value.trim() : null;
    const extra = typeof request.parameters.message === "string" ? request.parameters.message.trim() : null;
    if (!command) return fail("¿Qué quieres que haga en la tele?");

    const validCommands = new Set(["power", "volume", "app", "search", "text", "input", "media", "key"]);
    if (!validCommands.has(command)) return fail(`Comando de TV no reconocido: ${command}.`);

    try {
      const result = await this.deps.native.invoke<TvResult>("tv_execute", { command, value, extra });
      if (result.ok) {
        return done(result.message ?? "Listo.", request.feedback_speech || result.message || "Listo");
      }
      return fail(result.error ?? "No pude controlar la tele.");
    } catch (error) {
      if (error instanceof NativeUnavailableError) return fail(error.message);
      const msg = typeof error === "string" ? error : error instanceof Error ? error.message : "Error desconocido.";
      return fail(msg);
    }
  }

  private async phoneControl(request: ActionRequest): Promise<DispatchResult> {
    const task = (typeof request.parameters.value === "string" && request.parameters.value.trim())
      ? request.parameters.value.trim()
      : (request.parameters.target?.trim() ?? "");

    if (!task) return fail("¿Qué quieres que haga en tu celular?");

    try {
      const result = await this.deps.native.invoke<PhoneResult>("phone_run_task", { task });
      if (result.ok) {
        return done(result.message ?? "Listo en tu celular.", request.feedback_speech || result.message || "Listo en tu celular");
      }
      return fail(result.error ?? "No pude ejecutar la orden en el celular.");
    } catch (error) {
      if (error instanceof NativeUnavailableError) return fail(error.message);
      const msg = typeof error === "string" ? error : error instanceof Error ? error.message : "Error desconocido.";
      return fail(msg);
    }
  }

  private async mcpTool(request: ActionRequest): Promise<DispatchResult> {
    const toolName = request.parameters.target?.trim();
    if (!toolName) return fail("¿Qué herramienta MCP deseas ejecutar?");

    let args: Record<string, unknown> = {};
    const rawVal = request.parameters.message || request.parameters.value;
    if (typeof rawVal === "string") {
      try {
        args = JSON.parse(rawVal);
      } catch {
        // Texto simple
        args = { query: rawVal, path: rawVal, url: rawVal };
      }
    } else if (rawVal && typeof rawVal === "object") {
      args = rawVal as Record<string, unknown>;
    }

    try {
      // 1. Obtener servidores MCP configurados
      const servers = await this.deps.native.invoke<McpServerConfig[]>("mcp_get_servers");
      const enabledServers = (servers || []).filter((s) => s.enabled);
      if (enabledServers.length === 0) {
        return fail("No tienes servidores MCP activos en la configuración.");
      }

      // 2. Normalizar nombre de herramienta y argumentos según el caso
      let actualTool = toolName;
      let targetServer: McpServerConfig | undefined;

      // GitHub
      if (
        toolName === "search_repositories" ||
        toolName === "get_file_contents" ||
        toolName === "create_or_update_file" ||
        toolName === "create_issue" ||
        toolName.toLowerCase().includes("github")
      ) {
        targetServer = enabledServers.find((s) => s.name.toLowerCase().includes("github"));
        actualTool = "search_repositories";
        if (!args.query || typeof args.query !== "string" || !args.query.trim()) {
          args.query = "user:CristianT71";
        }
      }
      // Fetch / Web Reader
      else if (toolName === "fetch" || toolName.toLowerCase().includes("fetch") || toolName.toLowerCase().includes("web")) {
        targetServer = enabledServers.find((s) => s.name.toLowerCase().includes("fetch"));
        actualTool = "fetch";
        let targetUrl = (typeof args.url === "string" ? args.url : typeof rawVal === "string" ? rawVal : "").trim();
        if (!targetUrl || targetUrl.startsWith("{")) targetUrl = "https://scorpk.tech";
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
          targetUrl = `https://${targetUrl}`;
        }
        args = { url: targetUrl };
      }
      // Filesystem
      else if (
        toolName === "list_directory" ||
        toolName === "read_file" ||
        toolName === "write_file" ||
        toolName.toLowerCase().includes("filesystem") ||
        toolName.toLowerCase().includes("file")
      ) {
        targetServer = enabledServers.find((s) => s.name.toLowerCase().includes("filesystem"));
        actualTool = "list_directory";
        if (!args.path || typeof args.path !== "string" || !args.path.trim()) {
          args.path = "C:\\Users\\crist\\TRABAJOS ADSO 3225853";
        }
      }

      const serversToTry = targetServer ? [targetServer] : enabledServers;
      let lastError: string | null = null;

      for (const server of serversToTry) {
        try {
          const res = await this.deps.native.invoke<string>("mcp_call_tool", {
            command: server.command,
            args: server.args,
            env: server.env || {},
            name: actualTool,
            arguments: args,
          });

          // Si el servidor devolvió un error de herramienta no encontrada en este servidor, probar el siguiente
          if (res.includes("Tool not found") || res.includes("-32602")) {
            lastError = res;
            continue;
          }

          const formattedText = `### Resultado de ${server.name} (\`${actualTool}\`):\n\n${res}`;
          return done(formattedText, request.feedback_speech || `Herramienta ${actualTool} ejecutada`);
        } catch (err) {
          lastError = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
        }
      }

      return fail(lastError || `No se pudo ejecutar la herramienta ${toolName}.`);
    } catch (error) {
      if (error instanceof NativeUnavailableError) return fail(error.message);
      const msg = typeof error === "string" ? error : error instanceof Error ? error.message : "Error desconocido.";
      return fail(msg);
    }
  }
}
