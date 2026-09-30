/** Abre una URL en el navegador del sistema (Tauri) o en una pestaña nueva si se ejecuta en un navegador. */
export async function openExternal(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export const PRICING_URL = "https://scorpk.tech/pricing";
export const PRIVACY_URL = "https://scorpk.tech/privacy";
export const TERMS_URL = "https://scorpk.tech/terms";
