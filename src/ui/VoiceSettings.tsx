import { useEffect, useState } from "react";
import {
  errorText,
  installVoice,
  onVoiceEvent,
  saveWakePreference,
  setWake,
  voiceStatus,
  wakePreference,
  type InstallProgress,
} from "../voice/voiceApi";
import { NativeUnavailableError } from "../domain/nativeBridge";

/** Ventana de ajustes de voz: descarga del motor offline y activación de "Oye Scorpk". */
export default function VoiceSettings({ onClose }: { onClose: () => void }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [wake, setWakeState] = useState(wakePreference());
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    voiceStatus()
      .then((status) => !cancelled && setInstalled(status.installed))
      .catch((error) => {
        if (cancelled) return;
        setInstalled(false);
        setMessage(error instanceof NativeUnavailableError ? error.message : "No pude consultar el estado de la voz.");
      });
    const unlisten = onVoiceEvent<InstallProgress>("voice-install", (p) => setProgress(p));
    const unlistenError = onVoiceEvent<string>("voice-error", (text) => setMessage(text));
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn());
      void unlistenError.then((fn) => fn());
    };
  }, []);

  async function install() {
    setInstalling(true);
    setMessage(null);
    try {
      await installVoice();
      setInstalled(true);
    } catch (error) {
      setMessage(errorText(error, "No se pudo instalar el motor de voz."));
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  }

  async function toggleWake(next: boolean) {
    setMessage(null);
    setWakeState(next);
    saveWakePreference(next);
    try {
      await setWake(next);
    } catch (error) {
      setWakeState(false);
      saveWakePreference(false);
      setMessage(errorText(error, "No pude activar la escucha."));
    }
  }

  const label = progress ? `${progress.stage === "motor" ? "Motor de voz" : "Modelo en español"}: ${progress.percent}%` : "Preparando…";

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="appear w-full max-w-sm rounded-card border border-border bg-card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Voz</h2>
          <button onClick={onClose} className="text-sm text-muted hover:text-white">
            Cerrar
          </button>
        </div>

        {installed === null && <p className="text-sm text-muted">Comprobando…</p>}

        {installed === false && (
          <>
            <p className="text-sm text-muted">
              Para hablarle a Scorpk y usar “Oye Scorpk”, hay que descargar una vez el reconocimiento de voz (unos 55 MB).
              Funciona sin internet y tu audio nunca sale del equipo.
            </p>
            {installing ? (
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-border">
                  <div className="h-full bg-accent transition-all" style={{ width: `${progress?.percent ?? 0}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted">{label}</p>
              </div>
            ) : (
              <button
                onClick={() => void install()}
                className="mt-4 w-full rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-black"
              >
                Descargar motor de voz
              </button>
            )}
          </>
        )}

        {installed && (
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Oye Scorpk</span>
              <span className="block text-xs text-muted">
                Escucha en segundo plano tu palabra de activación. Todo se procesa en tu equipo.
              </span>
            </span>
            <input
              type="checkbox"
              checked={wake}
              onChange={(e) => void toggleWake(e.target.checked)}
              className="h-5 w-5 accent-white"
            />
          </label>
        )}

        {message && <p className="mt-4 text-sm text-red-400">{message}</p>}
      </div>
    </div>
  );
}
