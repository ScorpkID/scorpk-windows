import { useEffect, useState, type ReactNode } from "react";
import { checkForWindowsUpdate, CURRENT_WINDOWS_VERSION, type WindowsReleaseInfo } from "./updateService";
import { NativeUnavailableError } from "../domain/nativeBridge";
import { openExternal } from "../util/openExternal";

interface Props {
  children: ReactNode;
}

interface UpdateApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

let bridge: UpdateApi | null = null;
async function getUpdateBridge(): Promise<UpdateApi> {
  if (bridge) return bridge;
  if (!("__TAURI_INTERNALS__" in window)) throw new NativeUnavailableError();
  const { invoke } = await import("@tauri-apps/api/core");
  bridge = { invoke };
  return bridge;
}

/**
 * UpdateGate: comprueba la versión contra https://scorpk.tech/windows/latest.json al iniciar.
 * Si hay una versión superior, descarga e instala automáticamente desde la propia app.
 */
export default function UpdateGate({ children }: Props) {
  const [update, setUpdate] = useState<WindowsReleaseInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkForWindowsUpdate().then((info) => {
      if (!cancelled && info) {
        setUpdate(info);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAutoUpdate() {
    if (!update) return;
    setInstalling(true);
    setErrorMsg(null);
    try {
      const api = await getUpdateBridge();
      // Descarga el .exe en %TEMP%, verifica SHA-256, lanza el instalador y reinicia la app
      await api.invoke("download_and_install_update", {
        downloadUrl: update.downloadUrl,
        expectedSha256: update.sha256,
      });
    } catch (err) {
      setInstalling(false);
      // Si por alguna razón falla el updater nativo, fallback automático al navegador
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`No se pudo actualizar automáticamente: ${msg}.`);
      void openExternal(update.downloadUrl);
    }
  }

  if (!update) {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6 select-none">
      <div className="appear w-full max-w-md rounded-card border border-border bg-card p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5 border border-border mb-4">
          <img src="/scorpk-icon.png" alt="" className="h-9 w-9 rounded-lg" />
        </div>

        <h2 className="text-xl font-semibold tracking-tight text-white">Actualización obligatoria</h2>
        <p className="mt-2 text-sm text-muted">
          Hay una nueva versión disponible (<span className="text-white font-mono">v{update.version}</span>). Tu versión instalada es <span className="font-mono text-muted">v{CURRENT_WINDOWS_VERSION}</span>.
        </p>

        {update.notes && update.notes.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-black/50 p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">Novedades:</p>
            <ul className="space-y-1.5 text-xs text-muted list-disc pl-4">
              {update.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        )}

        {errorMsg && (
          <p className="mt-3 text-xs text-red-400">{errorMsg}</p>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={() => void handleAutoUpdate()}
            disabled={installing}
            className="w-full rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {installing ? "Descargando e instalando actualización…" : `Actualizar ahora a v${update.version}`}
          </button>
          <p className="text-[11px] text-faint">
            Se descargará e instalará directamente en segundo plano sin salir al navegador
          </p>
        </div>
      </div>
    </div>
  );
}
