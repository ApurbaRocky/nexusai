import { describe, expect, it } from "vitest";
import { evaluate } from "@/tools/tools/calculator";

describe("calculator (safe arithmetic)", () => {
  it("evaluates basic expressions", () => {
    expect(evaluate("1 + 2")).toBe(3);
    expect(evaluate("10 - 4")).toBe(6);
    expect(evaluate("7 * 6")).toBe(42);
    expect(evaluate("20 / 5")).toBe(4);
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
  });

  it("supports decimals, negation and precedence", () => {
    expect(evaluate("-3 + 2.5")).toBeCloseTo(-0.5);
    expect(evaluate("10 / 4")).toBe(2.5);
    expect(evaluate("2 ^ 10")).toBe(1024);
    expect(evaluate("17 % 5")).toBe(2);
    expect(evaluate("2 * -3")).toBe(-6);
    expect(evaluate("2 ^ -2")).toBeCloseTo(0.25);
  });

  it("throws on invalid or unsafe input", () => {
    expect(() => evaluate("1 +")).toThrow();
    expect(() => evaluate("2 ** 8")).toThrow();
    expect(() => evaluate("cos(0)")).toThrow();
    expect(() => evaluate("(1+2")).toThrow(); // mismatched parens
    expect(() => evaluate("80 / 0")).toThrow(); // divide by zero
  });
});