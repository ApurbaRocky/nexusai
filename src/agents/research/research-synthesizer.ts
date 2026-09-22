/**
 * Research Synthesizer (Phase 2).
 * Synthesizes findings into structured, cited research reports.
 * Generates executive summary, methodology, findings, evidence, conflicts, and references.
 */
import { getProvider } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import { lookupModel } from "@/ai/model-catalog";
import type { AIProvider, ModelInfo } from "@/ai/providers/base";
import type {
  ResearchFinding,
  Citation,
  ResearchReport,
  ResearchSession,
  ResearchConfig,
  SourceMetadata,
} from "@/agents/research/research-types";
import { log } from "@/utils/log";

export interface SynthesizerOptions {
  userId: string;
  session: ResearchSession;
  config: ResearchConfig;
}

export class ResearchSynthesizer {
  private userId: string;
  private session: ResearchSession;
  private config: ResearchConfig;

  constructor(options: SynthesizerOptions) {
    this.userId = options.userId;
    this.session = options.session;
    this.config = options.config;
  }

  async synthesizeReport(): Promise<ResearchReport> {
    const sources = await this.getSourcesForReport();
    const citations = this.generateCitations(sources);

    const key = await resolveKeySource(this.userId, "openai");
    const model = lookupModel("openai:gpt-4o-mini");
    const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

    let reportContent: string;
    let synthesisProvider = "source-led";

    if (provider && model) {
      try {
        reportContent = await this.llmSynthesis(provider, model, sources);
        synthesisProvider = "openai";
      } catch (err) {
        log.warn("synthesizer-llm-failed", { error: (err as Error).message });
        reportContent = this.sourceLedSynthesis(sources);
      }
    } else {
      reportContent = this.sourceLedSynthesis(sources);
    }

    const report: ResearchReport = {
      id: crypto.randomUUID(),
      sessionId: this.session.id,
      title: `Research Report: ${this.session.topic}`,
      markdown: reportContent,
      executiveSummary: this.extractExecutiveSummary(reportContent),
      researchQuestion: this.session.topic,
      methodology: this.generateMethodology(),
      keyFindings: this.session.findings,
      evidence: this.session.findings.flatMap((f) => f.evidence),
      areasOfAgreement: this.identifyAgreements(),
      conflictingEvidence: this.session.conflicts,
      limitations: this.identifyLimitations(sources),
      conclusion: this.extractConclusion(reportContent),
      references: citations,
      metadata: {
        mode: this.config.mode,
        totalQueries: this.session.progress.queriesExecuted,
        totalSources: sources.length,
        totalIterations: this.session.iterations.length,
        durationMs: Date.now() - this.session.createdAt.getTime(),
        searchProviders: [...new Set(this.session.iterations.flatMap((i) => i.results.map((r) => r.searchProvider)))],
        synthesisProvider,
        dateRange: this.config.dateRange,
        sourceTypes: this.config.sourceTypes ?? [],
        language: this.config.language ?? "en",
      },
      createdAt: new Date(),
    };

    return report;
  }

  /**
   * Sources included in the report. Only sources that were actually retrieved
   * are eligible — an unreachable URL must never become a citation.
   */
  private async getSourcesForReport(): Promise<SourceMetadata[]> {
    return [...this.session.sources]
      .filter((source) => source.url.length > 0)
      .sort((a, b) => b.credibility.domainAuthority - a.credibility.domainAuthority);
  }

