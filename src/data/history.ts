import type { ChatMessage } from "../domain/model";

/**
 * Historial de conversaciones del chat, guardado solo en este equipo y por cuenta (como la base Room
 * local de Android). Nunca se envía a ningún servidor ni se escribe en logs. Se puede borrar desde
 * Configuración.
 */
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const MAX_CONVERSATIONS = 100;
export const MAX_MESSAGES = 200;
const TITLE_CHARS = 48;

const keyFor = (userId: string) => `scorpk.history.${userId}`;

function defaultStore(): Store | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Conversaciones de la cuenta, de la más reciente a la más antigua. */
export function loadConversations(userId: string, store: Store | null = defaultStore()): Conversation[] {
  try {
    const raw = store?.getItem(keyFor(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as Conversation[])
      .filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function persist(userId: string, conversations: Conversation[], store: Store | null): Conversation[] {
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
  try {
    store?.setItem(keyFor(userId), JSON.stringify(sorted));
  } catch {
    /* almacenamiento lleno o bloqueado: el historial de esta sesión sigue en memoria */
  }
  return sorted;
}

/** Título a partir del primer mensaje del usuario. */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= TITLE_CHARS) return clean || "Nueva consulta";
  return `${clean.slice(0, TITLE_CHARS - 1).trimEnd()}…`;
}

/** Crea o actualiza una conversación con sus mensajes. Devuelve la lista nueva. */
export function saveConversation(
  userId: string,
  id: string,
  messages: ChatMessage[],
  store: Store | null = defaultStore(),
  now = Date.now(),
): Conversation[] {
  const all = loadConversations(userId, store);
  const existing = all.find((c) => c.id === id);
  const firstUser = messages.find((m) => m.role === "user");
  const conversation: Conversation = {
    id,
    title: existing?.title ?? titleFrom(firstUser?.text ?? ""),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: messages.slice(-MAX_MESSAGES),
  };
  return persist(userId, [conversation, ...all.filter((c) => c.id !== id)], store);
}

export function deleteConversation(userId: string, id: string, store: Store | null = defaultStore()): Conversation[] {
  return persist(userId, loadConversations(userId, store).filter((c) => c.id !== id), store);
}

export function clearHistory(userId: string, store: Store | null = defaultStore()): void {
  try {
    store?.removeItem(keyFor(userId));
  } catch {
    /* nada que borrar */
  }
}

export const newConversationId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
