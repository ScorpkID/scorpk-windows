import { describe, expect, it } from "vitest";
import { interpretLocally } from "./localInterpreter";

const pick = (text: string) => {
  const r = interpretLocally(text);
  return r && { action: r.action, target: r.parameters.target, value: r.parameters.value };
};

describe("interpretLocally", () => {
  it("abrir programas", () => {
    expect(pick("Abre Chrome")).toEqual({ action: "open_app", target: "chrome", value: null });
    expect(pick("oye scorpk abre la calculadora por favor")).toMatchObject({ action: "open_app", target: "calculadora" });
    expect(pick("Abre la aplicación de Spotify")).toMatchObject({ action: "open_app", target: "spotify" });
  });

  it("volumen", () => {
    expect(pick("sube el volumen")).toMatchObject({ action: "volume_control", value: "up" });
    expect(pick("baja el volumen")).toMatchObject({ action: "volume_control", value: "down" });
    expect(pick("silencia el pc")).toMatchObject({ action: "volume_control", value: "mute" });
    expect(pick("pon el volumen al 40%")).toMatchObject({ action: "volume_control", value: 40 });
    expect(pick("volumen al máximo")).toMatchObject({ action: "volume_control", value: "max" });
  });

  it("multimedia", () => {
    expect(pick("siguiente canción")).toMatchObject({ action: "media_control", value: "next" });
    expect(pick("canción anterior")).toMatchObject({ action: "media_control", value: "previous" });
    expect(pick("pausa")).toMatchObject({ action: "media_control", value: "pause" });
    expect(pick("reproduce")).toMatchObject({ action: "media_control", value: "play" });
  });

  it("temporizadores", () => {
    expect(pick("temporizador de 10 minutos")).toMatchObject({ action: "set_timer", value: 600 });
    expect(pick("pon un temporizador de 30 segundos")).toMatchObject({ action: "set_timer", value: 30 });
    expect(pick("temporizador de media hora")).toMatchObject({ action: "set_timer", value: 1800 });
    expect(pick("temporizador de dos horas")).toMatchObject({ action: "set_timer", value: 7200 });
  });

  it("batería, YouTube y rutas", () => {
    expect(pick("¿cuánta batería tengo?")).toMatchObject({ action: "battery_status" });
    expect(pick("busca lofi en youtube")).toMatchObject({ action: "youtube_search", target: "lofi" });
    expect(pick("llévame al aeropuerto")).toMatchObject({ action: "navigate", target: "aeropuerto" });
  });

  it("control de televisor Samsung", () => {
    expect(pick("enciende la tele")).toMatchObject({ action: "tv_control", target: "power", value: "on" });
    expect(pick("apaga la tv")).toMatchObject({ action: "tv_control", target: "power", value: "off" });
    expect(pick("sube el volumen de la tele")).toMatchObject({ action: "tv_control", target: "volume", value: "up" });
    expect(pick("baja el volumen de la tele")).toMatchObject({ action: "tv_control", target: "volume", value: "down" });
    expect(pick("silencia la tele")).toMatchObject({ action: "tv_control", target: "volume", value: "mute" });
    expect(pick("abre netflix en la tele")).toMatchObject({ action: "tv_control", target: "app", value: "netflix" });
    expect(pick("pon spotify en la tele")).toMatchObject({ action: "tv_control", target: "app", value: "spotify" });
    expect(pick("cambia a hdmi 1 en la tele")).toMatchObject({ action: "tv_control", target: "input", value: "hdmi1" });
    expect(pick("pausa la tele")).toMatchObject({ action: "tv_control", target: "media", value: "pause" });
  });

  it("control de celular Android (ARTEMIS)", () => {
    expect(pick("abre whatsapp en mi celular")).toMatchObject({ action: "phone_control", target: "app" });
    expect(pick("pide un uber en mi telefono")).toMatchObject({ action: "phone_control", target: "task" });
    expect(pick("abre instagram en el cel")).toMatchObject({ action: "phone_control", target: "app" });
  });

  it("lo que no entiende devuelve null para pasarlo a la IA", () => {
    expect(interpretLocally("¿quién pintó la Mona Lisa?")).toBeNull();
    expect(interpretLocally("cuéntame un chiste")).toBeNull();
    expect(interpretLocally("   ")).toBeNull();
  });
});
