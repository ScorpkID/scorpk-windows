import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createProcessor } from "../app/processor";
import { AI_MODELS, DEFAULT_CHAT_MODEL, type ChatMessage } from "../domain/model";
import { openExternal, PRICING_URL } from "../util/openExternal";
import { onVoiceEvent } from "../voice/voiceApi";
import VoiceSettings from "./VoiceSettings";

interface Props {
  email: string;
  isPro: boolean;
  onRefreshPlan: () => Promise<void>;
  onSignOut: () => void;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "¡Hola! Soy Scorpk. Puedo abrir programas, controlar el volumen y la música, poner temporizadores y más. Prueba con “abre la calculadora”, o pulsa Ctrl+Alt+Espacio desde cualquier programa para abrir el asistente flotante.",
};

let nextId = 0;
const newId = () => `m${Date.now()}-${nextId++}`;

export default function Chat({ email, isPro, onRefreshPlan, onSignOut }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [modelId, setModelId] = useState(DEFAULT_CHAT_MODEL.id);
  const [needsPro, setNeedsPro] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const processor = useMemo(createProcessor, []);

  // El overlay puede pedir abrir los ajustes de voz (p. ej. si falta descargar el motor).
  useEffect(() => {
    const unlisten = onVoiceEvent("open-voice-settings", () => setVoiceOpen(true));
    return () => void unlisten.then((fn) => fn());
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const history = messages
      .filter((m) => m.id !== WELCOME.id && !m.kind)
      .map((m) => ({ role: m.role, text: m.text }));
    setInput("");
    setNeedsPro(false);
    setMessages((prev) => [...prev, { id: newId(), role: "user", text }]);
    setBusy(true);

    const model = AI_MODELS.find((m) => m.id === modelId) ?? DEFAULT_CHAT_MODEL;
    const result = await processor.process(text, history, model);
    setBusy(false);

    if (result.ok) {
      setMessages((prev) => [...prev, { id: newId(), role: "assistant", text: result.text, kind: result.kind }]);
      return;
    }
    if (result.error === "pro_required") {
      setNeedsPro(true);
      void onRefreshPlan();
      return;
    }
    if (result.error === "not_signed_in") setSessionExpired(true);
    setMessages((prev) => [...prev, { id: newId(), role: "assistant", text: result.text, kind: "error" }]);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <img src="/scorpk-icon.png" alt="" className="h-7 w-7 rounded-lg" />
        <span className="font-semibold">Scorpk</span>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className="ml-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted outline-none"
          aria-label="Modelo de IA"
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="ml-auto flex items-center gap-3 text-xs text-muted">
          <span className="rounded-full border border-border px-2 py-0.5">{isPro ? "Pro" : "Free"}</span>
          <span className="hidden sm:inline">{email}</span>
          <button onClick={() => setVoiceOpen(true)} className="hover:text-white">
            Voz
          </button>
          <button onClick={onSignOut} className="hover:text-white">
            Salir
          </button>
        </span>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
          {busy && <p className="appear text-sm text-muted">Pensando…</p>}
          {needsPro && <ProCard />}
          {sessionExpired && (
            <p className="text-center text-sm text-muted">
              Tu sesión venció.{" "}
              <button className="underline" onClick={onSignOut}>
                Inicia sesión de nuevo
              </button>
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </main>

      {voiceOpen && <VoiceSettings onClose={() => setVoiceOpen(false)} />}

      <form onSubmit={send} className="px-4 pb-4">
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-full border border-border bg-card py-2 pl-5 pr-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe un mensaje…"
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={busy || input.trim() === ""}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition disabled:opacity-30"
          >
            Enviar
          </button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  if (message.kind === "error") {
    return <p className="appear text-center text-sm text-red-400">{message.text}</p>;
  }
  return (
    <div className={`appear flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-[20px] px-4 py-2.5 text-sm leading-relaxed ${
          isUser ? "bg-bubble" : message.kind === "notice" ? "border border-border bg-card text-muted" : "bg-card"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}

function ProCard() {
  return (
    <div className="appear rounded-card border border-border bg-card p-5 text-center">
      <p className="font-semibold">La IA de Scorpk es parte del plan Pro</p>
      <p className="mt-1 text-sm text-muted">
        Los comandos locales y los conectores son gratis. Para conversar con la IA necesitas Pro.
      </p>
      <button
        onClick={() => void openExternal(PRICING_URL)}
        className="mt-4 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
      >
        Ver plan Pro
      </button>
    </div>
  );
}
