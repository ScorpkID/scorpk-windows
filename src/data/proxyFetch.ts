import { tauriBridge } from "../domain/nativeBridge";
import type { NativeBridge } from "../domain/nativeBridge";

/**
 * `fetch` para el proxy de IA. Dentro de la app de escritorio la petición la hace Rust
 * (comando `ai_chat`) porque el servidor no envía cabeceras CORS y la ventana la bloquearía.
 * Fuera de Tauri (navegador, pruebas) usa el fetch normal.
 */
export function createProxyFetch(bridge: NativeBridge = tauriBridge, inTauri = () => "__TAURI_INTERNALS__" in window): typeof fetch {
  return async (input, init) => {
    if (!inTauri()) return fetch(input, init);

    const headers = new Headers(init?.headers);
    const token = headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const body = typeof init?.body === "string" ? init.body : "";
    try {
      const result = await bridge.invoke<{ status: number; body: string }>("ai_chat", { token, body });
      return new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json" } });
    } catch {
      // Un fallo de red real: el intérprete lo traduce a "No pude conectarme".
      throw new TypeError("network");
    }
  };
}
