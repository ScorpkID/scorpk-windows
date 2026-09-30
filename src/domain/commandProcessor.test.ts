import { describe, expect, it } from "vitest";
import { CommandProcessor } from "./commandProcessor";
import { InterpreterError, type AiInterpreter } from "./aiInterpreter";
import { DEFAULT_CHAT_MODEL } from "./model";

const fake = (raw: string | InterpreterError) =>
  ({
    interpret: async () => {
      if (raw instanceof InterpreterError) throw raw;
      return raw;
    },
  }) as unknown as AiInterpreter;

const run = (raw: string | InterpreterError) => new CommandProcessor(fake(raw)).process("hola", [], DEFAULT_CHAT_MODEL);

describe("CommandProcessor", () => {
  it("respond_chat devuelve el mensaje", async () => {
    const result = await run(
      '{"action":"respond_chat","parameters":{"message":"Hola, soy Scorpk"},"feedback_speech":"Hola"}',
    );
    expect(result).toEqual({ ok: true, text: "Hola, soy Scorpk", speech: "Hola" });
  });

  it("una acción aún no disponible responde con un aviso, sin fallar", async () => {
    const result = await run('{"action":"open_app","parameters":{"target":"Chrome"},"feedback_speech":"Abriendo"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("notice");
  });

  it("propaga el tipo de error del intérprete (p. ej. Pro requerido)", async () => {
    const result = await run(new InterpreterError("pro_required", "requiere Pro"));
    expect(result).toEqual({ ok: false, error: "pro_required", text: "requiere Pro" });
  });

  it("JSON ilegible da un error de parseo controlado", async () => {
    const result = await run("no es json");
    expect(result).toMatchObject({ ok: false, error: "parse" });
  });
});
