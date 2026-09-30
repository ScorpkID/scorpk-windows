import { describe, expect, it, vi } from "vitest";
import { AiInterpreter, InterpreterError, PROXY_ENDPOINT } from "./aiInterpreter";
import { DEFAULT_CHAT_MODEL } from "./model";

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

function make(fetchImpl: unknown, token: string | null = "tok") {
  return new AiInterpreter({ accessToken: async () => token, fetchImpl: fetchImpl as typeof fetch });
}

async function kindOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof InterpreterError ? error.kind : "otro";
  }
  return "sin error";
}

describe("AiInterpreter", () => {
  it("envía la petición al proxy con el Bearer de la sesión y sin claves", async () => {
    const fetchImpl = vi.fn(async () => ok('{"action":"respond_chat"}'));
    const result = await make(fetchImpl).interpret("hola", [{ role: "user", text: "antes" }], "chat", DEFAULT_CHAT_MODEL);
    expect(result).toBe('{"action":"respond_chat"}');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PROXY_ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(DEFAULT_CHAT_MODEL.id);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "hola" });
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("sin sesión no llama a la red", async () => {
    const fetchImpl = vi.fn();
    const kind = await kindOf(make(fetchImpl, null).interpret("hola", [], "chat", DEFAULT_CHAT_MODEL));
    expect(kind).toBe("not_signed_in");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, "not_signed_in"],
    [402, "pro_required"],
    [429, "rate_limited"],
    [502, "unavailable"],
    [504, "unavailable"],
  ])("traduce el HTTP %i a %s", async (status, expected) => {
    const fetchImpl = async () => new Response("{}", { status });
    expect(await kindOf(make(fetchImpl).interpret("x", [], "chat", DEFAULT_CHAT_MODEL))).toBe(expected);
  });

  it("errores de red y respuestas vacías", async () => {
    const boom = async () => {
      throw new TypeError("fail");
    };
    expect(await kindOf(make(boom).interpret("x", [], "chat", DEFAULT_CHAT_MODEL))).toBe("network");
    const empty = async () => ok("   ");
    expect(await kindOf(make(empty).interpret("x", [], "chat", DEFAULT_CHAT_MODEL))).toBe("invalid");
  });
});
