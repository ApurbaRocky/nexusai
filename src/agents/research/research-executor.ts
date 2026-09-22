/**
 * Research Executor (Phase 2).
 * Orchestrates the complete research pipeline: plan -> search -> verify -> synthesize.
 * Supports quick, standard, and deep research modes with iterative search.
 */
import { searchAdapter, type SearchResult } from "@/tools/tools/web-search";
import { fetchWebContent } from "@/tools/tools/web-fetch";
import { prisma } from "@/database/client";
import type {
  ResearchSession,
  ResearchConfig,
  ResearchMode,
  ResearchStatus,
  ResearchPlan,
  ResearchReport,
  SearchIteration,
  NormalizedSearchResult,
  SourceMetadata,
  ResearchFinding,
  Conflict,
  ResearchProgress,
  ResearchCost,
  Evidence,
} from "@/agents/research/research-types";
import { classifySourceType, extractDomain } from "@/agents/research/research-types";
import { parseResearch } from "@/agents/research/json-persistence";
import { toSourceMetadata, SourceManager } from "@/agents/research/source-manager";
import { ResearchPlanner } from "@/agents/research/research-planner";
import { SourceVerifier } from "@/agents/research/source-verifier";
import { ResearchSynthesizer } from "@/agents/research/research-synthesizer";
import { log } from "@/utils/log";

export interface ExecutorOptions {
  userId: string;
  topic: string;
  goal?: string;
  projectId?: string | null;
  mode: ResearchMode;
  config?: Partial<ResearchConfig>;
  onProgress?: (progress: ResearchProgress) => void;
  onLog?: (message: string) => void;
}

export interface ExecutionResult {
  session: ResearchSession;
  success: boolean;
  error?: string;
}

/** Concurrent page fetches: polite to the target servers, fast enough for a report. */
const FETCH_CONCURRENCY = 4;

/** How many sources we try to read per mode — network reading is the slow phase. */
const READ_LIMITS: Record<ResearchMode, number> = { quick: 4, standard: 10, deep: 20 };

/** Text shorter than this means the page was unreadable (JS-only, paywall, redirect). */
const MIN_USEFUL_CONTENT = 200;

/** Number of progress steps a run reports. */
const TOTAL_STEPS = 5;

/** Share of a question's keywords that must appear in an excerpt to link them. */
const MATCH_THRESHOLD = 0.34;

/** Update payload accepted by `updateSession`, derived from Prisma itself. */
type ResearchSessionUpdateData = NonNullable<Parameters<typeof prisma.researchSession.update>[0]["data"]>;

