import { useEffect, useState } from "react";
import { NativeUnavailableError, type PhoneDevice, type PhoneResult } from "../domain/nativeBridge";

interface PhoneApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

let bridge: PhoneApi | null = null;

async function getPhoneBridge(): Promise<PhoneApi> {
  if (bridge) return bridge;
  if (!("__TAURI_INTERNALS__" in window)) throw new NativeUnavailableError();
  const { invoke } = await import("@tauri-apps/api/core");
  bridge = { invoke };
  return bridge;
}

export default function PhoneSettings({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<PhoneDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("5555");
  const [testTask, setTestTask] = useState("");
  const [taskRunning, setTaskRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = await getPhoneBridge();
        const res = await api.invoke<PhoneResult>("phone_list_devices");
        if (!cancelled && res.devices) {
          setDevices(res.devices);
        }
      } catch (err) {
        if (!cancelled) showError(err, "No pude consultar dispositivos ADB.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function showError(err: unknown, fallback: string) {
    setMessageOk(false);
    setMessage(err instanceof NativeUnavailableError ? err.message : err instanceof Error ? err.message : fallback);
  }

  function showOk(text: string) {
    setMessageOk(true);
    setMessage(text);
  }

  async function refreshDevices() {
    setLoading(true);
    setMessage(null);
    try {
      const api = await getPhoneBridge();
      const res = await api.invoke<PhoneResult>("phone_list_devices");
      if (res.devices) setDevices(res.devices);
      showOk(`Detectados ${res.devices?.length ?? 0} dispositivo(s).`);
    } catch (err) {
      showError(err, "Error al buscar dispositivos.");
    } finally {
      setLoading(false);
    }
  }

  async function connectWireless() {
    if (!ip.trim()) { showError(null, "Ingresa la IP del celular."); return; }
    setConnecting(true);
    setMessage(null);
    try {
      const api = await getPhoneBridge();
      const res = await api.invoke<PhoneResult>("phone_connect_wireless", { host: ip.trim(), port: parseInt(port, 10) || 5555 });
      if (res.ok) {
        showOk(res.message ?? "Conectado al celular.");
        await refreshDevices();
      } else {
        showError(null, res.error ?? "No se pudo conectar.");
      }
    } catch (err) {
      showError(err, "Error al conectar inalámbricamente.");
    } finally {
      setConnecting(false);
    }
  }

  async function executeTestTask() {
    if (!testTask.trim()) return;
    setTaskRunning(true);
    setMessage(null);
    try {
      const api = await getPhoneBridge();
      const res = await api.invoke<PhoneResult>("phone_run_task", { task: testTask.trim() });
      if (res.ok) showOk(res.message ?? "Tarea ejecutada.");
      else showError(null, res.error ?? "Fallo al ejecutar tarea.");
    } catch (err) {
      showError(err, "Error ejecutando en el celular.");
    } finally {
      setTaskRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="appear w-full max-w-md rounded-card border border-border bg-card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">📱 Celular Android (ARTEMIS)</h2>
          <button onClick={onClose} className="text-sm text-muted hover:text-white">Cerrar</button>
        </div>

        {/* ─── Dispositivos Conectados ─── */}
        <div className="mb-4 rounded-xl border border-border bg-black/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Dispositivos ADB</span>
            <button
              onClick={() => void refreshDevices()}
              disabled={loading}
              className="text-xs text-accent hover:underline disabled:opacity-50"
            >
              {loading ? "Buscando…" : "Actualizar"}
            </button>
          </div>

          {devices.length === 0 ? (
            <p className="text-xs text-muted">
              No hay dispositivos detectados. Conecta tu celular por USB (con Depuración USB activada) o conéctalo por Wi-Fi abajo.
            </p>
          ) : (
            <ul className="space-y-2">
              {devices.map((d) => (
                <li key={d.serial} className="flex items-center justify-between text-xs bg-surface p-2.5 rounded-lg border border-border">
                  <div>
                    <p className="font-semibold text-white">{d.model}</p>
                    <p className="font-mono text-muted text-[10px]">{d.serial}</p>
                  </div>
                  <span className="rounded-full bg-green-400/10 px-2 py-0.5 text-[10px] text-green-400 font-medium">
                    {d.state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ─── Conectar por Wi-Fi ─── */}
        <div className="mb-4">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted mb-2">
            Conectar por Wi-Fi (Depuración inalámbrica)
          </span>
          <div className="flex gap-2">
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.1.55"
              className="flex-1 rounded-xl border border-border bg-black px-3.5 py-2 text-xs outline-none focus:border-white/30"
            />
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="5555"
              className="w-20 rounded-xl border border-border bg-black px-3.5 py-2 text-xs outline-none focus:border-white/30"
            />
            <button
              onClick={() => void connectWireless()}
              disabled={connecting || !ip.trim()}
              className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-30"
            >
              {connecting ? "…" : "Conectar"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-faint">
            En tu teléfono: Ajustes → Opciones de desarrollador → Depuración inalámbrica.
          </p>
        </div>

        {/* ─── Prueba de comando ─── */}
        {devices.length > 0 && (
          <div className="pt-2 border-t border-border">
            <span className="block text-xs font-semibold uppercase tracking-wider text-muted mb-2">
              Probar orden en el celular
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={testTask}
                onChange={(e) => setTestTask(e.target.value)}
                placeholder="ej. abre whatsapp"
                className="flex-1 rounded-xl border border-border bg-black px-3.5 py-2 text-xs outline-none focus:border-white/30"
              />
              <button
                onClick={() => void executeTestTask()}
                disabled={taskRunning || !testTask.trim()}
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold hover:border-accent disabled:opacity-30"
              >
                {taskRunning ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </div>
        )}

        {message && (
          <p className={`mt-4 text-xs ${messageOk ? "text-green-400" : "text-red-400"}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
