/**
 * Calculator tool (LOW risk): safe arithmetic evaluation, no eval().
 * Supports + - * / ^ % and parentheses, with sane input limits.
 */
import { z } from "zod";
import type { ToolDef } from "@/tools/types";

export interface Term {
  text: string;
  value?: number;
  expression?: string;
}

/** Tokenizer for arithmetic expressions. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const s = input.replace(/\s+/g, "");
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let n = "";
      while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++];
      if (!/^\d*\.?\d+$/.test(n)) throw new Error("Invalid number: " + n);
      tokens.push(n);
      continue;
    }
    if ("+-*/^%()".includes(c)) {
      if ((c === "-" || c === "+") && isUnaryPosition(tokens)) {
        tokens.push(c === "-" ? "u-" : "u+");
      } else {
        tokens.push(c);
      }
      i++;
      continue;
    }
    throw new Error("Unsupported character: " + c);
  }
  return tokens;
}

/** A +/- is unary when it starts the expression or directly follows another operator or "(". */
function isUnaryPosition(tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const prev = tokens[tokens.length - 1];
  return isOp(prev) || prev === "(";
}

function applyOp(a: number, b: number, op: string): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      if (b === 0) throw new Error("Division by zero");
      return a / b;
    case "^":
      return Math.pow(a, b);
    case "%":
      if (b === 0) throw new Error("Modulo by zero");
      return a % b;
    default:
      throw new Error("Unknown operator: " + op);
  }
}

function precedence(op: string): number {
  return op === "+" || op === "-" ? 1 : op === "*" || op === "/" || op === "%" ? 2 : 3; // ^
}

function isOp(c: string): boolean {
  return "+-*/^%".includes(c);
}

/** Shunting-yard evaluation. */
export function evaluate(expression: string): number {
  if (expression.length > 200) throw new Error("Expression too long.");
  if (!/^[0-9+\-*/^%().\s]+$/.test(expression)) throw new Error("Expression contains unsupported characters.");
  const tokens = tokenize(expression);
  const values: number[] = [];
  const ops: string[] = [];

  for (const tok of tokens) {
    if (/^\d/.test(tok)) {
      values.push(parseFloat(tok));
    } else if (tok === "(") {
      ops.push(tok);
    } else if (tok === ")") {
      while (ops.length && ops.at(-1) !== "(") {
        const b = values.pop();
        const a = values.pop();
        const op = ops.pop()!;
        if (a === undefined || b === undefined) throw new Error("Malformed expression");
        values.push(applyOp(a, b, op));
      }
      if (ops.at(-1) !== "(") throw new Error("Mismatched parentheses");
      ops.pop();
    } else if (tok === "u-" || tok === "u+") {
      values.push(0);
      ops.push(tok === "u-" ? "-" : "+");
    } else if (isOp(tok)) {
      while (ops.length && ops.at(-1) !== "(" && precedence(ops.at(-1)!) >= precedence(tok)) {
        const b = values.pop();
        const a = values.pop();
        const op = ops.pop()!;
        if (a === undefined || b === undefined) throw new Error("Malformed expression");
        values.push(applyOp(a, b, op));
      }
      ops.push(tok);
    }
  }

  while (ops.length) {
    const op = ops.pop()!;
    if (op === "(" || op === ")") throw new Error("Mismatched parentheses");
    const b = values.pop();
    const a = values.pop();
    if (a === undefined || b === undefined) throw new Error("Malformed expression");
    values.push(applyOp(a, b, op));
  }

  if (values.length !== 1) throw new Error("Malformed expression");
  return values[0];
}

const inputSchema = z.object({
  expression: z
    .string()
    .min(1, "Expression cannot be empty")
    .max(200, "Expression too long")
    .describe("Arithmetic expression, e.g. (2+3)*4^2"),
});

export const calculatorTool: ToolDef<typeof inputSchema> = {
  name: "calculator",
  description: "Evaluate a safe arithmetic expression (supports + - * / ^ % and parentheses).",
  inputSchema,
  riskLevel: "low",
  async execute({ expression }) {
    const value = evaluate(expression);
    return {
      content: `${expression} = ${value}`,
      data: { expression, value },
    };
  },
};