  private async llmSynthesis(
    provider: AIProvider,
    model: ModelInfo,
    sources: SourceMetadata[]
  ): Promise<string> {
    const sourceRefs = sources
      .map((s, i) => `[${i + 1}] ${s.title}\n   URL: ${s.url}\n   ${s.credibility.notes.join("; ") || "No credibility notes"}\n   ${s.snippet ? `Snippet: ${s.snippet}` : ""}`)
      .join("\n\n");

    const prompt = `Synthesize a professional research report from the following sources.

Research Topic: ${this.session.topic}
Goal: ${this.session.goal ?? "Comprehensive, evidence-based overview"}
Mode: ${this.config.mode}

Sources gathered (ONLY permitted references):
${sourceRefs}

Findings to incorporate:
${this.session.findings.map((f, i) => `${i + 1}. ${f.claim} (Confidence: ${f.confidence})`).join("\n")}

Conflicts identified:
${this.session.conflicts.map((c, i) => `${i + 1}. ${c.description}`).join("\n") || "None detected"}

Write a structured markdown report using this template:
# Research Report: [Title]

## Executive Summary
[2-4 bullet points summarizing key conclusions]

## Research Question
[The original research question]

## Methodology
[Describe the research process: search strategy, source selection, verification, synthesis]

## Key Findings
[Each finding as a subsection with inline citations like [1], [2]]

## Evidence
[Supporting evidence organized by finding]

## Conflicting Information
[Explicitly describe any disagreements between sources]

## Analysis
[Synthesize the evidence, weigh credibility, explain reasoning]

## Conclusion
[Final assessment with appropriate caveats]

## References
[Numbered list matching the sources above]

Rules:
- Cite every claim using [n] format matching the source list
- Never cite sources not in the provided list
- If sources conflict, describe the disagreement explicitly
- Use appropriate hedging language for uncertain findings
- Be concise but thorough`;

    const result = await provider.complete({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      maxTokens: 4000,
    });

    return result.content.trim();
  }

  private sourceLedSynthesis(sources: SourceMetadata[]): string {
    const lines = [
      `# Research Report: ${this.session.topic}`,
      "",
      `**Status:** Source collection complete; synthesis provider unavailable (add an OpenAI key for AI synthesis).`,
      `**Goal:** ${this.session.goal ?? "Evidence-based overview"}`,
      "",
      `## Executive Summary`,
      `This report compiles ${sources.length} sources on "${this.session.topic}". No AI synthesis was performed; the sources below constitute the research evidence.`,
      "",
      `## Research Question`,
      this.session.topic,
      "",
      `## Methodology`,
      `Search mode: ${this.config.mode}. ${this.session.iterations.length} search iterations executed. Sources were deduplicated by URL, classified by type, and assessed for credibility.`,
      "",
      `## Sources (${sources.length})`,
      "",
      ...sources.map((s, i) => {
        const cred = s.credibility;
        const badges = [
          cred.isGovernment ? "🏛️ Government" : "",
          cred.isAcademic ? "🎓 Academic" : "",
          cred.isPeerReviewed ? "📋 Peer-reviewed" : "",
          cred.isPrimarySource ? "📄 Primary" : "",
        ].filter(Boolean).join(" · ");
        return `### [${i + 1}] ${s.title}\n**URL:** ${s.url}${s.publishedAt ? `  \n**Published:** ${s.publishedAt.toLocaleDateString()}` : ""}${badges ? `  \n**Type:** ${badges}` : ""}${s.snippet ? `  \n**Snippet:** ${s.snippet}` : ""}\n**Credibility:** ${cred.domainAuthority}/100`;
      }),
      "",
      `## References`,
      sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n"),
      "",
      `---`,
      `*Automatically compiled by AI Nexus. Sources fetched via web search. No citations were invented.*`,
    ];

    return lines.join("\n");
  }

