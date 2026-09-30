import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createProcessor } from "../app/processor";
import { supabase } from "../data/supabase";
import { DEFAULT_CHAT_MODEL } from "../domain/model";
import { tauriBridge } from "../domain/nativeBridge";
import { speak, stopSpeaking } from "../domain/speechText";
import { openExternal, PRICING_URL } from "../util/openExternal";

type Reply = { text: string; tone: "ok" | "error" | "pro" | "login" };

/** Tarjeta flotante del asistente (ventana "overlay"): escribe una orden, Enter para ejecutarla, Esc para cerrar. */
export default function Overlay() {
  const processor = useMemo(createProcessor, []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const hide = useCallback(() => {
    stopSpeaking();
    void tauriBridge.invoke("overlay_hide").catch(() => {});
  }, []);

  // Cada vez que Rust muestra el overlay: limpia y enfoca el campo de texto.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const reset = () => {
      setInput("");
      setReply(null);
      setBusy(false);
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    stopSpeaking();
    setInput("");
    setBusy(true);
    setReply(null);

    const session = (await supabase?.auth.getSession())?.data.session;
    const result = await processor.process(text, [], DEFAULT_CHAT_MODEL);
    setBusy(false);

    if (result.ok) {
      setReply({ text: result.text, tone: "ok" });
      speak(result.speech);
    } else if (result.error === "pro_required") {
      setReply({ text: "La IA es parte del plan Pro. Los comandos locales son gratis.", tone: "pro" });
    } else if (result.error === "not_signed_in" || !session) {
      setReply({ text: "Inicia sesión en Scorpk para usar la IA. Los comandos locales funcionan sin cuenta.", tone: "login" });
    } else {
      setReply({ text: result.text, tone: "error" });
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") hide();
  }

  return (
    <div className="flex h-full items-end justify-center p-3" onKeyDown={onKeyDown}>
      <div
        ref={cardRef}
        className={`appear w-full rounded-[28px] border bg-card/95 p-3 backdrop-blur ${
          busy ? "border-accent shadow-[0_0_28px_#7c8cff55]" : "border-border shadow-[0_8px_40px_#000000aa]"
        } transition-shadow`}
      >
        {reply && (
          <div className="mb-2 px-3 pt-2 text-sm leading-relaxed">
            <p className={`whitespace-pre-wrap ${reply.tone === "error" ? "text-red-400" : ""}`}>{reply.text}</p>
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
        {busy && <p className="px-3 pb-2 text-sm text-muted">Pensando…</p>}
        <form onSubmit={submit} className="flex items-center gap-2 rounded-full border border-border bg-black/40 py-1.5 pl-4 pr-1.5">
          <img src="/scorpk-icon.png" alt="" className="h-5 w-5 rounded-md" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pídeme algo…  (Esc para cerrar)"
            autoFocus
            spellCheck={false}
            className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted"
          />
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
