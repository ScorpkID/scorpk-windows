/** Temporizadores en memoria con aviso al terminar. Windows no tiene API de alarmas para terceros. */
export interface TimerDeps {
  notify: (title: string, body: string) => void;
  setTimeoutImpl?: typeof setTimeout;
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hora" : "horas"}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minuto" : "minutos"}`);
  if (seconds || parts.length === 0) parts.push(`${seconds} ${seconds === 1 ? "segundo" : "segundos"}`);
  return parts.join(" y ");
}

export class TimerService {
  private readonly pending = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: TimerDeps) {}

  /** Programa el aviso. Devuelve la duración legible. */
  start(seconds: number, label: string | null): string {
    const schedule = this.deps.setTimeoutImpl ?? setTimeout;
    const handle = schedule(() => {
      this.pending.delete(handle);
      this.deps.notify("Scorpk", label ? `Temporizador: ${label}` : "¡Tu temporizador terminó!");
    }, seconds * 1000);
    this.pending.add(handle);
    return formatDuration(seconds);
  }

  cancelAll(): void {
    this.pending.forEach((handle) => clearTimeout(handle));
    this.pending.clear();
  }
}

/** Notificación del sistema vía la API web del WebView (pide permiso la primera vez). */
export function browserNotify(title: string, body: string): void {
  if (typeof Notification === "undefined") return;
  const show = () => new Notification(title, { body });
  if (Notification.permission === "granted") show();
  else if (Notification.permission !== "denied") void Notification.requestPermission().then((p) => p === "granted" && show());
}
