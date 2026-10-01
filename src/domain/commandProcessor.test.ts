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

/** Dispatcher donde open_app falla con "no encontrada" salvo para los nombres de `installed`. */
const appDispatcher = (installed: string[]) => {
  const dispatch = vi.fn(async (action: { action: string; parameters: { target?: string | null } }) => {
    const target = action.parameters.target ?? "";
    if (installed.includes(target)) return { ok: true, text: `Listo, abrí ${target}.`, speech: `Abriendo ${target}` };
    return { ok: false, code: "app_not_found" as const, text: `No encontré ningún programa llamado «${target}».`, speech: "" };
  });
  const listApps = vi.fn(async () => installed);
  return { dispatch, listApps } as unknown as ActionDispatcher & { dispatch: typeof dispatch; listApps: typeof listApps };
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
    expect(await result).toEqual({ ok: true, text: "Leonardo da Vinci", speech: "Leonardo da Vinci" });
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

  it("la orden de voz se marca para que la IA corrija los errores de escucha", async () => {
    const { ai, result } = run("¿cómo se hace un pastel?", '{"action":"respond_chat","parameters":{"message":"x"}}');
    await result;
    const ai2 = fakeAi('{"action":"respond_chat","parameters":{"message":"x"}}');
    await new CommandProcessor(ai2, fakeDispatcher()).process("hola mundo", [], DEFAULT_CHAT_MODEL, { mode: "voice", fromVoice: true });
    expect(ai2.interpret).toHaveBeenCalledWith("hola mundo", [], "voice", DEFAULT_CHAT_MODEL, true);
    expect(ai.interpret).toHaveBeenCalledWith("¿cómo se hace un pastel?", [], "chat", DEFAULT_CHAT_MODEL, false);
  });

  describe("abrir cualquier app instalada", () => {
    const aiWith = (pick: string | null | Error) => {
      const complete = vi.fn(async () => {
        if (pick instanceof Error) throw pick;
        return JSON.stringify({ app: pick });
      });
      return { interpret: vi.fn(), complete } as unknown as AiInterpreter & { complete: typeof complete };
    };

    it("si no la encuentra, la IA elige de la lista real de apps instaladas", async () => {
      const dispatcher = appDispatcher(["WhatsApp", "Google Chrome"]);
      const ai = aiWith("WhatsApp");
      const result = await new CommandProcessor(ai, dispatcher).process("abre guasap", [], DEFAULT_CHAT_MODEL);
      expect(result).toEqual({ ok: true, text: "Listo, abrí WhatsApp.", speech: "Abriendo WhatsApp" });
      // La IA recibió la lista de programas instalados.
      const messages = (ai.complete.mock.calls[0] as unknown as [{ content: string }[]])[0];
      expect(messages[1].content).toContain("WhatsApp\nGoogle Chrome");
    });

    it("no abre nada si la IA devuelve un nombre que no está en la lista", async () => {
      const dispatcher = appDispatcher(["WhatsApp"]);
      const result = await new CommandProcessor(aiWith("Photoshop"), dispatcher).process("abre photoshop", [], DEFAULT_CHAT_MODEL);
      expect(result).toMatchObject({ ok: false, error: "action" });
    });

    it("sin Pro o sin sesión conserva el aviso original de 'no encontré'", async () => {
      const dispatcher = appDispatcher(["WhatsApp"]);
      const ai = aiWith(new InterpreterError("pro_required", "x"));
      const result = await new CommandProcessor(ai, dispatcher).process("abre guasap", [], DEFAULT_CHAT_MODEL);
      expect(result).toMatchObject({ ok: false, error: "action" });
      expect(result.ok === false && result.text).toContain("No encontré");
    });
  });
});
