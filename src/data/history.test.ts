import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../domain/model";
import { clearHistory, deleteConversation, loadConversations, MAX_CONVERSATIONS, saveConversation, titleFrom } from "./history";

function memoryStore() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const msg = (role: "user" | "assistant", text: string): ChatMessage => ({ id: text, role, text });

describe("historial local", () => {
  it("crea la conversación con el primer mensaje como título y la actualiza sin cambiarlo", () => {
    const store = memoryStore();
    saveConversation("u1", "c1", [msg("user", "abre la calculadora"), msg("assistant", "Listo")], store, 1);
    const list = saveConversation("u1", "c1", [msg("user", "abre la calculadora"), msg("user", "y el bloc")], store, 2);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "abre la calculadora", createdAt: 1, updatedAt: 2 });
    expect(list[0].messages).toHaveLength(2);
  });

  it("ordena por la más reciente y separa por cuenta", () => {
    const store = memoryStore();
    saveConversation("u1", "a", [msg("user", "a")], store, 1);
    saveConversation("u1", "b", [msg("user", "b")], store, 2);
    saveConversation("u2", "x", [msg("user", "x")], store, 3);
    expect(loadConversations("u1", store).map((c) => c.id)).toEqual(["b", "a"]);
    expect(loadConversations("u2", store).map((c) => c.id)).toEqual(["x"]);
  });

  it("borra una o todas, y tolera datos corruptos", () => {
    const store = memoryStore();
    saveConversation("u1", "a", [msg("user", "a")], store, 1);
    saveConversation("u1", "b", [msg("user", "b")], store, 2);
    expect(deleteConversation("u1", "a", store).map((c) => c.id)).toEqual(["b"]);
    clearHistory("u1", store);
    expect(loadConversations("u1", store)).toEqual([]);
    store.setItem("scorpk.history.u1", "{no es json");
    expect(loadConversations("u1", store)).toEqual([]);
  });

  it("limita el número de conversaciones", () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_CONVERSATIONS + 5; i++) saveConversation("u1", `c${i}`, [msg("user", `${i}`)], store, i);
    const list = loadConversations("u1", store);
    expect(list).toHaveLength(MAX_CONVERSATIONS);
    expect(list[0].id).toBe(`c${MAX_CONVERSATIONS + 4}`);
  });

  it("acorta títulos largos", () => {
    expect(titleFrom("  hola   mundo ")).toBe("hola mundo");
    expect(titleFrom("x".repeat(80))).toHaveLength(48);
    expect(titleFrom("")).toBe("Nueva consulta");
  });
});