/** Empty plan used when a session has no plan yet, or its stored JSON is corrupt. */
function fallbackPlan(topic: string): ResearchPlan {
  return {
    id: crypto.randomUUID(),
    researchQuestion: topic,
    questions: [],
    searchStrategy: { primaryQueries: [], followUpQueries: [], sourceTypePriorities: [] },
    estimatedQueries: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Words too common to signal topical overlap between a question and an excerpt. */
const STOP_WORDS = new Set([
  "what", "when", "where", "which", "while", "with", "without", "about", "above", "after",
  "again", "against", "because", "been", "before", "being", "below", "between", "both",
  "does", "doing", "down", "during", "each", "from", "further", "have", "having", "here",
  "into", "itself", "more", "most", "only", "other", "over", "same", "should", "some",
  "such", "than", "that", "their", "them", "then", "there", "these", "they", "this",
  "those", "through", "under", "until", "very", "were", "will", "would", "your",
]);

/** Extract significant lowercase words for cheap topical matching. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
}

/** Parse a provider date string, tolerating relative dates such as "2 days ago". */
function toDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export class ResearchExecutor {
  private userId: string;
  private topic: string;
  private goal?: string;
  private projectId?: string | null;
  private mode: ResearchMode;
  private config: ResearchConfig;
  private onProgress?: (progress: ResearchProgress) => void;
  private onLog?: (message: string) => void;

  // Assigned by the phase that owns them; every read happens after that phase.
  private sessionId = "";
  private planner!: ResearchPlanner;
  private sourceManager!: SourceManager;
  private verifier!: SourceVerifier;
  private synthesizer!: ResearchSynthesizer;

  private progress: ResearchProgress = {
    currentStep: "Initializing",
    stepsCompleted: [],
    totalSteps: TOTAL_STEPS,
    sourcesFound: 0,
    sourcesAnalyzed: 0,
    queriesExecuted: 0,
    iterationsCompleted: 0,
    percentage: 0,
  };

  private cost: ResearchCost = {
    searchRequests: 0,
    aiRequests: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
    durationMs: 0,
  };

  private startTime = Date.now();

  constructor(options: ExecutorOptions) {
    this.userId = options.userId;
    this.topic = options.topic;
    this.goal = options.goal;
    this.projectId = options.projectId;
    this.mode = options.mode;
    this.config = { ...options.config, mode: options.mode } as ResearchConfig;
    this.onProgress = options.onProgress;
    this.onLog = options.onLog;
  }

  async execute(): Promise<ExecutionResult> {
    try {
      await this.initializeSession();
      await this.executePlanning();
      await this.executeSearch();
      await this.executeContentRetrieval();
      await this.executeVerification();
      await this.executeSynthesis();
      await this.finalizeSession();

      return { session: await this.getSession(), success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Research failed";
      await this.failSession(message);
      log.error("research-execution-failed", { sessionId: this.sessionId, error: message });
      return { session: await this.getSession(), success: false, error: message };
    }
  }

  private async initializeSession(): Promise<void> {
    this.log("Initializing research session...");

    const session = await prisma.researchSession.create({
      data: {
        userId: this.userId,
        projectId: this.projectId ?? null,
        topic: this.topic,
        goal: this.goal ?? null,
        status: "planning",
        config: JSON.stringify(this.config),
        plan: JSON.stringify([]),
        iterations: JSON.stringify([]),
      },
    });

    this.sessionId = session.id;
    this.updateProgress({ currentStep: "Planning", stepsCompleted: [], percentage: 5 });
    this.log("Session created, starting research planner...");
  }

  private async executePlanning(): Promise<void> {
    this.log("Generating research plan...");

    const { createResearchPlanner } = await import("@/agents/research/research-planner");
    this.planner = await createResearchPlanner({
      userId: this.userId,
      topic: this.topic,
      goal: this.goal,
      config: this.config,
    });

    const { plan } = await this.planner.generatePlan();

    await this.updateSession({ plan: JSON.stringify(plan), status: "searching" });

    this.updateProgress({ currentStep: "Searching for sources", stepsCompleted: ["planning"], percentage: 15 });
    this.log(`Plan generated with ${plan.questions.length} research questions`);
  }

  private async executeSearch(): Promise<void> {
    this.log("Starting search phase...");

    const { createSourceManager } = await import("@/agents/research/source-manager");
    this.sourceManager = await createSourceManager({
      sessionId: this.sessionId,
      config: this.config,
      userId: this.userId,
    });

    const adapter = searchAdapter();
    const allResults: NormalizedSearchResult[] = [];
    const seenUrls = new Set<string>();

    const plan = await this.getPlan();
    const allQueries = [
      ...plan.searchStrategy.primaryQueries,
      ...plan.searchStrategy.followUpQueries,
    ].slice(0, this.config.maxQueries);

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      this.updateProgress({
        currentStep: `Search iteration ${iteration + 1}/${this.config.maxIterations}`,
        iterationsCompleted: iteration,
      });

      const queriesForIteration = this.getQueriesForIteration(allQueries, iteration, plan);

      for (const query of queriesForIteration) {
        if (this.progress.queriesExecuted >= this.config.maxQueries) break;
        if (this.progress.sourcesFound >= this.config.maxSources) break;

        this.log(`Executing query: ${query}`);
        this.updateProgress({ currentStep: `Searching: ${query.slice(0, 50)}...` });

        try {
          const results = await adapter.search(query, Math.min(8, this.config.maxSources - this.progress.sourcesFound));
          this.cost.searchRequests++;

          const normalized = this.normalizeResults(results, query, adapter.id);
          const newResults = normalized.filter((r) => !seenUrls.has(r.url));

          for (const r of newResults) {
            seenUrls.add(r.url);
          }

          allResults.push(...newResults);
          this.progress.queriesExecuted++;
          this.progress.sourcesFound = allResults.length;

          this.updateProgress({
            sourcesFound: allResults.length,
            queriesExecuted: this.progress.queriesExecuted,
            percentage: Math.min(15 + (iteration * 20) + (this.progress.queriesExecuted / this.config.maxQueries) * 20, 55),
          });

          const iterationRecord: SearchIteration = {
            id: crypto.randomUUID(),
            query,
            results: newResults,
            sourcesAdded: newResults.length,
            timestamp: new Date(),
            reasoning: `Query for iteration ${iteration + 1}`,
          };

          await this.addIteration(iterationRecord);
        } catch (err) {
          this.log(`Search failed for query "${query}": ${(err as Error).message}`);
        }
      }

      if (this.progress.sourcesFound >= this.config.maxSources) break;
      if (this.config.mode === "quick") break;
    }

    await this.sourceManager.addSearchResults(allResults);
    this.log(`Search complete: ${allResults.length} unique sources found`);
    this.updateProgress({ currentStep: "Analyzing sources", stepsCompleted: ["planning", "searching"], percentage: 55 });
  }

  /**
   * READ phase: fetch the real page text for the most promising sources.
   *
   * Without this the pipeline has nothing to extract evidence from, and the
   * report would list sources but contain no findings.
   */
  private async executeContentRetrieval(): Promise<void> {
    const sources = await this.sourceManager.getSources();
    const targets = sources.filter((source: SourceMetadata) => Boolean(source.url)).slice(0, READ_LIMITS[this.mode]);

    if (targets.length === 0) {
      this.log("No sources available to read.");
      return;
    }

    this.log(`Reading up to ${targets.length} source pages...`);
    let read = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        if (Date.now() - this.startTime > this.config.maxResearchTimeMs) {
          this.log("Research time budget reached; stopping content retrieval.");
          return;
        }
        const source = targets[cursor++] as SourceMetadata;
        try {
          const { text } = await fetchWebContent(source.url, this.config.maxContentLength);
          if (text.length < MIN_USEFUL_CONTENT) {
            this.log(`Skipped ${source.domain}: too little readable text.`);
            continue;
          }
          await this.sourceManager.updateSourceContent(source.id, text);
          await this.sourceManager.updateSourceVerification(source.id, true);
          read++;
        } catch (err) {
          this.log(`Could not read ${source.domain}: ${(err as Error).message}`);
        }
        this.updateProgress({
          currentStep: `Reading sources (${read}/${targets.length})`,
          sourcesAnalyzed: read,
          percentage: Math.min(55 + Math.round((read / targets.length) * 10), 65),
        });
      }
    };

    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, targets.length) }, () => worker()));

    this.log(`Read ${read} of ${targets.length} source pages.`);
  }

  private async executeVerification(): Promise<void> {
    this.log("Starting source verification and evidence extraction...");

    const { createSourceVerifier } = await import("@/agents/research/source-verifier");
    this.verifier = await createSourceVerifier({
      userId: this.userId,
      sessionId: this.sessionId,
    });

    const sources = await this.sourceManager.getSources();
    const plan = await this.getPlan();

    const verifiedSources: SourceMetadata[] = [];

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      this.updateProgress({
        currentStep: `Verifying source ${i + 1}/${sources.length}`,
        sourcesAnalyzed: i + 1,
        percentage: 55 + Math.floor((i / sources.length) * 25),
      });

      try {
        const verified = await this.verifier.verifySource(source);
        verifiedSources.push(verified);
        this.cost.aiRequests++;
      } catch (err) {
        this.log(`Verification failed for source ${source.id}: ${(err as Error).message}`);
        verifiedSources.push(source);
      }
    }

    this.log("Extracting evidence from sources...");
    const allEvidence: Evidence[] = [];

    for (const source of verifiedSources) {
      if (source.content && source.content.length > 100) {
        try {
          const evidence = await this.verifier.extractEvidence(source, plan.questions, source.content);
          allEvidence.push(...evidence);
        } catch (err) {
          this.log(`Evidence extraction failed for source ${source.id}: ${(err as Error).message}`);
        }
      }
    }

    this.log("Generating findings from evidence...");
    const findings = this.buildFindings(plan, allEvidence);

    this.log("Detecting conflicts...");
    const conflicts = await this.verifier.detectConflicts(findings);

    // Assess confidence for each finding
    const updatedFindings: ResearchFinding[] = [];
    for (let i = 0; i < findings.length; i++) {
      const confidence = await this.verifier.assessFindingConfidence(findings[i]);
      updatedFindings.push({ ...findings[i], confidence });
    }

    await this.updateSession({
      findings: JSON.stringify(updatedFindings),
      conflicts: JSON.stringify(conflicts),
      status: "synthesizing",
    });

    this.updateProgress({
      currentStep: "Synthesizing the report",
      stepsCompleted: ["planning", "searching", "analyzing", "verifying"],
      sourcesAnalyzed: verifiedSources.length,
      percentage: 80,
    });
  }

  private async executeSynthesis(): Promise<void> {
    this.log("Synthesizing final report...");

    const { createResearchSynthesizer } = await import("@/agents/research/research-synthesizer");
    this.synthesizer = await createResearchSynthesizer({
      userId: this.userId,
      session: await this.getSession(),
      config: this.config,
    });

    const report = await this.synthesizer.synthesizeReport();

    await this.updateSession({
      report: JSON.stringify(report),
      status: "complete",
      completedAt: new Date(),
    });

    this.log("Research complete!");
    this.updateProgress({
      currentStep: "Complete",
      stepsCompleted: ["planning", "searching", "analyzing", "verifying", "synthesizing"],
      percentage: 100,
    });
  }

  private async updateSession(data: ResearchSessionUpdateData): Promise<void> {
    await prisma.researchSession.update({
      where: { id: this.sessionId },
      data,
    });
  }

  /**
   * Group extracted evidence under the research question it answers, and turn
   * each non-empty group into a finding.
   *
   * Evidence carries the question id when the extractor resolved one; otherwise
   * a cheap topical-overlap test is used. Evidence that matches no question is
   * dropped rather than forced under an unrelated one.
   */
  private buildFindings(plan: ResearchPlan, evidence: Evidence[]): ResearchFinding[] {
    if (plan.questions.length === 0 || evidence.length === 0) return [];

    const evidenceByQuestion = new Map<string, Evidence[]>();
    for (const item of evidence) {
      const questionId = item.researchQuestionId ?? this.matchQuestion(plan, item.excerpt);
      if (!questionId) continue;
      const bucket = evidenceByQuestion.get(questionId) ?? [];
      bucket.push(item);
      evidenceByQuestion.set(questionId, bucket);
    }

    const findings: ResearchFinding[] = [];
    for (const question of plan.questions) {
      const questionEvidence = evidenceByQuestion.get(question.id) ?? [];
      if (questionEvidence.length === 0) continue;

      const claim = this.synthesizeClaim(question.question, questionEvidence);
      findings.push({
        id: crypto.randomUUID(),
        researchQuestionId: question.id,
        claim,
        evidence: questionEvidence,
        sourceIds: [...new Set(questionEvidence.map((item) => item.sourceId))],
        confidence: "limited_evidence",
        category: this.categorizeClaim(claim),
        conflicts: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return findings;
  }

  /** Best-effort match of an excerpt to a research question by shared keywords. */
  private matchQuestion(plan: ResearchPlan, excerpt: string): string | null {
    const excerptWords = new Set(tokenize(excerpt));
    let best: { id: string; score: number } | null = null;

    for (const question of plan.questions) {
      const questionWords = tokenize(question.question);
      if (questionWords.length === 0) continue;
      const overlap = questionWords.filter((word) => excerptWords.has(word)).length / questionWords.length;
      if (overlap > 0 && (!best || overlap > best.score)) best = { id: question.id, score: overlap };
    }

    return best && best.score >= MATCH_THRESHOLD ? best.id : null;
  }

  private synthesizeClaim(question: string, evidence: Evidence[]): string {
    const excerpts = evidence.map((e) => e.excerpt).join(" ");
    return `Regarding "${question}": ${excerpts.slice(0, 300)}...`;
  }

  private categorizeClaim(claim: string): string {
    const lower = claim.toLowerCase();
    if (lower.includes("impact") || lower.includes("effect")) return "Impact";
    if (lower.includes("cause") || lower.includes("reason")) return "Causation";
    if (lower.includes("method") || lower.includes("approach")) return "Methodology";
    if (lower.includes("trend") || lower.includes("change")) return "Trend";
    return "General";
  }

  private async finalizeSession(): Promise<void> {
    this.cost.durationMs = Date.now() - this.startTime;
    this.cost.estimatedCostUsd = this.estimateCost();

    await this.updateSession({
      cost: JSON.stringify(this.cost),
      progress: JSON.stringify(this.progress),
    });
  }

  /**
   * Record a failure as a valid (if empty) ResearchReport, so the `report`
   * column stays JSON-parseable for every reader while the reason remains
   * visible to the user.
   */
  private async failSession(error: string): Promise<void> {
    const report: ResearchReport = {
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      title: `Research failed: ${this.topic}`,
      markdown: `# Research failed\n\n${error}`,
      executiveSummary: "The run did not complete, so no report was produced.",
      researchQuestion: this.topic,
      methodology: `Mode: ${this.config.mode}. The run stopped before synthesis.`,
      keyFindings: [],
      evidence: [],
      areasOfAgreement: [],
      conflictingEvidence: [],
      limitations: [error],
      conclusion: "No conclusion: the research run failed.",
      references: [],
      metadata: {
        mode: this.mode,
        totalQueries: this.progress.queriesExecuted,
        totalSources: this.progress.sourcesFound,
        totalIterations: this.progress.iterationsCompleted,
        durationMs: Date.now() - this.startTime,
        searchProviders: [],
        synthesisProvider: "none",
        sourceTypes: [],
        language: "en",
      },
      createdAt: new Date(),
    };

    await this.updateSession({
      status: "failed",
      report: JSON.stringify(report),
      progress: JSON.stringify(this.progress),
      completedAt: new Date(),
    });
  }

  /**
   * Read the session back in its full domain shape. Every JSON column is parsed
   * through `parseResearch`, so one corrupt artefact degrades to a default
   * instead of failing the whole request.
   */
  private async getSession(): Promise<ResearchSession> {
    const session = await prisma.researchSession.findUnique({
      where: { id: this.sessionId },
      include: { sources: true },
    });

    if (!session) throw new Error("Session not found");

    return {
      id: session.id,
      userId: session.userId,
      projectId: session.projectId ?? undefined,
      topic: session.topic,
      goal: session.goal ?? undefined,
      mode: this.mode,
      config: parseResearch<ResearchConfig>(session.config, this.config),
      status: session.status as ResearchStatus,
      plan: parseResearch<ResearchPlan | undefined>(session.plan, undefined),
      iterations: parseResearch<SearchIteration[]>(session.iterations, []),
      sources: session.sources.map(toSourceMetadata),
      findings: parseResearch<ResearchFinding[]>(session.findings, []),
      conflicts: parseResearch<Conflict[]>(session.conflicts, []),
      report: parseResearch<ResearchReport | undefined>(session.report, undefined),
      progress: parseResearch<ResearchProgress>(session.progress, this.progress),
      cost: parseResearch<ResearchCost>(session.cost, this.cost),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt ?? undefined,
    };
  }

  private async getPlan(): Promise<ResearchPlan> {
    const session = await prisma.researchSession.findUnique({
      where: { id: this.sessionId },
      select: { plan: true },
    });
    return parseResearch<ResearchPlan>(session?.plan, fallbackPlan(this.topic));
  }

  private getQueriesForIteration(allQueries: string[], iteration: number, plan: ResearchPlan): string[] {
    if (iteration === 0) return allQueries.slice(0, Math.min(5, allQueries.length));
    if (iteration === 1) return plan.searchStrategy.followUpQueries.slice(0, 3);
    return allQueries.slice(5, 8);
  }

  private normalizeResults(results: SearchResult[], query: string, provider: string): NormalizedSearchResult[] {
    return results
      .filter((result) => Boolean(result.url))
      .map((result) => ({
        id: crypto.randomUUID(),
        title: result.title,
        url: result.url,
        domain: extractDomain(result.url),
        snippet: result.snippet ?? "",
        publishedAt: toDate(result.publishedAt),
        author: undefined,
        sourceType: classifySourceType(result.url, result.title, result.snippet),
        relevanceScore: result.relevance ?? 0.5,
        contentLength: result.snippet?.length ?? 0,
        retrievedAt: new Date(),
        searchProvider: provider,
        searchQuery: query,
      }));
  }

  private async addIteration(iteration: SearchIteration): Promise<void> {
    const session = await prisma.researchSession.findUnique({
      where: { id: this.sessionId },
      select: { iterations: true },
    });
    const existing = parseResearch<SearchIteration[]>(session?.iterations, []);
    existing.push(iteration);
    await this.updateSession({ iterations: JSON.stringify(existing) });
  }

  private estimateCost(): number {
    return this.cost.searchRequests * 0.001 + (this.cost.totalTokens / 1000) * 0.002;
  }

  private updateProgress(partial: Partial<ResearchProgress>): void {
    this.progress = { ...this.progress, ...partial };
    if (this.onProgress) this.onProgress(this.progress);
  }

  private log(message: string): void {
    if (this.onLog) this.onLog(message);
  }
}

export async function createResearchExecutor(options: ExecutorOptions): Promise<ResearchExecutor> {
  return new ResearchExecutor(options);
}
