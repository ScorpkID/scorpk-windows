import { parseAction, ActionParseError } from "./actionParser";
import { isSupportedAction } from "./actions";
import type { ActionDispatcher } from "./actionDispatcher";
import { AiInterpreter, InterpreterError, type InterpreterErrorKind } from "./aiInterpreter";
import { interpretLocally } from "./localInterpreter";
import type { ActionRequest, AiModel, ChatTurn } from "./model";

export type ProcessResult =
  | { ok: true; text: string; speech: string; kind?: "notice" }
  | { ok: false; error: InterpreterErrorKind | "parse" | "action"; text: string };

/**
 * Flujo de una orden: texto → intérprete local (Free, sin red) → si no la entiende, IA (Pro)
 * → JSON → ActionDispatcher → respuesta. Así los comandos locales funcionan siempre y gratis.
 */
export class CommandProcessor {
  constructor(
    private readonly ai: AiInterpreter,
    private readonly dispatcher: ActionDispatcher,
  ) {}

  async process(input: string, history: ChatTurn[], model: AiModel): Promise<ProcessResult> {
    const local = interpretLocally(input);
    if (local) return this.execute(local);

    let raw: string;
    try {
      raw = await this.ai.interpret(input, history, "chat", model);
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
    return this.execute(action);
  }

  private async execute(action: ActionRequest): Promise<ProcessResult> {
    const result = await this.dispatcher.dispatch(action);
    return result.ok
      ? { ok: true, text: result.text, speech: result.speech }
      : { ok: false, error: "action", text: result.text };
  }
}
