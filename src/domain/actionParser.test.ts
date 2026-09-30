import { describe, expect, it } from "vitest";
import { ActionParseError, parseAction } from "./actionParser";

describe("parseAction", () => {
  it("lee el JSON del contrato", () => {
    const action = parseAction(
      '{"action":"respond_chat","parameters":{"target":null,"value":null,"message":"Hola"},"feedback_speech":"Hola"}',
    );
    expect(action.action).toBe("respond_chat");
    expect(action.parameters.message).toBe("Hola");
    expect(action.feedback_speech).toBe("Hola");
  });

  it("tolera vallas de código y texto alrededor", () => {
    const action = parseAction('Claro:\n```json\n{"action":"open_app","parameters":{"target":"Chrome"}}\n```');
    expect(action.action).toBe("open_app");
    expect(action.parameters.target).toBe("Chrome");
    expect(action.feedback_speech).toBe("");
  });

  it("acepta value numérico y booleano, y descarta tipos raros", () => {
    expect(parseAction('{"action":"set_timer","parameters":{"value":600}}').parameters.value).toBe(600);
    expect(parseAction('{"action":"x","parameters":{"value":true}}').parameters.value).toBe(true);
    expect(parseAction('{"action":"x","parameters":{"value":{"a":1}}}').parameters.value).toBeNull();
  });

  it("rechaza respuestas sin JSON o sin acción", () => {
    expect(() => parseAction("hola")).toThrow(ActionParseError);
    expect(() => parseAction("{ roto")).toThrow(ActionParseError);
    expect(() => parseAction('{"parameters":{}}')).toThrow(ActionParseError);
    expect(() => parseAction('{"action":"  "}')).toThrow(ActionParseError);
  });
});
