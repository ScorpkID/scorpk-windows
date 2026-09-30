/** Contrato JSON de la IA (idéntico al móvil). Ver ARCHITECTURE.md §3. */
export interface ActionParameters {
  target?: string | null;
  value?: string | number | boolean | null;
  message?: string | null;
}

export interface ActionRequest {
  action: string;
  parameters: ActionParameters;
  feedback_speech: string;
}

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  /** "error" = aviso del sistema; "notice" = respuesta de una acción no disponible. */
  kind?: "error" | "notice";
}

/** Un turno del historial que se envía a la IA. */
export interface ChatTurn {
  role: MessageRole;
  text: string;
}

export interface AiModel {
  id: string;
  label: string;
  supportsVision: boolean;
}

/** Lista blanca del servidor (app/api/ai/chat/route.ts). Debe coincidir con AiModel.kt del móvil. */
export const AI_MODELS: AiModel[] = [
  { id: "accounts/fireworks/models/gpt-oss-120b", label: "GPT-OSS 120B", supportsVision: false },
  { id: "accounts/fireworks/models/deepseek-v4p1-flash", label: "DeepSeek V4 Flash", supportsVision: false },
  { id: "accounts/fireworks/models/glm-5p3-flash", label: "GLM 5.3 Flash", supportsVision: true },
  { id: "accounts/fireworks/models/glm-5p3", label: "GLM 5.3", supportsVision: true },
];

export const VOICE_MODEL = AI_MODELS[0];
export const VISION_MODEL = AI_MODELS[2];
export const DEFAULT_CHAT_MODEL = AI_MODELS[0];
