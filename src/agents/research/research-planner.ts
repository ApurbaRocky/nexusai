/**
 * Research Planner (Phase 2).
 * Generates research plans with questions, search strategies, and query generation.
 * Adapts plans dynamically based on findings.
 */
import { getProvider } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import { lookupModel } from "@/ai/model-catalog";
import type {
  ResearchPlan,
  ResearchQuestion,
  SearchStrategy,
  ResearchConfig,
  SourceType,
} from "@/agents/research/research-types";
import { log } from "@/utils/log";

export interface PlannerOptions {
  userId: string;
  topic: string;
  goal?: string;
  config: ResearchConfig;
  existingFindings?: string[];
  existingSources?: string[];
}

export interface PlanGenerationResult {
  plan: ResearchPlan;
  reasoning: string;
}

export class ResearchPlanner {
  private userId: string;
  private topic: string;
  private goal?: string;
  private config: ResearchConfig;

  constructor(options: PlannerOptions) {
    this.userId = options.userId;
    this.topic = options.topic;
    this.goal = options.goal;
    this.config = options.config;
  }

  async generatePlan(): Promise<PlanGenerationResult> {
    const reasoning = await this.generateReasoning();
    const questions = await this.generateResearchQuestions();
    const searchStrategy = this.generateSearchStrategy(questions);
    const estimatedQueries = this.estimateQueries(searchStrategy);

    const plan: ResearchPlan = {
      id: crypto.randomUUID(),
      researchQuestion: this.topic,
      goal: this.goal,
      questions,
      searchStrategy,
      estimatedQueries,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return { plan, reasoning };
  }

  async adaptPlan(
    currentPlan: ResearchPlan,
    newFindings: string[],
    gaps: string[]
  ): Promise<ResearchPlan> {
    const adaptedQuestions = await this.adaptQuestions(currentPlan.questions, newFindings, gaps);
    const adaptedStrategy = this.adaptSearchStrategy(currentPlan.searchStrategy, adaptedQuestions);

    return {
      ...currentPlan,
      questions: adaptedQuestions,
      searchStrategy: adaptedStrategy,
      estimatedQueries: this.estimateQueries(adaptedStrategy),
      updatedAt: new Date(),
    };
  }

  private async generateReasoning(): Promise<string> {
    return `Research plan for: "${this.topic}". Goal: ${this.goal ?? "Comprehensive overview"}. Mode: ${this.config.mode}. Will execute up to ${this.config.maxQueries} queries across ${this.config.maxIterations} iterations.`;
  }

  private async generateResearchQuestions(): Promise<ResearchQuestion[]> {
    const questions: ResearchQuestion[] = [];

    const keyQuestions = await this.generateKeyQuestions();

    for (let i = 0; i < keyQuestions.length; i++) {
      questions.push({
        id: crypto.randomUUID(),
        question: keyQuestions[i],
        priority: i === 0 ? "high" : i < 3 ? "high" : "medium",
        status: "pending",
        assignedQueries: [],
        findings: [],
      });
    }

    return questions;
  }

  private async generateKeyQuestions(): Promise<string[]> {
    const key = await resolveKeySource(this.userId, "openai");
    const model = lookupModel("openai:gpt-4o-mini");
    const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

    if (!provider || !model) {
      return this.generateHeuristicQuestions();
    }

    try {
      const prompt = `Generate 5-7 specific research questions for the topic: "${this.topic}"
Goal: ${this.goal ?? "Comprehensive, evidence-based overview"}
Mode: ${this.config.mode}

Return ONLY a JSON array of strings, each being a focused research question.
Questions should be specific, answerable, and cover different aspects of the topic.`;

      const result = await provider.complete({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 500,
      });

      const questions = JSON.parse(result.content) as string[];
      return Array.isArray(questions) ? questions.slice(0, 7) : this.generateHeuristicQuestions();
    } catch (err) {
      log.warn("planner-llm-failed", { error: (err as Error).message });
      return this.generateHeuristicQuestions();
    }
  }

  private generateHeuristicQuestions(): string[] {
    const questions = [
      `What is the current state of ${this.topic}?`,
      `What are the key findings and evidence regarding ${this.topic}?`,
      `What are the main perspectives or schools of thought on ${this.topic}?`,
      `What are the recent developments in ${this.topic}?`,
      `What are the practical implications or applications of ${this.topic}?`,
      `What are the limitations or gaps in current knowledge about ${this.topic}?`,
      `What do authoritative sources say about ${this.topic}?`,
    ];

    if (this.config.mode === "deep") {
      questions.push(
        `How has understanding of ${this.topic} evolved over time?`,
        `What are the conflicting views or controversies around ${this.topic}?`,
        `What methodology is used to study ${this.topic}?`
      );
    }

    return questions.slice(0, this.config.mode === "deep" ? 9 : this.config.mode === "standard" ? 6 : 4);
  }

  private generateSearchStrategy(questions: ResearchQuestion[]): SearchStrategy {
    const primaryQueries = this.generatePrimaryQueries(questions);
    const followUpQueries = this.generateFollowUpQueries(questions);
    const sourceTypePriorities = this.getSourceTypePriorities();

    return {
      primaryQueries,
      followUpQueries,
      sourceTypePriorities,
      dateRange: this.config.dateRange,
      language: this.config.language,
    };
  }

  private generatePrimaryQueries(questions: ResearchQuestion[]): string[] {
    const queries: string[] = [];

    for (const q of questions.slice(0, Math.min(5, questions.length))) {
      const keywords = this.extractKeywords(q.question);
      queries.push(keywords.join(" "));
    }

    if (this.config.mode === "deep") {
      queries.push(`${this.topic} systematic review`);
      queries.push(`${this.topic} meta-analysis`);
      queries.push(`${this.topic} literature review`);
    }

    return [...new Set(queries)].slice(0, this.config.maxQueries);
  }

  private generateFollowUpQueries(questions: ResearchQuestion[]): string[] {
    const queries: string[] = [];

    for (const q of questions) {
      const keywords = this.extractKeywords(q.question);
      if (keywords.length >= 2) {
        queries.push(`${keywords[0]} ${keywords[1]} recent`);
        queries.push(`${keywords[0]} ${keywords[1]} analysis`);
      }
    }

    if (this.config.mode !== "quick") {
      queries.push(`${this.topic} 2024`);
      queries.push(`${this.topic} 2023`);
      queries.push(`${this.topic} latest research`);
      queries.push(`${this.topic} case study`);
      queries.push(`${this.topic} methodology`);
    }

    return [...new Set(queries)].slice(0, this.config.maxQueries);
  }

  private extractKeywords(question: string): string[] {
    const stopWords = new Set(["what", "is", "are", "the", "a", "an", "of", "on", "in", "to", "for", "with", "by", "how", "why", "when", "where", "who", "which", "does", "do", "can", "should", "would", "current", "state", "key", "main", "about", "regarding"]);
    return question
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .slice(0, 5);
  }

  private getSourceTypePriorities(): SourceType[] {
    const base: SourceType[] = ["government", "academic", "documentation", "news", "company", "blog", "forum", "other"];

    if (this.config.sourceTypes && this.config.sourceTypes.length > 0) {
      return this.config.sourceTypes;
    }

    return base;
  }

  private adaptSearchStrategy(strategy: SearchStrategy, questions: ResearchQuestion[]): SearchStrategy {
    const remainingQuestions = questions.filter((q) => q.status !== "complete");
    const newPrimary = this.generatePrimaryQueries(remainingQuestions);
    const newFollowUp = this.generateFollowUpQueries(remainingQuestions);

    return {
      ...strategy,
      primaryQueries: [...new Set([...strategy.primaryQueries, ...newPrimary])].slice(0, this.config.maxQueries),
      followUpQueries: [...new Set([...strategy.followUpQueries, ...newFollowUp])].slice(0, this.config.maxQueries),
    };
  }

  private async adaptQuestions(
    currentQuestions: ResearchQuestion[],
    newFindings: string[],
    gaps: string[]
  ): Promise<ResearchQuestion[]> {
    const adapted = [...currentQuestions];

    for (const gap of gaps) {
      const exists = adapted.some((q) => q.question.toLowerCase().includes(gap.toLowerCase().slice(0, 30)));
      if (!exists) {
        adapted.push({
          id: crypto.randomUUID(),
          question: gap,
          priority: "medium",
          status: "pending",
          assignedQueries: [],
          findings: [],
        });
      }
    }

    return adapted;
  }

  private estimateQueries(strategy: SearchStrategy): number {
    return Math.min(
      strategy.primaryQueries.length + strategy.followUpQueries.length,
      this.config.maxQueries
    );
  }
}

export async function createResearchPlanner(options: PlannerOptions): Promise<ResearchPlanner> {
  return new ResearchPlanner(options);
}