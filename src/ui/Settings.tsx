import { useEffect, useState, type ReactNode } from "react";
import { autostartEnabled, setAutostart, setVoiceReplyEnabled, voiceReplyEnabled } from "../data/settings";
import { NativeUnavailableError } from "../domain/nativeBridge";
import { openExternal, PRICING_URL, PRIVACY_URL, TERMS_URL } from "../util/openExternal";
import {
  errorText,
  installVoice,
  onVoiceEvent,
  saveWakePreference,
  setWake,
  voiceStatus,
  wakePreference,
  type InstallProgress,
  type VoiceStatus,
} from "../voice/voiceApi";

interface Props {
  email: string;
  isPro: boolean;
  onBack: () => void;
  onSignOut: () => void;
  onClearHistory: () => void;
}

/** Configuración (equivalente a SettingsScreen.kt de Android): voz, inicio, cuenta y privacidad. */
export default function Settings({ email, isPro, onBack, onSignOut, onClearHistory }: Props) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button onClick={onBack} className="text-sm text-muted hover:text-white" aria-label="Volver al chat">
          ← Volver
        </button>
        <span className="font-semibold">Configuración</span>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-xl flex-col gap-6">
          <VoiceGroup />
          <GeneralGroup />
          <Group title="Cuenta">
            <Row title={email || "Sin correo"} subtitle={isPro ? "Plan Pro: IA activada." : "Plan Free: comandos locales y conectores."}>
              {!isPro && (
                <button onClick={() => void openExternal(PRICING_URL)} className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black">
                  Ver plan Pro
                </button>
              )}
            </Row>
            <Row title="Cerrar sesión" subtitle="Podrás volver a entrar con tu cuenta de Scorpk.">
              <button onClick={onSignOut} className="rounded-full border border-border px-4 py-1.5 text-xs hover:border-accent">
                Salir
              </button>
            </Row>
          </Group>
          <PrivacyGroup onClearHistory={onClearHistory} />
          <p className="pb-4 text-center text-xs text-muted">
            <button className="underline" onClick={() => void openExternal(TERMS_URL)}>
              Términos
            </button>
            {" · "}
            <button className="underline" onClick={() => void openExternal(PRIVACY_URL)}>
              Privacidad
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

function VoiceGroup() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [wake, setWakeState] = useState(wakePreference());
  const [voiceReply, setVoiceReply] = useState(voiceReplyEnabled());
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    voiceStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch((error) => {
        if (cancelled) return;
        setStatus({ installed: false, precise: false, running: false, wakeEnabled: false });
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
      setStatus(await voiceStatus());
    } catch (error) {
      setMessage(errorText(error, "No se pudo instalar el reconocimiento de voz."));
      setStatus(await voiceStatus().catch(() => status));
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

  const complete = status?.installed && status.precise;
  return (
    <Group title="Voz" footer="El reconocimiento de voz funciona sin internet: tu audio nunca sale del equipo.">
      {status === null && <Row title="Comprobando…" />}
      {status && !complete && (
        <div className="px-4 py-3.5">
          <p className="text-sm font-medium">{status.installed ? "Mejorar el reconocimiento de voz" : "Reconocimiento de voz"}</p>
          <p className="mt-0.5 text-sm text-muted">
            {status.installed
              ? "Descarga el modelo preciso (Whisper, unos 200 MB, una sola vez) para que Scorpk entienda bien lo que dices."
              : "Para hablarle a Scorpk hay que descargar una vez el reconocimiento de voz (unos 250 MB)."}
          </p>
          {installing ? (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-border">
                <div className="h-full bg-accent transition-all" style={{ width: `${progress?.percent ?? 0}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">{progressLabel(progress)}</p>
            </div>
          ) : (
            <button onClick={() => void install()} className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">
              {status.installed ? "Descargar modelo preciso" : "Descargar reconocimiento de voz"}
            </button>
          )}
        </div>
      )}
      {status?.installed && (
        <Row title="Activar con “Oye Scorpk”" subtitle="Escucha en segundo plano y abre el asistente flotante.">
          <Switch checked={wake} onChange={(v) => void toggleWake(v)} label="Activar con Oye Scorpk" />
        </Row>
      )}
      <Row title="Respuesta por voz" subtitle="El asistente flotante lee sus respuestas en voz alta.">
        <Switch
          checked={voiceReply}
          onChange={(v) => {
            setVoiceReply(v);
            setVoiceReplyEnabled(v);
          }}
          label="Respuesta por voz"
        />
      </Row>
      {message && <p className="px-4 py-3 text-sm text-red-400">{message}</p>}
    </Group>
  );
}

function progressLabel(progress: InstallProgress | null): string {
  if (!progress) return "Preparando…";
  const names: Record<InstallProgress["stage"], string> = {
    motor: "Motor de voz",
    modelo: "Modelo en español",
    "preciso-motor": "Motor preciso",
    "preciso-modelo": "Modelo preciso",
  };
  return `${names[progress.stage]}: ${progress.percent}%`;
}

function GeneralGroup() {
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    autostartEnabled()
      .then(setAutostartState)
      .catch(() => setAutostartState(false));
  }, []);

  async function toggle(next: boolean) {
    setMessage(null);
    setAutostartState(next);
    try {
      await setAutostart(next);
    } catch (error) {
      setAutostartState(!next);
      setMessage(errorText(error, "No pude cambiar el inicio con Windows."));
    }
  }

  return (
    <Group title="General">
      <Row title="Iniciar con Windows" subtitle="Scorpk arranca minimizado en la bandeja: “Oye Scorpk” y Ctrl+Alt+Espacio siempre listos.">
        <Switch checked={autostart ?? false} disabled={autostart === null} onChange={(v) => void toggle(v)} label="Iniciar con Windows" />
      </Row>
      <Row title="Asistente flotante" subtitle="Ábrelo desde cualquier programa con Ctrl+Alt+Espacio. Esc para cerrarlo." />
      {message && <p className="px-4 py-3 text-sm text-red-400">{message}</p>}
    </Group>
  );
}

function PrivacyGroup({ onClearHistory }: { onClearHistory: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Group title="Privacidad" footer="El historial de chats se guarda solo en este equipo.">
      <Row title="Borrar historial" subtitle={done ? "Historial borrado." : "Elimina todas las conversaciones de esta cuenta en este equipo."}>
        {confirming ? (
          <span className="flex gap-2">
            <button onClick={() => setConfirming(false)} className="rounded-full border border-border px-3 py-1.5 text-xs">
              Cancelar
            </button>
            <button
              onClick={() => {
                onClearHistory();
                setConfirming(false);
                setDone(true);
              }}
              className="rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Borrar
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} className="rounded-full border border-border px-4 py-1.5 text-xs text-red-400 hover:border-red-400">
            Borrar
          </button>
        )}
      </Row>
    </Group>
  );
}

function Group({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted">{title}</h2>
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-card">{children}</div>
      {footer && <p className="mt-2 px-1 text-xs text-muted">{footer}</p>}
    </section>
  );
}

function Row({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{title}</p>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition disabled:opacity-40 ${checked ? "bg-accent" : "bg-border"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
