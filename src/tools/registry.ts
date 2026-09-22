/**
 * Tool registry — every tool registers here; agents reference tools by name.
 */
import type { ToolDef } from "@/tools/types";
import { calculatorTool } from "@/tools/tools/calculator";
import { webSearchTool } from "@/tools/tools/web-search";
import { fileReaderTool } from "@/tools/tools/file-reader";
import { sourceLookupTool } from "@/tools/tools/source-lookup";
import { webFetchTool } from "@/tools/tools/web-fetch";
import { educationExplainTool } from "@/tools/tools/education/explain";
import { questionGeneratorTool } from "@/tools/tools/education/question-generator";
import { quizTool } from "@/tools/tools/education/quiz";
import { evaluateAnswerTool } from "@/tools/tools/education/evaluate-answer";
import { flashcardTool } from "@/tools/tools/education/flashcard";

const tools: Map<string, ToolDef> = new Map();

function register(tool: ToolDef) {
  if (tools.has(tool.name)) throw new Error(`Duplicate tool registration: ${tool.name}`);
  tools.set(tool.name, tool);
}

register(calculatorTool);
register(webSearchTool);
register(fileReaderTool);
register(sourceLookupTool);
register(webFetchTool);
register(educationExplainTool);
register(questionGeneratorTool);
register(quizTool);
register(evaluateAnswerTool);
register(flashcardTool);

export function getTool(name: string): ToolDef | undefined {
  return tools.get(name);
}

export function listTools(): ToolDef[] {
  return [...tools.values()];
}

export function toolsByNames(names: string[]): ToolDef[] {
  return names.map((n) => tools.get(n)).filter((t): t is ToolDef => Boolean(t));
}

export function toolNamesFrom(available: ToolDef[]): string[] {
  return available.map((t) => t.name);
}