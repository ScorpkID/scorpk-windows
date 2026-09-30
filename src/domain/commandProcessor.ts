import { parseAction, ActionParseError } from "./actionParser";
import { isSupportedAction } from "./actions";
import { AiInterpreter, InterpreterError, type InterpreterErrorKind } from "./aiInterpreter";
import type { AiModel, ChatTurn } from "./model";

export type ProcessResult =
  | { ok: true; text: string; speech: string; kind?: "notice" }
  | { ok: false; error: InterpreterErrorKind | "parse"; text: string };

/**
 * Flujo de una orden: texto → IA → JSON → despacho → respuesta.
 * En Fase 1 solo existe respond_chat; las acciones del PC se añaden en las fases siguientes
 * (ver SUPPORTED_ACTIONS y ARCHITECTURE.md §5).
 */
export class CommandProcessor {
  constructor(private readonly ai: AiInterpreter) {}

  async process(input: string, history: ChatTurn[], model: AiModel): Promise<ProcessResult> {
    let raw: string;
    try {
      raw = await this.ai.interpret(input, history, "chat", model);
    } catch (error) {
      if (error instanceof InterpreterError) return { ok: false, error: error.kind, text: error.message };
      throw error;
    }

    try {
      const action = parseAction(raw);
      if (action.action === "respond_chat") {
        const text = action.parameters.message?.trim() || action.feedback_speech || "Listo.";
        return { ok: true, text, speech: action.feedback_speech || text };
      }
      if (!isSupportedAction(action.action)) {
        return {
          ok: true,
          kind: "notice",
          text: "Eso todavía no lo puedo hacer en Windows, pero estoy aprendiendo.",
          speech: "Eso todavía no lo puedo hacer en Windows.",
        };
      }
      // Aquí se conectará el ActionDispatcher cuando existan acciones ejecutables.
      return { ok: true, text: action.feedback_speech || "Listo.", speech: action.feedback_speech };
    } catch (error) {
      if (error instanceof ActionParseError) {
        return { ok: false, error: "parse", text: "No entendí la respuesta de la IA. Intenta de nuevo." };
      }
      throw error;
    }
  }
}
