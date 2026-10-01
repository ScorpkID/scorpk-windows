import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createProcessor } from "../app/processor";
import { supabase } from "../data/supabase";
import { voiceReplyEnabled } from "../data/settings";
import { DEFAULT_CHAT_MODEL } from "../domain/model";
import { tauriBridge } from "../domain/nativeBridge";
import { speak, stopSpeaking } from "../domain/speechText";
import {
  errorText,
  onVoiceEvent,
  pauseListening,
  resumeWake,
  setWake,
  startListening,
  wakePreference,
} from "../voice/voiceApi";
import { openExternal, PRICING_URL } from "../util/openExternal";

type Reply = { text: string; tone: "ok" | "error" | "pro" | "login" | "voice-setup" };

/** Tarjeta flotante del asistente (ventana "overlay"): escribe o habla una orden, Enter para ejecutarla, Esc para cerrar. */
export default function Overlay() {
  const processor = useMemo(createProcessor, []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  // Whisper está transcribiendo la frase completa (1-2 s): el texto en vivo de Vosk es solo orientativo.
  const [transcribing, setTranscribing] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  const hide = useCallback(() => {
    stopSpeaking();
    void tauriBridge.invoke("overlay_hide").catch(() => {});
  }, []);

  /** Ejecuta una orden (escrita o dicha) y lee la respuesta; al terminar vuelve a esperar "Oye Scorpk". */
  const run = useCallback(
    async (raw: string, fromVoice = false) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      stopSpeaking();
      setInput("");
      setListening(false);
      setBusy(true);
      setReply(null);
      // El micrófono se pausa mientras se procesa y habla para que Scorpk no se oiga a sí mismo.
      void pauseListening().catch(() => {});

      const session = (await supabase?.auth.getSession())?.data.session;
      const result = await processor.process(text, [], DEFAULT_CHAT_MODEL, { mode: "voice", fromVoice });
      busyRef.current = false;
      setBusy(false);

      const done = () => void resumeWake().catch(() => {});
      if (result.ok) {
        setReply({ text: result.text, tone: "ok" });
        if (voiceReplyEnabled()) speak(result.speech, done);
        else done();
        return;
      }
      if (result.error === "pro_required") {
        setReply({ text: "La IA es parte del plan Pro. Los comandos locales son gratis.", tone: "pro" });
      } else if (result.error === "not_signed_in" || !session) {
        setReply({ text: "Inicia sesión en Scorpk para usar la IA. Los comandos locales funcionan sin cuenta.", tone: "login" });
      } else {
        setReply({ text: result.text, tone: "error" });
      }
      done();
    },
    [processor],
  );

  // Cada vez que Rust muestra el overlay: limpia y enfoca el campo de texto.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const reset = () => {
      setInput("");
      setReply(null);
      setBusy(false);
      busyRef.current = false;
      setListening(false);
      setTranscribing(false);
      inputRef.current?.focus();
    };
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen("overlay-shown", reset))
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    reset();
    return () => unlisten?.();
  }, []);

  // Eventos de voz del motor: "Oye Scorpk" detectado, transcripción parcial y frase final.
  useEffect(() => {
    const unlisteners: Promise<() => void>[] = [
      onVoiceEvent("voice-wake", () => setListening(true)),
      onVoiceEvent<string>("voice-partial", (text) => setInput(text)),
      onVoiceEvent("voice-transcribing", () => setTranscribing(true)),
      onVoiceEvent<string>("voice-final", (text) => {
        setTranscribing(false);
        setInput(text);
        void run(text, true);
      }),
      onVoiceEvent("voice-timeout", () => {
        setTranscribing(false);
        setListening(false);
        setInput("");
      }),
      onVoiceEvent<string>("voice-error", (message) => {
        setTranscribing(false);
        setListening(false);
        setReply({ text: message, tone: "error" });
      }),
    ];
    return () => unlisteners.forEach((p) => void p.then((fn) => fn()));
  }, [run]);

  // Al iniciar la app, se aplica la preferencia guardada de "Oye Scorpk".
  useEffect(() => {
    if (wakePreference()) void setWake(true).catch(() => {});
  }, []);

  // La ventana se ajusta a la altura de la tarjeta (queda anclada abajo).
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const fit = () => void tauriBridge.invoke("overlay_fit", { height: Math.ceil(card.offsetHeight) + 24 }).catch(() => {});
    const observer = new ResizeObserver(fit);
    observer.observe(card);
    fit();
    return () => observer.disconnect();
  }, []);

  async function toggleMic() {
    if (listening) {
      setListening(false);
      void resumeWake().catch(() => {});
      return;
    }
    try {
      await startListening();
      setReply(null);
      setListening(true);
    } catch (error) {
      const text = errorText(error, "No pude usar el micrófono.");
      // Falta el motor: en vez de un error, se ofrece abrir directamente los ajustes de voz.
      setReply(
        text.includes("motor de voz")
          ? { text: "Para hablarme, primero hay que descargar el reconocimiento de voz (una sola vez).", tone: "voice-setup" }
          : { text, tone: "error" },
      );
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(input);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") hide();
  }

  const glow = busy || listening;
  return (
    <div className="flex h-full items-end justify-center p-3" onKeyDown={onKeyDown}>
      <div
        ref={cardRef}
        className={`appear w-full rounded-[28px] border bg-card/95 p-3 backdrop-blur ${
          glow ? "border-accent shadow-[0_0_28px_#7c8cff55]" : "border-border shadow-[0_8px_40px_#000000aa]"
        } transition-shadow`}
      >
        {reply && (
          <div className="mb-2 px-3 pt-2 text-sm leading-relaxed">
            <p className={`whitespace-pre-wrap ${reply.tone === "error" ? "text-red-400" : ""}`}>{reply.text}</p>
            {reply.tone === "voice-setup" && (
              <button
                onClick={() => void tauriBridge.invoke("open_voice_settings").catch(() => {})}
                className="mt-2 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black"
              >
                Abrir configuración de voz
              </button>
            )}
            {reply.tone === "pro" && (
              <button
                onClick={() => void openExternal(PRICING_URL)}
                className="mt-2 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black"
              >
                Ver plan Pro
              </button>
            )}
          </div>
        )}
        {transcribing && <p className="px-3 pb-2 text-sm text-muted">Entendiendo lo que dijiste…</p>}
        {busy && <p className="px-3 pb-2 text-sm text-muted">Pensando…</p>}
        <form onSubmit={submit} className="flex items-center gap-2 rounded-full border border-border bg-black/40 py-1.5 pl-4 pr-1.5">
          <img src="/scorpk-icon.png" alt="" className="h-5 w-5 rounded-md" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? "Te escucho…" : "Pídeme algo…  (Esc para cerrar)"}
            autoFocus
            spellCheck={false}
            className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => void toggleMic()}
            title={listening ? "Dejar de escuchar" : "Hablar"}
            aria-label={listening ? "Dejar de escuchar" : "Hablar"}
            className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
              listening ? "animate-pulse border-accent bg-accent/20 text-white" : "border-border text-muted hover:text-white"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          <button
            type="submit"
            disabled={busy || input.trim() === ""}
            className="rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-black transition disabled:opacity-30"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
