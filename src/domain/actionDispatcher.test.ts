import { describe, expect, it, vi } from "vitest";
import { ActionDispatcher } from "./actionDispatcher";
import { NativeUnavailableError, type NativeBridge } from "./nativeBridge";
import { TimerService } from "./timerService";
import type { ActionRequest } from "./model";

function setup(invoke: NativeBridge["invoke"] = async () => undefined as never) {
  const native = { invoke: vi.fn(invoke) } as unknown as NativeBridge & { invoke: ReturnType<typeof vi.fn> };
  const openUrl = vi.fn(async (_url: string) => true);
  const notify = vi.fn();
  const timers = new TimerService({ notify });
  return { dispatcher: new ActionDispatcher({ native, timers, openUrl }), native, openUrl, notify, timers };
}

const req = (action: string, parameters: ActionRequest["parameters"] = {}, speech = ""): ActionRequest => ({
  action,
  parameters,
  feedback_speech: speech,
});

describe("ActionDispatcher", () => {
  it("open_app resuelve el programa en Rust y confirma con el nombre real", async () => {
    const { dispatcher, native } = setup(async () => "Google Chrome" as never);
    const result = await dispatcher.dispatch(req("open_app", { target: "chrome" }));
    expect(native.invoke).toHaveBeenCalledWith("open_app", { name: "chrome" });
    expect(result).toMatchObject({ ok: true, text: "Listo, abrí Google Chrome." });
  });

  it("open_app sin nombre pregunta qué abrir", async () => {
    const { dispatcher, native } = setup();
    expect((await dispatcher.dispatch(req("open_app"))).ok).toBe(false);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("volumen: teclas, porcentaje y valores inválidos", async () => {
    const { dispatcher, native } = setup();
    await dispatcher.dispatch(req("volume_control", { value: "up" }));
    expect(native.invoke).toHaveBeenCalledWith("volume_key", { action: "up" });
    await dispatcher.dispatch(req("volume_control", { value: 250 }));
    expect(native.invoke).toHaveBeenCalledWith("set_volume", { percent: 100 });
    expect((await dispatcher.dispatch(req("volume_control", { value: "explotar" }))).ok).toBe(false);
  });

  it("multimedia solo acepta valores de la lista blanca", async () => {
    const { dispatcher, native } = setup();
    expect((await dispatcher.dispatch(req("media_control", { value: "next" }))).ok).toBe(true);
    expect(native.invoke).toHaveBeenCalledWith("media_key", { action: "next" });
    expect((await dispatcher.dispatch(req("media_control", { value: "rm -rf" }))).ok).toBe(false);
  });

  it("temporizador avisa al terminar", async () => {
    vi.useFakeTimers();
    const { dispatcher, notify } = setup();
    const result = await dispatcher.dispatch(req("set_timer", { value: 90, message: "Pasta" }));
    expect(result).toMatchObject({ ok: true, text: "Listo, te aviso en 1 minuto y 30 segundos." });
    vi.advanceTimersByTime(90_000);
    expect(notify).toHaveBeenCalledWith("Scorpk", "Temporizador: Pasta");
    vi.useRealTimers();
  });

  it("temporizador rechaza duraciones absurdas", async () => {
    const { dispatcher } = setup();
    expect((await dispatcher.dispatch(req("set_timer", { value: -5 }))).ok).toBe(false);
    expect((await dispatcher.dispatch(req("set_timer", { value: 999999 }))).ok).toBe(false);
    expect((await dispatcher.dispatch(req("set_timer", { value: "abc" }))).ok).toBe(false);
  });

  it("batería: con y sin batería", async () => {
    const withBattery = setup(async () => ({ percent: 80, charging: true, hasBattery: true }) as never);
    expect((await withBattery.dispatcher.dispatch(req("battery_status"))).text).toBe(
      "La batería está al 80% y se está cargando.",
    );
    const desktop = setup(async () => ({ percent: null, charging: false, hasBattery: false }) as never);
    expect((await desktop.dispatcher.dispatch(req("battery_status"))).text).toContain("no tiene batería");
  });

  it("URLs: siempre codificadas y solo https/mailto", async () => {
    const { dispatcher, openUrl } = setup();
    await dispatcher.dispatch(req("youtube_search", { target: "lofi & chill" }));
    expect(openUrl).toHaveBeenCalledWith("https://www.youtube.com/results?search_query=lofi%20%26%20chill");
    await dispatcher.dispatch(req("navigate", { target: "Aeropuerto El Dorado" }));
    expect(openUrl).toHaveBeenCalledWith("https://www.google.com/maps/dir/?api=1&destination=Aeropuerto%20El%20Dorado");
  });

  it("correo: valida el destinatario para evitar inyección de cabeceras", async () => {
    const { dispatcher, openUrl } = setup();
    const bad = await dispatcher.dispatch(req("compose_email", { target: "a@b.com?bcc=x@y.com" }));
    expect(bad.ok).toBe(false);
    expect(openUrl).not.toHaveBeenCalled();

    const good = await dispatcher.dispatch(req("compose_email", { target: "ana@mail.com", value: "Hola", message: "Qué tal" }));
    expect(good.ok).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("mailto:ana%40mail.com?subject=Hola&body=Qu%C3%A9%20tal");
  });

  it("fuera de Tauri las acciones nativas explican que requieren la app de escritorio", async () => {
    const { dispatcher } = setup(async () => {
      throw new NativeUnavailableError();
    });
    expect(await dispatcher.dispatch(req("open_app", { target: "chrome" }))).toMatchObject({
      ok: false,
      text: "Esta acción solo funciona en la app de escritorio.",
    });
  });

  it("errores de Rust (texto) se muestran tal cual y acciones desconocidas no se ejecutan", async () => {
    const { dispatcher } = setup(async () => {
      throw "No encontré ningún programa llamado zzz.";
    });
    expect((await dispatcher.dispatch(req("open_app", { target: "zzz" }))).text).toBe("No encontré ningún programa llamado zzz.");
    expect((await dispatcher.dispatch(req("format_disk"))).ok).toBe(false);
  });
});
