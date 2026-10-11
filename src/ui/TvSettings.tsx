import { useEffect, useState } from "react";
import { NativeUnavailableError, type TvConfig, type TvDepsStatus, type TvResult } from "../domain/nativeBridge";

interface TvApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

let bridge: TvApi | null = null;

async function getTvBridge(): Promise<TvApi> {
  if (bridge) return bridge;
  if (!("__TAURI_INTERNALS__" in window)) throw new NativeUnavailableError();
  const { invoke } = await import("@tauri-apps/api/core");
  bridge = { invoke };
  return bridge;
}

/** Modal de ajustes del televisor Samsung: IP, MAC, estado de Python/samsungtvws, vinculación. */
export default function TvSettings({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<TvConfig>({ ip: "", mac: "", port: 8002, configured: false });
  const [deps, setDeps] = useState<TvDepsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = await getTvBridge();
        const [cfg, dep] = await Promise.all([
          api.invoke<TvConfig>("tv_get_config"),
          api.invoke<TvDepsStatus>("tv_check_deps"),
        ]);
        if (cancelled) return;
        setConfig(cfg);
        setDeps(dep);
      } catch (error) {
        if (!cancelled) showError(error, "No pude cargar la configuración.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function showError(error: unknown, fallback: string) {
    setMessageOk(false);
    setMessage(
      error instanceof NativeUnavailableError
        ? error.message
        : typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : fallback,
    );
  }

  function showOk(text: string) {
    setMessageOk(true);
    setMessage(text);
  }

  async function save() {
    if (!config.ip.trim()) { showError(null, "Ingresa la IP del televisor."); return; }
    setSaving(true);
    setMessage(null);
    try {
      const api = await getTvBridge();
      await api.invoke("tv_save_config", { ip: config.ip.trim(), mac: config.mac.trim() });
      setConfig((prev) => ({ ...prev, configured: true }));
      showOk("Configuración guardada.");
    } catch (error) {
      showError(error, "No pude guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  async function installDeps() {
    setInstalling(true);
    setMessage(null);
    try {
      const api = await getTvBridge();
      await api.invoke("tv_install_deps");
      setDeps((prev) => prev ? { ...prev, samsungtvws_installed: true } : prev);
      showOk("¡samsungtvws instalada correctamente!");
    } catch (error) {
      showError(error, "No pude instalar samsungtvws.");
    } finally {
      setInstalling(false);
    }
  }

  async function pair() {
    setPairing(true);
    setMessage(null);
    try {
      const api = await getTvBridge();
      const result = await api.invoke<TvResult>("tv_pair");
      if (result.ok) showOk(result.message ?? "Vinculación iniciada.");
      else showError(null, result.error ?? "Error de vinculación.");
    } catch (error) {
      showError(error, "No pude vincular el televisor.");
    } finally {
      setPairing(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage(null);
    try {
      const api = await getTvBridge();
      const result = await api.invoke<TvResult>("tv_execute", { command: "check" });
      if (result.ok) showOk("✓ Conexión exitosa con el televisor.");
      else showError(null, result.error ?? "No se pudo conectar.");
    } catch (error) {
      showError(error, "No se pudo conectar con el televisor.");
    } finally {
      setTesting(false);
    }
  }

  const busy = saving || installing || pairing || testing;

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="appear w-full max-w-sm rounded-card border border-border bg-card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">📺 Televisor Samsung</h2>
          <button onClick={onClose} className="text-sm text-muted hover:text-white">
            Cerrar
          </button>
        </div>

        {loading && <p className="text-sm text-muted">Cargando…</p>}

        {!loading && (
          <>
            {/* ─── Estado de dependencias ─── */}
            {deps && !deps.python_found && (
              <div className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm">
                <p className="font-medium text-red-400">Python no encontrado</p>
                <p className="mt-1 text-muted">
                  Para controlar la TV se necesita Python 3 instalado en el sistema.
                </p>
              </div>
            )}

            {deps && deps.python_found && !deps.samsungtvws_installed && (
              <div className="mb-4 rounded-xl border border-yellow-400/30 bg-yellow-400/10 px-4 py-3 text-sm">
                <p className="font-medium text-yellow-400">Falta la librería samsungtvws</p>
                <p className="mt-1 text-muted">
                  Se necesita para comunicarse con la TV por WebSocket.
                </p>
                <button
                  onClick={() => void installDeps()}
                  disabled={installing}
                  className="mt-2 w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition disabled:opacity-50"
                >
                  {installing ? "Instalando…" : "Instalar samsungtvws"}
                </button>
              </div>
            )}

            {deps && deps.python_found && deps.samsungtvws_installed && (
              <p className="mb-4 text-xs text-green-400">✓ Python y samsungtvws listos</p>
            )}

            {/* ─── Campos de configuración ─── */}
            <label className="block text-sm">
              <span className="text-muted">IP del televisor</span>
              <input
                type="text"
                value={config.ip}
                onChange={(e) => setConfig((prev) => ({ ...prev, ip: e.target.value }))}
                placeholder="192.168.1.50"
                className="mt-1 w-full rounded-xl border border-border bg-black px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-white/30"
              />
            </label>

            <label className="mt-3 block text-sm">
              <span className="text-muted">MAC del televisor (para encendido remoto)</span>
              <input
                type="text"
                value={config.mac}
                onChange={(e) => setConfig((prev) => ({ ...prev, mac: e.target.value }))}
                placeholder="AA:BB:CC:DD:EE:FF"
                className="mt-1 w-full rounded-xl border border-border bg-black px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-white/30"
              />
            </label>

            <p className="mt-2 text-xs text-muted">
              Encuentra la IP y MAC en la TV: Ajustes → General → Red → Estado de la red.
            </p>

            {/* ─── Botones de acción ─── */}
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={() => void save()}
                disabled={busy || !config.ip.trim()}
                className="w-full rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-black transition disabled:opacity-30"
              >
                {saving ? "Guardando…" : "Guardar configuración"}
              </button>

              {config.configured && (
                <>
                  <button
                    onClick={() => void pair()}
                    disabled={busy}
                    className="w-full rounded-full border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-white/5 disabled:opacity-30"
                  >
                    {pairing ? "Vinculando…" : "Vincular televisor"}
                  </button>

                  <button
                    onClick={() => void testConnection()}
                    disabled={busy}
                    className="w-full rounded-full border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-white/5 disabled:opacity-30"
                  >
                    {testing ? "Probando…" : "Probar conexión"}
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* ─── Mensaje de estado ─── */}
        {message && (
          <p className={`mt-4 text-sm ${messageOk ? "text-green-400" : "text-red-400"}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
