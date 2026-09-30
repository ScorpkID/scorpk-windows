import { supabase } from "./supabase";
import { openExternal } from "../util/openExternal";
import { tauriBridge } from "../domain/nativeBridge";

/**
 * Login con Google, GitHub o correo en el navegador, sin tocar la lista de Redirect URLs de Supabase.
 * Es el mismo flujo del CLI de Scorpk (ver src-tauri/src/commands/login.rs): la web devuelve un código
 * de un solo uso a un servidor local efímero, Rust lo canjea y aquí se fija la sesión.
 */
export interface BrowserLogin {
  /** Enlace de login; si el navegador no se pudo abrir, la pantalla lo muestra para copiarlo. */
  url: string;
  opened: boolean;
  /** Se resuelve cuando el usuario termina en el navegador: null = sesión iniciada, texto = error. */
  completion: Promise<string | null>;
}

interface LoginTokens {
  accessToken: string;
  refreshToken: string;
}

export async function startBrowserLogin(): Promise<BrowserLogin> {
  const { url } = await tauriBridge.invoke<{ url: string }>("login_prepare");
  const opened = await openExternal(url);

  const completion = (async (): Promise<string | null> => {
    try {
      const tokens = await tauriBridge.invoke<LoginTokens>("login_wait");
      if (!supabase) return "Falta la configuración de Supabase.";
      const { error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      return error ? "No se pudo iniciar la sesión. Inténtalo de nuevo." : null;
    } catch (error) {
      return typeof error === "string" ? error : "No se pudo completar el inicio de sesión.";
    }
  })();

  return { url, opened, completion };
}
