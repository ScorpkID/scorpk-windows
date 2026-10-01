import { buildSystemPrompt, type PromptMode } from "./systemPrompt";
import type { AiModel, ChatTurn } from "./model";

export const PROXY_ENDPOINT = "https://scorpk.tech/api/ai/chat";

export type InterpreterErrorKind =
  | "not_signed_in" // 401 o sin sesión → mostrar login
  | "pro_required" // 402 → pantalla de plan
  | "rate_limited" // 429
  | "unavailable" // 502/503/504 u otro error del servidor
  | "network" // sin conexión o timeout
  | "invalid"; // respuesta vacía o con formato inesperado

export class InterpreterError extends Error {
  constructor(
    readonly kind: InterpreterErrorKind,
    message: string,
  ) {
    super(message);
  }
}

const MAX_HISTORY_TURNS = 10;
const MAX_TURN_CHARS = 2000;
const CHAT_MAX_TOKENS = 2500;
const VOICE_MAX_TOKENS = 600;
const TIMEOUT_MS = 75_000;

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiInterpreterDeps {
  /** Token de acceso de la sesión de Supabase (null si no hay sesión). */
  accessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

/**
 * Envía la orden al proxy de IA de scorpk.tech (la clave de Fireworks vive solo en el servidor)
 * y devuelve el JSON crudo de la acción para actionParser.
 */
export class AiInterpreter {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;

  constructor(private readonly deps: AiInterpreterDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
    this.endpoint = deps.endpoint ?? PROXY_ENDPOINT;
  }

  async interpret(
    input: string,
    history: ChatTurn[],
    mode: PromptMode,
    model: AiModel,
    fromVoice = false,
  ): Promise<string> {
    const messages: AiMessage[] = [
      { role: "system", content: buildSystemPrompt(mode, new Date(), fromVoice) },
      ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({ role: turn.role, content: turn.text.slice(0, MAX_TURN_CHARS) })),
      { role: "user", content: input },
    ];
    return this.complete(messages, mode === "chat" ? CHAT_MAX_TOKENS : VOICE_MAX_TOKENS, model);
  }

  /** Petición genérica al proxy (respuesta JSON). Lo usan `interpret` y tareas auxiliares como elegir una app. */
  async complete(messages: AiMessage[], maxTokens: number, model: AiModel): Promise<string> {
    const token = await this.deps.accessToken();
    if (!token) throw new InterpreterError("not_signed_in", "Inicia sesión para usar la IA.");

    const body = {
      model: model.id,
      messages,
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: maxTokens,
    };

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new InterpreterError("network", "No pude conectarme. Revisa tu internet.");
    }

    if (!response.ok) throw await httpError(response);

    let content: unknown;
    try {
      const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
      content = data.choices?.[0]?.message?.content;
    } catch {
      throw new InterpreterError("invalid", "La IA respondió con un formato inesperado.");
    }
    if (typeof content !== "string" || content.trim() === "") {
      throw new InterpreterError("invalid", "La IA no devolvió contenido.");
    }
    return content;
  }
}

async function httpError(response: Response): Promise<InterpreterError> {
  switch (response.status) {
    case 401:
      return new InterpreterError("not_signed_in", "Tu sesión venció. Vuelve a iniciar sesión.");
    case 402:
      return new InterpreterError("pro_required", "La IA de Scorpk requiere el plan Pro.");
    case 429:
      return new InterpreterError("rate_limited", "Demasiadas peticiones. Espera un momento.");
    default:
      return new InterpreterError("unavailable", `La IA no está disponible ahora (código ${response.status}).`);
  }
}
