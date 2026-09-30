import { describe, expect, it } from "vitest";
import { pickSpanishVoice, toSpeakable } from "./speechText";

describe("toSpeakable", () => {
  it("quita Markdown, código y URLs", () => {
    const md = "## Título\n- **Hola** _mundo_\n1. Segundo `código`\n```js\nconsole.log(1)\n```\nMira [la web](https://scorpk.tech) o https://scorpk.tech/x.";
    expect(toSpeakable(md)).toBe("Título Hola mundo Segundo código Mira la web o");
  });

  it("recorta en un fin de frase, sin dejar oraciones a medias", () => {
    const long = "Esta es una frase larga de ejemplo. ".repeat(30);
    const spoken = toSpeakable(long);
    expect(spoken.length).toBeLessThanOrEqual(400);
    expect(spoken.endsWith(".")).toBe(true);
  });

  it("texto vacío o solo símbolos", () => {
    expect(toSpeakable("")).toBe("");
    expect(toSpeakable("```\ncódigo\n```")).toBe("");
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
