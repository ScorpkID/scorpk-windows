import { tauriBridge } from "../domain/nativeBridge";
import { AI_MODELS, DEFAULT_CHAT_MODEL, type AiModel } from "../domain/model";

/**
 * Preferencias del usuario en este equipo (como SettingsDataStore en Android). Se comparten entre la
 * ventana principal y el overlay porque ambas tienen el mismo origen. Sin secretos aquí.
 */
const VOICE_REPLY_KEY = "scorpk.voiceReply";
const CHAT_MODEL_KEY = "scorpk.chatModel";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sin almacenamiento: la preferencia no persiste */
  }
}

/** "Respuesta por voz": el asistente lee sus respuestas en voz alta (activado por defecto, como en Android). */
export const voiceReplyEnabled = (): boolean => read(VOICE_REPLY_KEY) !== "0";
export const setVoiceReplyEnabled = (enabled: boolean): void => write(VOICE_REPLY_KEY, enabled ? "1" : "0");

export function chatModel(): AiModel {
  const id = read(CHAT_MODEL_KEY);
  return AI_MODELS.find((m) => m.id === id) ?? DEFAULT_CHAT_MODEL;
}
export const setChatModel = (id: string): void => write(CHAT_MODEL_KEY, id);

/** "Iniciar con Windows" (arranca minimizado en la bandeja). */
export const autostartEnabled = () => tauriBridge.invoke<boolean>("autostart_status");
export const setAutostart = (enabled: boolean) => tauriBridge.invoke<void>("autostart_set", { enabled });
