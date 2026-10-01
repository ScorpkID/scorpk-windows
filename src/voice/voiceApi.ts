import { tauriBridge } from "../domain/nativeBridge";

/** Puente con el motor de voz de Rust (src-tauri/src/voice). El audio se procesa en el equipo. */
export interface VoiceStatus {
  installed: boolean;
  running: boolean;
  wakeEnabled: boolean;
}

export interface InstallProgress {
  stage: "motor" | "modelo";
  percent: number;
}

const WAKE_KEY = "scorpk.wake";

/** Preferencia del usuario para "Oye Scorpk" (se guarda en el equipo, compartida por las dos ventanas). */
export function wakePreference(): boolean {
  try {
    return localStorage.getItem(WAKE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveWakePreference(enabled: boolean): void {
  try {
    localStorage.setItem(WAKE_KEY, enabled ? "1" : "0");
  } catch {
    /* sin almacenamiento: la preferencia no persiste */
  }
}

export const voiceStatus = () => tauriBridge.invoke<VoiceStatus>("voice_status");
export const installVoice = () => tauriBridge.invoke<void>("voice_install");
export const setWake = (enabled: boolean) => tauriBridge.invoke<void>("voice_set_wake", { enabled });
export const startListening = () => tauriBridge.invoke<void>("voice_listen");
export const pauseListening = () => tauriBridge.invoke<void>("voice_pause");
export const resumeWake = () => tauriBridge.invoke<void>("voice_resume");

/** Suscripción a un evento del motor ("voice-wake", "voice-partial", "voice-final", "voice-timeout", ...). */
export async function onVoiceEvent<T = unknown>(name: string, handler: (payload: T) => void): Promise<() => void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<T>(name, (event) => handler(event.payload));
  } catch {
    return () => {};
  }
}

export function errorText(error: unknown, fallback: string): string {
  return typeof error === "string" && error ? error : fallback;
}
