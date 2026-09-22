/**
 * Research workflow (spec §7, §12). Runs our real SEARCH -> COLLECT -> READ
 * -> COMPARE -> VERIFY -> SYNTHESIZE -> CITE pipeline, storing sources and
 * producing a structured markdown report with citations. No invented sources:
 * citations come only from results actually returned by the search adapter.
 */
import { createResearchExecutor } from "@/agents/research/research-executor";
import { getConfigForMode } from "@/agents/research/research-types";
import type { ResearchConfig, ResearchMode, ResearchRunOutput } from "@/agents/research/research-types";
import { log } from "@/utils/log";

export interface RunResearchOptions {
  userId: string;
  topic: string;
  goal?: string;
  projectId?: string | null;
  mode?: ResearchMode;
  config?: Partial<ResearchConfig>;
}

export async function runResearchWorkflow(input: RunResearchOptions): Promise<ResearchRunOutput> {
  const mode = input.mode ?? "standard";

  const executor = await createResearchExecutor({
    userId: input.userId,
    topic: input.topic,
    goal: input.goal,
    projectId: input.projectId,
    mode,
    config: input.config,
    onProgress: (progress) => {
      log.info("research-progress", {
        topic: input.topic,
        step: progress.currentStep,
        percentage: progress.percentage,
        sourcesFound: progress.sourcesFound,
      });
    },
    onLog: (message) => {
      log.info("research-log", { topic: input.topic, message });
    },
  });

  const result = await executor.execute();

  return {
    sessionId: result.session.id,
    status: result.success ? "complete" : "failed",
    sources: result.session.sources.map((source) => ({
      title: source.title,
      url: source.url,
      provider: source.provider ?? "web",
      publishedAt: source.publishedAt?.toISOString(),
      snippet: source.snippet,
      relevance: source.credibility.domainAuthority / 100,
      verified: source.credibility.isPrimarySource || source.credibility.isGovernment || source.credibility.isAcademic,
    })),
    report: result.session.report?.markdown ?? "",
    note: result.error,
  };
}

/** Default research config for a depth. Delegates to the domain layer's table. */
export function getDefaultConfigForMode(mode: ResearchMode): ResearchConfig {
  return getConfigForMode(mode);
}
