import { useEffect, useState, type ReactNode } from "react";
import { checkForWindowsUpdate, CURRENT_WINDOWS_VERSION, type WindowsReleaseInfo } from "./updateService";
import { openExternal } from "../util/openExternal";

interface Props {
  children: ReactNode;
}

/**
 * UpdateGate: comprueba la versión contra https://scorpk.tech/windows/latest.json al iniciar.
 * Al igual que en Android (RF-10 / ARCHITECTURE.md §9), toda actualización nueva es obligatoria
 * para garantizar coherencia en el contrato de acciones y seguridad.
 */
export default function UpdateGate({ children }: Props) {
  const [update, setUpdate] = useState<WindowsReleaseInfo | null>(null);

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
          Hay una nueva versión de Scorpk disponible (<span className="text-white font-mono">v{update.version}</span>). Tu versión actual es <span className="font-mono text-muted">v{CURRENT_WINDOWS_VERSION}</span>.
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

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={() => void openExternal(update.downloadUrl)}
            className="w-full rounded-full bg-white px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 active:scale-[0.98]"
          >
            Descargar e instalar v{update.version}
          </button>
          <p className="text-[11px] text-faint">
            Se descargará el instalador oficial desde scorpk.tech
          </p>
        </div>
      </div>
    </div>
  );
}