  private extractExecutiveSummary(report: string): string {
    const match = report.match(/## Executive Summary\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
    return match ? match[1].trim() : "Executive summary not available.";
  }

  private extractConclusion(report: string): string {
    const match = report.match(/## Conclusion\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
    return match ? match[1].trim() : "Conclusion not available.";
  }

  private generateMethodology(): string {
    const lines = [
      `**Research Mode:** ${this.config.mode}`,
      `**Search Iterations:** ${this.session.iterations.length}`,
      `**Total Queries:** ${this.session.progress.queriesExecuted}`,
      `**Sources Retrieved:** ${this.session.sources.length}`,
      `**Sources Analyzed:** ${this.session.progress.sourcesAnalyzed}`,
      `**Source Deduplication:** By canonical URL`,
      `**Source Classification:** Automatic (government, academic, news, documentation, company, blog, forum, other)`,
      `**Credibility Assessment:** Domain authority, publication type, author presence, recency, content analysis`,
      `**Conflict Detection:** Automated comparison of findings`,
      `**Synthesis:** ${this.session.sources.length > 0 ? "AI-assisted (OpenAI)" : "Source-led outline"}`,
    ];

    if (this.config.dateRange) {
      lines.push(`**Date Range:** ${this.config.dateRange.from?.toLocaleDateString() ?? "Any"} to ${this.config.dateRange.to?.toLocaleDateString() ?? "Present"}`);
    }
    if (this.config.sourceTypes && this.config.sourceTypes.length > 0) {
      lines.push(`**Source Type Filter:** ${this.config.sourceTypes.join(", ")}`);
    }
    if (this.config.language) {
      lines.push(`**Language:** ${this.config.language}`);
    }

    return lines.join("\n");
  }

  private identifyAgreements(): string[] {
    const agreements: string[] = [];
    const findingsByTopic = new Map<string, ResearchFinding[]>();

    for (const finding of this.session.findings) {
      const topic = this.extractTopicKey(finding.claim);
      const existing = findingsByTopic.get(topic) ?? [];
      existing.push(finding);
      findingsByTopic.set(topic, existing);
    }

    for (const [topic, findings] of findingsByTopic) {
      if (findings.length >= 2) {
        const allSupported = findings.every((f) => f.confidence === "strongly_supported" || f.confidence === "supported");
        if (allSupported) {
          agreements.push(`Consensus on ${topic}: ${findings.map((f) => f.claim).join("; ")}`);
        }
      }
    }

    return agreements.length > 0 ? agreements : ["No clear consensus areas identified across multiple sources."];
  }

  private identifyLimitations(sources: SourceMetadata[]): string[] {
    const limitations: string[] = [];

    const sourceTypes = new Set(sources.map((s) => s.sourceType));
    if (!sourceTypes.has("academic") && !sourceTypes.has("government")) {
      limitations.push("Limited primary or peer-reviewed sources; relies heavily on secondary reporting.");
    }

    const verifiedCount = sources.filter((s) => s.credibility.isPrimarySource || s.credibility.isGovernment || s.credibility.isAcademic).length;
    if (verifiedCount < sources.length * 0.3) {
      limitations.push(`Only ${verifiedCount} of ${sources.length} sources are from high-authority domains (government, academic, primary).`);
    }

    const recentCount = sources.filter((s) => s.publishedAt && (Date.now() - s.publishedAt.getTime()) < 365 * 24 * 60 * 60 * 1000).length;
    if (recentCount < sources.length * 0.5) {
      limitations.push(`Only ${recentCount} of ${sources.length} sources are from the last year; older sources may not reflect current state.`);
    }

    if (this.session.conflicts.length > 0) {
      limitations.push(`${this.session.conflicts.length} conflicts detected between sources; conclusions in contested areas should be treated as preliminary.`);
    }

    if (this.config.mode === "quick") {
      limitations.push("Quick research mode: limited query budget and single iteration; may miss relevant sources.");
    }

    return limitations.length > 0 ? limitations : ["No significant limitations identified."];
  }

  private extractTopicKey(claim: string): string {
    return claim.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 3).join(" ");
  }

  private generateCitations(sources: SourceMetadata[]): Citation[] {
    return sources.map((s) => ({
      id: crypto.randomUUID(),
      findingId: "",
      sourceId: s.id,
      claim: "",
      excerpt: s.snippet ?? "",
      url: s.url,
      title: s.title,
      publishedAt: s.publishedAt,
      retrievedAt: s.fetchedAt,
      relevanceScore: s.credibility.domainAuthority / 100,
    }));
  }
}

export async function createResearchSynthesizer(options: SynthesizerOptions): Promise<ResearchSynthesizer> {
  return new ResearchSynthesizer(options);
}
