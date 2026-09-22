/**
 * Source Verifier (Phase 2).
 * Verifies source credibility, extracts evidence, detects conflicts,
 * and assesses evidence quality.
 */
import { getProvider } from "@/ai/providers/registry";
import { resolveKeySource } from "@/security/api-key-resolver";
import { lookupModel } from "@/ai/model-catalog";
import type {
  SourceMetadata,
  ResearchFinding,
  ResearchQuestion,
  Evidence,
  Conflict,
  ConfidenceLevel,
  CredibilityMetadata,
} from "@/agents/research/research-types";
import { log } from "@/utils/log";

export interface VerifierOptions {
  userId: string;
  sessionId: string;
}

export class SourceVerifier {
  private userId: string;
  private sessionId: string;

  constructor(options: VerifierOptions) {
    this.userId = options.userId;
    this.sessionId = options.sessionId;
  }

  async verifySource(source: SourceMetadata, fullContent?: string): Promise<SourceMetadata> {
    const credibility = await this.assessCredibility(source, fullContent);
    const isVerified = this.determineVerification(credibility);
    if (isVerified) {
      credibility.notes.push("Source passed automated credibility verification.");
    }

    return {
      ...source,
      credibility,
      retrievalStatus: fullContent ? "success" : "partial",
      lastVerifiedAt: new Date(),
    };
  }

  async extractEvidence(
    source: SourceMetadata,
    researchQuestions: ResearchQuestion[],
    fullContent: string
  ): Promise<Evidence[]> {
    const key = await resolveKeySource(this.userId, "openai");
    const model = lookupModel("openai:gpt-4o-mini");
    const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

    if (!provider || !model || !fullContent) {
      return this.extractHeuristicEvidence(source, researchQuestions, fullContent);
    }

    try {
      const prompt = `Extract evidence from the following source that relates to these research questions.

Source: ${source.title} (${source.url})
Content: ${fullContent.slice(0, 8000)}

Research Questions:
${researchQuestions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}

Return ONLY a JSON array of objects with: { "questionIndex": number, "excerpt": string, "supports": "supports"|"contradicts"|"neutral", "relevanceScore": number (0-1) }.
Only include excerpts that are directly relevant. Be precise - quote exact sentences.`;

      const result = await provider.complete({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        maxTokens: 1500,
      });

      const extracted = JSON.parse(result.content) as Array<{
        questionIndex: number;
        excerpt: string;
        supports: "supports" | "contradicts" | "neutral";
        relevanceScore: number;
      }>;

      return extracted
        .filter((e) => e.questionIndex >= 0 && e.questionIndex < researchQuestions.length)
        .map((e) => ({
          sourceId: source.id,
          excerpt: e.excerpt,
          url: source.url,
          relevanceScore: Math.max(0, Math.min(1, e.relevanceScore)),
          supports: e.supports,
          researchQuestionId: researchQuestions[e.questionIndex]?.id,
        }));
    } catch (err) {
      log.warn("verifier-extract-failed", { error: (err as Error).message });
      return this.extractHeuristicEvidence(source, researchQuestions, fullContent);
    }
  }

