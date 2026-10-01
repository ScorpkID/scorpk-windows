import { useCallback, useEffect, useState } from "react";
import {
  clearHistory,
  deleteConversation,
  loadConversations,
  newConversationId,
  saveConversation,
  type Conversation,
} from "../data/history";
import type { ChatMessage } from "../domain/model";
import { onVoiceEvent } from "../voice/voiceApi";
import Chat from "./Chat";
import Settings from "./Settings";

interface Props {
  userId: string;
  email: string;
  isPro: boolean;
  onRefreshPlan: () => Promise<void>;
  onSignOut: () => void;
}

type View = "chat" | "settings";

/** Ventana principal: menú lateral (historial, Configuración, cuenta) + chat o configuración. */
export default function Home({ userId, email, isPro, onRefreshPlan, onSignOut }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations(userId));
  const [active, setActive] = useState<{ id: string; messages: ChatMessage[] }>(() => ({ id: newConversationId(), messages: [] }));
  const [view, setView] = useState<View>("chat");
  const [menuOpen, setMenuOpen] = useState(false);

  // El overlay puede pedir abrir los ajustes de voz (p. ej. si falta descargar el motor).
  useEffect(() => {
    const unlisten = onVoiceEvent("open-voice-settings", () => setView("settings"));
    return () => void unlisten.then((fn) => fn());
  }, []);

  const save = useCallback(
    (id: string, messages: ChatMessage[]) => setConversations(saveConversation(userId, id, messages)),
    [userId],
  );

  function open(conversation: Conversation | null) {
    setActive(conversation ? { id: conversation.id, messages: conversation.messages } : { id: newConversationId(), messages: [] });
    setView("chat");
    setMenuOpen(false);
  }

  function remove(id: string) {
    setConversations(deleteConversation(userId, id));
    if (id === active.id) open(null);
  }

  return (
    <div className="flex h-full">
      {menuOpen && <div className="fixed inset-0 z-10 bg-black/60 md:hidden" onClick={() => setMenuOpen(false)} />}
      <aside
        className={`fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-border bg-black transition-transform md:static md:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <img src="/scorpk-icon.png" alt="" className="h-8 w-8 rounded-lg" />
          <div>
            <p className="text-sm font-semibold leading-tight">Scorpk</p>
            <p className="text-xs text-muted">Asistente personal</p>
          </div>
        </div>
        <div className="px-3">
          <button
            onClick={() => open(null)}
            className="flex w-full items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5 text-sm hover:border-accent"
          >
            <span className="text-lg leading-none">+</span> Nueva consulta
          </button>
        </div>

        <p className="px-4 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted">Historial</p>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 && <p className="px-2 py-2 text-xs text-muted">Tus conversaciones aparecerán aquí.</p>}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center rounded-xl ${c.id === active.id && view === "chat" ? "bg-card" : "hover:bg-card/60"}`}
            >
              <button onClick={() => open(c)} className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm" title={c.title}>
                {c.title}
              </button>
              <button
                onClick={() => remove(c.id)}
                className="px-2 text-muted opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                aria-label={`Eliminar «${c.title}»`}
                title="Eliminar"
              >
                ×
              </button>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-2">
          <button
            onClick={() => {
              setView("settings");
              setMenuOpen(false);
            }}
            className={`w-full rounded-xl px-2.5 py-2 text-left text-sm ${view === "settings" ? "bg-card" : "hover:bg-card/60"}`}
          >
            Configuración
          </button>
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className="min-w-0 flex-1 truncate text-xs text-muted" title={email}>
              {email}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">{isPro ? "Pro" : "Free"}</span>
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        {view === "settings" ? (
          <Settings
            email={email}
            isPro={isPro}
            onBack={() => setView("chat")}
            onSignOut={onSignOut}
            onClearHistory={() => {
              clearHistory(userId);
              setConversations([]);
              open(null);
              setView("settings");
            }}
          />
        ) : (
          <Chat
            key={active.id}
            conversationId={active.id}
            initialMessages={active.messages}
            isPro={isPro}
            onRefreshPlan={onRefreshPlan}
            onSignOut={onSignOut}
            onSave={save}
            onOpenMenu={() => setMenuOpen(true)}
          />
        )}
      </section>
    </div>
  );
}
