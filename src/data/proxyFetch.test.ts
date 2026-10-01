import { describe, expect, it, vi } from "vitest";
import { createProxyFetch } from "./proxyFetch";
import type { NativeBridge } from "../domain/nativeBridge";

const bridge = (impl: (command: string, args?: Record<string, unknown>) => unknown) =>
  ({ invoke: vi.fn(async (c: string, a?: Record<string, unknown>) => impl(c, a)) }) as unknown as NativeBridge & {
    invoke: ReturnType<typeof vi.fn>;
  };

const call = (fetchFn: typeof fetch) =>
  fetchFn("https://scorpk.tech/api/ai/chat", {
    method: "POST",
    headers: { Authorization: "Bearer tok123", "Content-Type": "application/json" },
    body: '{"a":1}',
  });

describe("createProxyFetch", () => {
  it("en Tauri delega en Rust con el token y el cuerpo, y devuelve la respuesta con su código", async () => {
    const native = bridge(() => ({ status: 402, body: '{"error":{"message":"Pro"}}' }));
    const response = await call(createProxyFetch(native, () => true));
    expect(native.invoke).toHaveBeenCalledWith("ai_chat", { token: "tok123", body: '{"a":1}' });
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: { message: "Pro" } });
  });

  it("un fallo de Rust se convierte en error de red", async () => {
    const native = bridge(() => {
      throw "network";
    });
    await expect(call(createProxyFetch(native, () => true))).rejects.toThrow(TypeError);
  });

  it("fuera de Tauri usa el fetch normal", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    const native = bridge(() => ({}));
    const response = await call(createProxyFetch(native, () => false));
    expect(await response.text()).toBe("ok");
    expect(native.invoke).not.toHaveBeenCalled();
    globalThis.fetch = original;
  });
});
