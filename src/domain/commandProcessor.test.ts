import { describe, expect, it, vi } from "vitest";
import { CommandProcessor } from "./commandProcessor";
import { InterpreterError, type AiInterpreter } from "./aiInterpreter";
import type { ActionDispatcher } from "./actionDispatcher";
import { DEFAULT_CHAT_MODEL } from "./model";

const fakeAi = (raw: string | InterpreterError) => {
  const interpret = vi.fn(async () => {
    if (raw instanceof InterpreterError) throw raw;
    return raw;
  });
  return { interpret } as unknown as AiInterpreter & { interpret: typeof interpret };
};

const fakeDispatcher = (ok = true) => {
  const dispatch = vi.fn(async () => ({ ok, text: ok ? "hecho" : "falló", speech: "voz" }));
  return { dispatch } as unknown as ActionDispatcher & { dispatch: typeof dispatch };
};

const run = (input: string, raw: string | InterpreterError, dispatcher = fakeDispatcher()) => {
  const ai = fakeAi(raw);
  return { ai, dispatcher, result: new CommandProcessor(ai, dispatcher).process(input, [], DEFAULT_CHAT_MODEL) };
};

describe("CommandProcessor", () => {
  it("un comando local se ejecuta sin llamar a la IA (modo Free)", async () => {
    const { ai, dispatcher, result } = run("abre chrome", new InterpreterError("pro_required", "x"));
    expect(await result).toEqual({ ok: true, text: "hecho", speech: "voz" });
    expect(ai.interpret).not.toHaveBeenCalled();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(expect.objectContaining({ action: "open_app" }));
  });

  it("un fallo de la acción local se reporta como error de acción", async () => {
    const { result } = run("sube el volumen", "{}", fakeDispatcher(false));
    expect(await result).toEqual({ ok: false, error: "action", text: "falló" });
  });

  it("lo que las reglas no entienden va a la IA; respond_chat devuelve el mensaje", async () => {
    const { ai, result } = run(
      "¿quién pintó la Mona Lisa?",
      '{"action":"respond_chat","parameters":{"message":"Leonardo da Vinci"},"feedback_speech":"Leonardo"}',
    );
    expect(await result).toEqual({ ok: true, text: "Leonardo da Vinci", speech: "Leonardo" });
    expect(ai.interpret).toHaveBeenCalledOnce();
  });

  it("una acción soportada que propone la IA se despacha", async () => {
    const { dispatcher, result } = run(
      "ponme algo de ruido para concentrarme",
      '{"action":"youtube_search","parameters":{"target":"lofi"},"feedback_speech":"Buscando"}',
    );
    expect((await result).ok).toBe(true);
    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
  });

  it("una acción que aún no existe responde con aviso, sin despachar", async () => {
    const { dispatcher, result } = run("prende la linterna", '{"action":"toggle_flashlight","parameters":{}}');
    const r = await result;
    expect(r.ok && r.kind).toBe("notice");
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("propaga el tipo de error de la IA (p. ej. Pro requerido)", async () => {
    const { result } = run("cuéntame un chiste", new InterpreterError("pro_required", "requiere Pro"));
    expect(await result).toEqual({ ok: false, error: "pro_required", text: "requiere Pro" });
  });

  it("JSON ilegible de la IA da un error de parseo controlado", async () => {
    const { result } = run("cuéntame un chiste", "no es json");
    expect(await result).toMatchObject({ ok: false, error: "parse" });
  });
});
