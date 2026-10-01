import { describe, expect, it } from "vitest";
import { pickSpanishVoice, splitForSpeech, toSpeakable } from "./speechText";

describe("toSpeakable", () => {
  it("quita Markdown, código y URLs", () => {
    const md = "## Título\n- **Hola** _mundo_\n1. Segundo `código`\n```js\nconsole.log(1)\n```\nMira [la web](https://scorpk.tech) o https://scorpk.tech/x.";
    expect(toSpeakable(md)).toBe("Título Hola mundo Segundo código Mira la web o");
  });

  it("recorta en un fin de frase, sin dejar oraciones a medias", () => {
    const long = "Esta es una frase larga de ejemplo. ".repeat(60);
    const spoken = toSpeakable(long);
    expect(spoken.length).toBeLessThanOrEqual(1200);
    expect(spoken.endsWith(".")).toBe(true);
  });

  it("lee respuestas largas completas (ya no se corta a 400 caracteres)", () => {
    const answer = "Una API es una forma de que dos programas se comuniquen. ".repeat(10);
    expect(toSpeakable(answer).length).toBeGreaterThan(500);
  });

  it("texto vacío o solo símbolos", () => {
    expect(toSpeakable("")).toBe("");
    expect(toSpeakable("```\ncódigo\n```")).toBe("");
  });
});

describe("splitForSpeech", () => {
  it("parte por frases sin pasar del límite y sin perder texto", () => {
    const text = "Primera frase corta. Segunda frase un poco más larga que la anterior. Tercera frase final.";
    const chunks = splitForSpeech(text, 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text);
  });

  it("una frase más larga que el límite se parte por palabras", () => {
    const text = "palabra ".repeat(100).trim();
    const chunks = splitForSpeech(text, 60);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 60)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });
});

describe("pickSpanishVoice", () => {
  it("prefiere la voz natural en español y descarta otros idiomas", () => {
    const voices = [
      { name: "Microsoft David", lang: "en-US" },
      { name: "Microsoft Helena", lang: "es-ES" },
      { name: "Microsoft Dalia Online (Natural)", lang: "es-MX" },
    ];
    expect(pickSpanishVoice(voices)).toBe(2);
  });

  it("devuelve -1 si no hay voces en español", () => {
    expect(pickSpanishVoice([{ name: "Microsoft David", lang: "en-US" }])).toBe(-1);
    expect(pickSpanishVoice([])).toBe(-1);
  });
});
