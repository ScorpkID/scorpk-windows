/**
 * Abre una URL en el navegador del sistema. Devuelve false si no se pudo (para poder mostrar el
 * enlace al usuario en vez de fallar en silencio). Fuera de Tauri usa una pestaña nueva.
 */
export async function openExternal(url: string): Promise<boolean> {
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return true;
    } catch (error) {
      console.error("No se pudo abrir el enlace", error);
      return false;
    }
  }
  return window.open(url, "_blank", "noopener,noreferrer") !== null;
}

export const PRICING_URL = "https://scorpk.tech/pricing";
export const PRIVACY_URL = "https://scorpk.tech/privacy";
export const TERMS_URL = "https://scorpk.tech/terms";
