import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Solo la URL y la anon key públicas: por diseño pueden ir en el cliente. Null si falta configuración. */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      })
    : null;
