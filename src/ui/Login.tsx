import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../data/supabase";
import { startBrowserLogin } from "../data/oauth";
import { NativeUnavailableError } from "../domain/nativeBridge";
import { openExternal, PRIVACY_URL, TERMS_URL } from "../util/openExternal";

type Mode = "signin" | "signup";

export default function Login() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // La espera del navegador va aparte: no debe bloquear el login con correo y se puede cancelar.
  const [waitingBrowser, setWaitingBrowser] = useState(false);
  const browserAttempt = useRef(0);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [manualLink, setManualLink] = useState<string | null>(null);

  if (!supabase) {
    return (
      <Shell>
        <p className="text-center text-sm text-muted">
          Falta la configuración de la cuenta (VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env).
        </p>
      </Shell>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase || busy) return;
    if (waitingBrowser) cancelBrowserLogin();
    setBusy(true);
    setMessage(null);
    const credentials = { email: email.trim(), password };
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword(credentials);
      if (error) setMessage({ text: friendly(error.message), error: true });
    } else {
      const { data, error } = await supabase.auth.signUp(credentials);
      if (error) setMessage({ text: friendly(error.message), error: true });
      else if (!data.session) setMessage({ text: "Te enviamos un correo para confirmar tu cuenta.", error: false });
    }
    setBusy(false);
  }

  async function browserLogin() {
    if (busy || waitingBrowser) return;
    const attempt = ++browserAttempt.current;
    const current = () => attempt === browserAttempt.current;
    setWaitingBrowser(true);
    setMessage(null);
    setManualLink(null);
    try {
      const login = await startBrowserLogin();
      if (!current()) return;
      if (login.opened) {
        setMessage({ text: "Termina el inicio de sesión en tu navegador y vuelve aquí.", error: false });
      } else {
        setManualLink(login.url);
        setMessage({ text: "No pude abrir el navegador. Copia este enlace y ábrelo tú:", error: true });
      }
      const error = await login.completion;
      if (!current()) return;
      if (error) {
        setManualLink(null);
        setMessage({ text: error, error: true });
      }
    } catch (error) {
      const text =
        error instanceof NativeUnavailableError ? error.message : "No se pudo iniciar el login en el navegador.";
      if (current()) setMessage({ text, error: true });
    } finally {
      if (current()) setWaitingBrowser(false);
    }
  }

  function cancelBrowserLogin() {
    browserAttempt.current++;
    setWaitingBrowser(false);
    setManualLink(null);
    setMessage(null);
  }

  return (
    <Shell>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="Correo electrónico"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition disabled:opacity-50"
        >
          {busy ? "Un momento…" : mode === "signin" ? "Iniciar sesión" : "Crear cuenta"}
        </button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />o<span className="h-px flex-1 bg-border" />
      </div>

      <button
        onClick={() => void browserLogin()}
        disabled={busy || waitingBrowser}
        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm hover:border-accent disabled:opacity-50"
      >
        {waitingBrowser ? "Esperando al navegador…" : "Continuar con Google o GitHub"}
      </button>
      {waitingBrowser && (
        <button onClick={cancelBrowserLogin} className="mt-2 w-full text-center text-xs text-muted hover:text-white">
          Cancelar
        </button>
      )}

      {message && (
        <p className={`mt-4 text-center text-sm ${message.error ? "text-red-400" : "text-muted"}`}>{message.text}</p>
      )}
      {manualLink && (
        <textarea
          readOnly
          value={manualLink}
          onFocus={(e) => e.currentTarget.select()}
          rows={3}
          className="mt-2 w-full resize-none rounded-2xl border border-border bg-card p-3 text-xs text-muted outline-none"
        />
      )}

      <button
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setMessage(null);
        }}
        className="mt-5 text-center text-sm text-muted hover:text-white"
      >
        {mode === "signin" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
      </button>

      <p className="mt-6 text-center text-xs text-muted">
        Al continuar aceptas los{" "}
        <button className="underline" onClick={() => void openExternal(TERMS_URL)}>
          Términos
        </button>{" "}
        y la{" "}
        <button className="underline" onClick={() => void openExternal(PRIVACY_URL)}>
          Política de privacidad
        </button>
        .
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="appear w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src="/scorpk-icon.png" alt="Scorpk" className="h-16 w-16 rounded-2xl" />
          <h1 className="text-xl font-semibold">Bienvenido a Scorpk</h1>
          <p className="text-sm text-muted">Inicia sesión para usar tu asistente en Windows.</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function friendly(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login")) return "Correo o contraseña incorrectos.";
  if (text.includes("already registered")) return "Ese correo ya tiene una cuenta. Inicia sesión.";
  if (text.includes("email not confirmed")) return "Confirma tu correo antes de entrar.";
  if (text.includes("network") || text.includes("fetch")) return "No pude conectarme. Revisa tu internet.";
  return "No se pudo completar. Inténtalo de nuevo.";
}
