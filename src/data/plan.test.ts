import { describe, expect, it } from "vitest";
import { isProSubscription } from "./plan";

describe("isProSubscription", () => {
  it("solo plan pro activo o en prueba", () => {
    expect(isProSubscription({ plan: "pro", status: "active" })).toBe(true);
    expect(isProSubscription({ plan: "pro", status: "trialing" })).toBe(true);
    expect(isProSubscription({ plan: "pro", status: "canceled" })).toBe(false);
    expect(isProSubscription({ plan: "free", status: "active" })).toBe(false);
    expect(isProSubscription(null)).toBe(false);
  });
});
