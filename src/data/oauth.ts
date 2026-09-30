import { supabase } from "./supabase";
import { openExternal } from "../util/openExternal";

/** URL a la que vuelve el login de Google/GitHub. Debe estar registrada en Supabase → Auth → URL Configuration. */
export const OAUTH_REDIRECT = "scorpk://auth/callback";

export type OAuthProvider = "google" | "github";

export interface OAuthStart {
  error: string | null;
  /** Enlace de login; si el navegador no se pudo abrir, la pantalla lo muestra para copiarlo. */
  url: string | null;
  opened: boolean;
}

/** Abre el login del proveedor en el navegador del sistema (PKCE). El retorno llega por deep link. */
export async function startOAuth(provider: OAuthProvider): Promise<OAuthStart> {
  if (!supabase) return { error: "Falta la configuración de Supabase.", url: null, opened: false };
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: OAUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    return { error: error?.message ?? "No se pudo iniciar el login.", url: null, opened: false };
  }
  return { error: null, url: data.url, opened: await openExternal(data.url) };
}

/** Intercambia el código PKCE que llega en scorpk://auth/callback?code=... por una sesión. */
export async function completeOAuth(callbackUrl: string): Promise<string | null> {
  if (!supabase) return "Falta la configuración de Supabase.";
  const code = new URL(callbackUrl).searchParams.get("code");
  if (!code) return "El enlace de retorno no trae código de acceso.";
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return error?.message ?? null;
}

/** Escucha los deep links scorpk://... (solo dentro de Tauri; en el navegador no hace nada). */
export async function listenForAuthCallback(onResult: (error: string | null) => void): Promise<() => void> {
  try {
    const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
    const unlisten = await onOpenUrl((urls) => {
      const callback = urls.find((url) => url.startsWith(OAUTH_REDIRECT));
      if (callback) void completeOAuth(callback).then(onResult);
    });
    return unlisten;
  } catch {
    return () => {};
  }
}