  async detectConflicts(findings: ResearchFinding[]): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    for (let i = 0; i < findings.length; i++) {
      for (let j = i + 1; j < findings.length; j++) {
        const conflict = await this.compareFindings(findings[i], findings[j]);
        if (conflict) conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  async assessFindingConfidence(finding: ResearchFinding): Promise<ConfidenceLevel> {
    const supportingEvidence = finding.evidence.filter((e) => e.supports === "supports");
    const contradictingEvidence = finding.evidence.filter((e) => e.supports === "contradicts");
    const totalSources = new Set(finding.evidence.map((e) => e.sourceId)).size;

    if (supportingEvidence.length === 0) return "uncertain";
    if (contradictingEvidence.length > 0) return "mixed_evidence";

    const avgRelevance = supportingEvidence.reduce((sum, e) => sum + e.relevanceScore, 0) / supportingEvidence.length;
    const highQualitySources = supportingEvidence.filter((e) => e.relevanceScore > 0.7).length;

    if (totalSources >= 3 && highQualitySources >= 2 && avgRelevance > 0.7) return "strongly_supported";
    if (totalSources >= 2 && avgRelevance > 0.6) return "supported";
    if (totalSources >= 1 && avgRelevance > 0.5) return "limited_evidence";

    return "uncertain";
  }

  private async assessCredibility(source: SourceMetadata, fullContent?: string): Promise<CredibilityMetadata> {
    let credibility = { ...source.credibility };

    if (fullContent && fullContent.length > 100) {
      credibility = await this.enhanceCredibilityWithContent(credibility, fullContent, source);
    }

    return credibility;
  }

  private async enhanceCredibilityWithContent(
    credibility: CredibilityMetadata,
    content: string,
    source: SourceMetadata
  ): Promise<CredibilityMetadata> {
    const key = await resolveKeySource(this.userId, "openai");
    const model = lookupModel("openai:gpt-4o-mini");
    const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

    if (!provider || !model) return credibility;

    try {
      const prompt = `Assess the credibility of this source content. Return ONLY JSON with:
{
  "hasCitations": boolean,
  "hasData": boolean,
  "hasMethodology": boolean,
  "isBalanced": boolean,
  "notes": string[]
}

Source: ${source.title} (${source.domain})
Content excerpt: ${content.slice(0, 3000)}`;

      const result = await provider.complete({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        maxTokens: 300,
      });

      const assessment = JSON.parse(result.content) as {
        hasCitations: boolean;
        hasData: boolean;
        hasMethodology: boolean;
        isBalanced: boolean;
        notes: string[];
      };

      if (assessment.hasCitations) credibility.domainAuthority = Math.min(100, credibility.domainAuthority + 5);
      if (assessment.hasData) credibility.domainAuthority = Math.min(100, credibility.domainAuthority + 5);
      if (assessment.hasMethodology) credibility.domainAuthority = Math.min(100, credibility.domainAuthority + 10);
      if (assessment.isBalanced) credibility.domainAuthority = Math.min(100, credibility.domainAuthority + 5);

      credibility.notes.push(...assessment.notes);
    } catch {
      // Ignore LLM assessment failures
    }

    return credibility;
  }

  private determineVerification(credibility: CredibilityMetadata): boolean {
    return (
      credibility.isPrimarySource ||
      credibility.isGovernment ||
      credibility.isAcademic ||
      credibility.isPeerReviewed ||
      credibility.domainAuthority >= 80
    );
  }

  private extractHeuristicEvidence(
    source: SourceMetadata,
    researchQuestions: ResearchQuestion[],
    content?: string
  ): Evidence[] {
    if (!content || content.length < 50) return [];

    const evidence: Evidence[] = [];
    const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length > 30);

    for (const question of researchQuestions) {
      const keywords = question.question.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (keywords.length === 0) continue;
      const relevantSentences = sentences.filter((sentence) =>
        keywords.some((keyword) => sentence.toLowerCase().includes(keyword))
      );

      for (const sentence of relevantSentences.slice(0, 2)) {
        evidence.push({
          sourceId: source.id,
          excerpt: sentence.trim(),
          url: source.url,
          relevanceScore: 0.5,
          supports: "supports",
          researchQuestionId: question.id,
        });
      }
    }

    return evidence;
  }

  private async compareFindings(f1: ResearchFinding, f2: ResearchFinding): Promise<Conflict | null> {
    if (f1.claim.toLowerCase() === f2.claim.toLowerCase()) return null;

    const key = await resolveKeySource(this.userId, "openai");
    const model = lookupModel("openai:gpt-4o-mini");
    const provider = key.apiKey ? getProvider("openai", key.apiKey) : null;

    if (!provider || !model) return this.heuristicConflictDetection(f1, f2);

    try {
      const prompt = `Compare these two research findings for contradictions.

Finding 1: ${f1.claim}
Evidence: ${f1.evidence.map((e) => e.excerpt).join(" | ")}

Finding 2: ${f2.claim}
Evidence: ${f2.evidence.map((e) => e.excerpt).join(" | ")}

Do these findings contradict each other? Return ONLY JSON:
{ "conflicts": boolean, "description": string, "source1Claim": string, "source2Claim": string }`;

      const result = await provider.complete({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        maxTokens: 300,
      });

      const assessment = JSON.parse(result.content) as {
        conflicts: boolean;
        description: string;
        source1Claim: string;
        source2Claim: string;
      };

      if (!assessment.conflicts) return null;

      return {
        id: crypto.randomUUID(),
        findingId: f1.id,
        description: assessment.description,
        sources: [
          { sourceId: f1.sourceIds[0] ?? "", claim: assessment.source1Claim, excerpt: f1.evidence[0]?.excerpt ?? "", url: f1.evidence[0]?.url ?? "" },
          { sourceId: f2.sourceIds[0] ?? "", claim: assessment.source2Claim, excerpt: f2.evidence[0]?.excerpt ?? "", url: f2.evidence[0]?.url ?? "" },
        ],
        detectedAt: new Date(),
      };
    } catch {
      return this.heuristicConflictDetection(f1, f2);
    }
  }

  private heuristicConflictDetection(f1: ResearchFinding, f2: ResearchFinding): Conflict | null {
    const keywords1 = new Set(f1.claim.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const keywords2 = new Set(f2.claim.toLowerCase().split(/\s+/).filter((w) => w.length > 3));

    const intersection = [...keywords1].filter((k) => keywords2.has(k));
    const overlap = intersection.length / Math.max(keywords1.size, keywords2.size);

    if (overlap > 0.5) {
      return {
        id: crypto.randomUUID(),
        findingId: f1.id,
        description: `Potential overlap/conflict detected between findings on similar topics (${overlap * 100}% keyword overlap)`,
        sources: [
          { sourceId: f1.sourceIds[0] ?? "", claim: f1.claim, excerpt: f1.evidence[0]?.excerpt ?? "", url: f1.evidence[0]?.url ?? "" },
          { sourceId: f2.sourceIds[0] ?? "", claim: f2.claim, excerpt: f2.evidence[0]?.excerpt ?? "", url: f2.evidence[0]?.url ?? "" },
        ],
        detectedAt: new Date(),
      };
    }

    return null;
  }
}

export async function createSourceVerifier(options: VerifierOptions): Promise<SourceVerifier> {
  return new SourceVerifier(options);
}
