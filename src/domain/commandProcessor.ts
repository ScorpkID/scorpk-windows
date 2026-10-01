import { parseAction, ActionParseError } from "./actionParser";
import { isSupportedAction } from "./actions";
import type { ActionDispatcher } from "./actionDispatcher";
import { AiInterpreter, InterpreterError, type InterpreterErrorKind } from "./aiInterpreter";
import { interpretLocally } from "./localInterpreter";
import { VOICE_MODEL, type ActionRequest, type AiModel, type ChatTurn } from "./model";
import type { PromptMode } from "./systemPrompt";

export type ProcessResult =
  | { ok: true; text: string; speech: string; kind?: "notice" }
  | { ok: false; error: InterpreterErrorKind | "parse" | "action"; text: string };

export interface ProcessOptions {
  /** "voice" pide respuestas más cortas, pensadas para leerse en voz alta (overlay). */
  mode?: PromptMode;
  /** La orden viene de reconocimiento de voz: puede traer errores y la IA debe interpretar la intención. */
  fromVoice?: boolean;
}

const MAX_APPS_FOR_AI = 400;

/**
 * Flujo de una orden: texto → intérprete local (Free, sin red) → si no la entiende, IA (Pro)
 * → JSON → ActionDispatcher → respuesta. Así los comandos locales funcionan siempre y gratis.
 * Si abrir un programa falla por no encontrarlo, la IA elige el correcto de la lista de instalados.
 */
export class CommandProcessor {
  constructor(
    private readonly ai: AiInterpreter,
    private readonly dispatcher: ActionDispatcher,
  ) {}

  async process(
    input: string,
    history: ChatTurn[],
    model: AiModel,
    options: ProcessOptions = {},
  ): Promise<ProcessResult> {
    const local = interpretLocally(input);
    if (local) return this.execute(local, input);

    let raw: string;
    try {
      raw = await this.ai.interpret(input, history, options.mode ?? "chat", model, options.fromVoice ?? false);
    } catch (error) {
      if (error instanceof InterpreterError) return { ok: false, error: error.kind, text: error.message };
      throw error;
    }

    let action: ActionRequest;
    try {
      action = parseAction(raw);
    } catch (error) {
      if (error instanceof ActionParseError) {
        return { ok: false, error: "parse", text: "No entendí la respuesta de la IA. Intenta de nuevo." };
      }
      throw error;
    }

    if (action.action === "respond_chat") {
      const text = action.parameters.message?.trim() || action.feedback_speech || "Listo.";
      // Se lee exactamente lo mismo que se muestra: antes solo se decía la frase corta de confirmación.
      return { ok: true, text, speech: text };
    }
    if (!isSupportedAction(action.action)) {
      return {
        ok: true,
        kind: "notice",
        text: "Eso todavía no lo puedo hacer en Windows, pero estoy aprendiendo.",
        speech: "Eso todavía no lo puedo hacer en Windows.",
      };
    }
    return this.execute(action, input);
  }

  private async execute(action: ActionRequest, heard: string): Promise<ProcessResult> {
    const result = await this.dispatcher.dispatch(action);
    if (result.ok) return { ok: true, text: result.text, speech: result.speech };

    if (result.code === "app_not_found") {
      const recovered = await this.recoverApp(action.parameters.target ?? heard);
      if (recovered) return recovered;
    }
    return { ok: false, error: "action", text: result.text };
  }

  /**
   * No hay ninguna app con ese nombre (lo más común: la voz lo deformó). Se le muestra a la IA la
   * lista real de programas instalados para que elija el que el usuario quiso decir.
   * Devuelve null si no se pudo resolver (sin sesión, sin Pro, sin red o sin coincidencia).
   */
  private async recoverApp(heard: string): Promise<ProcessResult | null> {
    try {
      const names = (await this.dispatcher.listApps()).slice(0, MAX_APPS_FOR_AI);
      if (names.length === 0) return null;

      const raw = await this.ai.complete(
        [
          {
            role: "system",
            content:
              'Eres un asistente que elige un programa instalado en Windows. Responde SOLO con JSON: {"app": "<nombre EXACTO de la lista>"} o {"app": null} si ninguno encaja con claridad. No inventes nombres que no estén en la lista.',
          },
          {
            role: "user",
            content: `El usuario quiso abrir: "${heard}" (puede venir de reconocimiento de voz con errores).\nProgramas instalados:\n${names.join("\n")}`,
          },
        ],
        80,
        VOICE_MODEL,
      );
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { app?: unknown };
      const picked = typeof parsed.app === "string" ? names.find((n) => n.toLowerCase() === parsed.app!.toString().toLowerCase()) : undefined;
      if (!picked) return null;

      const opened = await this.dispatcher.dispatch({
        action: "open_app",
        parameters: { target: picked, value: null, message: null },
        feedback_speech: `Abriendo ${picked}`,
      });
      return opened.ok ? { ok: true, text: opened.text, speech: opened.speech } : null;
    } catch {
      return null;
    }
  }
}
