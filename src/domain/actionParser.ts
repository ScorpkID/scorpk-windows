import type { ActionParameters, ActionRequest } from "./model";

export class ActionParseError extends Error {}

/** Quita las vallas ``` que algunos modelos añaden aunque se les pida JSON puro. */
function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asValue(value: unknown): ActionParameters["value"] {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

/** Convierte la respuesta cruda del modelo en un ActionRequest tolerando ruido alrededor del JSON. */
export function parseAction(raw: string): ActionRequest {
  const text = stripFences(raw);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ActionParseError("La respuesta no contiene JSON.");

  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ActionParseError("JSON inválido.");
  }
  if (typeof data !== "object" || data === null) throw new ActionParseError("JSON inesperado.");

  const obj = data as Record<string, unknown>;
  if (typeof obj.action !== "string" || obj.action.trim() === "") {
    throw new ActionParseError("Falta la acción.");
  }
  const params = (typeof obj.parameters === "object" && obj.parameters !== null ? obj.parameters : {}) as Record<
    string,
    unknown
  >;

  return {
    action: obj.action.trim(),
    parameters: {
      target: asNullableString(params.target),
      value: asValue(params.value),
      message: asNullableString(params.message),
    },
    feedback_speech: typeof obj.feedback_speech === "string" ? obj.feedback_speech : "",
  };
}
