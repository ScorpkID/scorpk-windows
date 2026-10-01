import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createProcessor } from "../app/processor";
import { chatModel, setChatModel } from "../data/settings";
import { AI_MODELS, DEFAULT_CHAT_MODEL, type ChatMessage } from "../domain/model";
import { openExternal, PRICING_URL } from "../util/openExternal";

interface Props {
  conversationId: string;
  initialMessages: ChatMessage[];
  isPro: boolean;
  onRefreshPlan: () => Promise<void>;
  onSignOut: () => void;
  /** Guarda la conversación en el historial tras cada intercambio. */
  onSave: (id: string, messages: ChatMessage[]) => void;
  onOpenMenu: () => void;
}

const WELCOME =
  "¡Hola! Soy Scorpk. Puedo abrir programas, controlar el volumen y la música, poner temporizadores y más. Prueba con “abre la calculadora”, o pulsa Ctrl+Alt+Espacio desde cualquier programa para abrir el asistente flotante.";

const SUGGESTIONS = ["Abre la calculadora", "Sube el volumen al 50 %", "Pon un temporizador de 5 minutos", "¿Cuánta batería me queda?"];

let nextId = 0;
const newId = () => `m${Date.now()}-${nextId++}`;

export default function Chat({ conversationId, initialMessages, isPro, onRefreshPlan, onSignOut, onSave, onOpenMenu }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [modelId, setModelId] = useState(() => chatModel().id);
  const [needsPro, setNeedsPro] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const processor = useMemo(createProcessor, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;

    const history = messages.filter((m) => !m.kind).map((m) => ({ role: m.role, text: m.text }));
    const withUser = [...messages, { id: newId(), role: "user" as const, text }];
    setInput("");
    setNeedsPro(false);
    setMessages(withUser);
    setBusy(true);

    const model = AI_MODELS.find((m) => m.id === modelId) ?? DEFAULT_CHAT_MODEL;
    const result = await processor.process(text, history, model);
    setBusy(false);

    let reply: ChatMessage | null = null;
    if (result.ok) {
      reply = { id: newId(), role: "assistant", text: result.text, kind: result.kind };
    } else if (result.error === "pro_required") {
      setNeedsPro(true);
      void onRefreshPlan();
    } else {
      if (result.error === "not_signed_in") setSessionExpired(true);
      reply = { id: newId(), role: "assistant", text: result.text, kind: "error" };
    }
    const next = reply ? [...withUser, reply] : withUser;
    setMessages(next);
    onSave(conversationId, next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button onClick={onOpenMenu} className="text-muted hover:text-white md:hidden" aria-label="Abrir menú">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value);
            setChatModel(e.target.value);
          }}
          className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted outline-none"
          aria-label="Modelo de IA"
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-xs text-muted">{isPro ? "Pro" : "Free"}</span>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.length === 0 && (
            <div className="appear flex flex-col gap-4">
              <Bubble message={{ id: "welcome", role: "assistant", text: WELCOME }} />
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-white"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
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

      <form onSubmit={submit} className="px-4 pb-4">
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-3xl border border-border bg-card py-2 pl-5 pr-2">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía; Mayús+Enter hace salto de línea.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder="Escribe un mensaje…"
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-sm outline-none field-sizing-content placeholder:text-muted"
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
        className={`max-w-[85%] select-text whitespace-pre-wrap rounded-card px-4 py-2.5 text-sm leading-relaxed ${
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
