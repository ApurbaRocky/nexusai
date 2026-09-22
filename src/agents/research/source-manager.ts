/**
 * Source Manager (Phase 2).
 * Handles source discovery, deduplication, normalization, content retrieval,
 * and metadata management for research sessions.
 */
import { prisma } from "@/database/client";
import type {
  NormalizedSearchResult,
  SourceMetadata,
  SourceType,
  ResearchConfig,
  CredibilityMetadata,
} from "@/agents/research/research-types";
import { normalizeUrl, extractDomain, classifySourceType } from "@/agents/research/research-types";

export interface SourceManagerOptions {
  sessionId: string;
  config: ResearchConfig;
  userId: string;
}

export class SourceManager {
  private sessionId: string;
  private config: ResearchConfig;
  private userId: string;
  private seenCanonicalUrls = new Set<string>();

  constructor(options: SourceManagerOptions) {
    this.sessionId = options.sessionId;
    this.config = options.config;
    this.userId = options.userId;
  }

  async addSearchResults(results: NormalizedSearchResult[]): Promise<SourceMetadata[]> {
    const added: SourceMetadata[] = [];

    for (const result of results) {
      if (added.length >= this.config.maxSources) break;

      const canonicalUrl = normalizeUrl(result.url);
      if (this.seenCanonicalUrls.has(canonicalUrl)) continue;
      this.seenCanonicalUrls.add(canonicalUrl);

      const metadata = await this.createSourceMetadata(result);
      await this.persistSource(metadata);
      added.push(metadata);
    }

    return added;
  }

  async getSources(): Promise<SourceMetadata[]> {
    const sources = await prisma.source.findMany({
      where: { researchSessionId: this.sessionId },
      orderBy: { relevance: "desc" },
    });

    return sources.map(toSourceMetadata);
  }

  async getSourceById(id: string): Promise<SourceMetadata | null> {
    const source = await prisma.source.findFirst({
      where: { id, researchSessionId: this.sessionId },
    });
    return source ? toSourceMetadata(source) : null;
  }

  /**
   * Persist retrieved page text. `contentLength` is derived from `content`
   * (the Source table has no such column), and the snippet is only filled in
   * when the search provider gave us nothing to begin with.
   */
  async updateSourceContent(sourceId: string, content: string, snippet?: string): Promise<void> {
    await prisma.source.update({
      where: { id: sourceId },
      data: {
        content,
        ...(snippet ? { snippet } : {}),
        fetchedAt: new Date(),
      },
    });
  }

  async updateSourceVerification(sourceId: string, verified: boolean): Promise<void> {
    await prisma.source.update({
      where: { id: sourceId },
      data: { verified, fetchedAt: new Date() },
    });
  }

  async getSourcesByType(type: SourceType): Promise<SourceMetadata[]> {
    const all = await this.getSources();
    return all.filter((s) => s.sourceType === type);
  }

  async getVerifiedSources(): Promise<SourceMetadata[]> {
    const all = await this.getSources();
    return all.filter((s) => s.credibility.isPrimarySource || s.credibility.isGovernment || s.credibility.isAcademic || s.credibility.isPeerReviewed);
  }

  async getSourceCount(): Promise<number> {
    return prisma.source.count({ where: { researchSessionId: this.sessionId } });
  }

  async getSourceStats(): Promise<{
    total: number;
    byType: Record<SourceType, number>;
    verified: number;
    withContent: number;
    totalContentLength: number;
  }> {
    const sources = await this.getSources();
    const byType: Record<SourceType, number> = {
      news: 0,
      academic: 0,
      government: 0,
      documentation: 0,
      company: 0,
      blog: 0,
      forum: 0,
      other: 0,
    };

    let verified = 0;
    let withContent = 0;
    let totalContentLength = 0;

    for (const s of sources) {
      byType[s.sourceType]++;
      if (s.credibility.isPrimarySource || s.credibility.isGovernment || s.credibility.isAcademic || s.credibility.isPeerReviewed) verified++;
      if (s.contentLength > 0) withContent++;
      totalContentLength += s.contentLength;
    }

    return { total: sources.length, byType, verified, withContent, totalContentLength };
  }

  private async createSourceMetadata(result: NormalizedSearchResult): Promise<SourceMetadata> {
    const domain = extractDomain(result.url);
    const sourceType = classifySourceType(result.url, result.title, result.snippet);
    const credibility = this.assessCredibility(domain, result, sourceType);

    return {
      id: result.id,
      url: result.url,
      canonicalUrl: normalizeUrl(result.url),
      title: result.title,
      domain,
      sourceType,
      publishedAt: result.publishedAt,
      author: result.author,
      credibility,
      retrievalStatus: "pending",
      contentLength: result.contentLength,
      fetchedAt: new Date(),
    };
  }

  private assessCredibility(domain: string, result: NormalizedSearchResult, sourceType: SourceType): CredibilityMetadata {
    const notes: string[] = [];
    let domainAuthority = 50;

    if (sourceType === "government") {
      domainAuthority = 95;
      notes.push("Government domain");
    } else if (sourceType === "academic") {
      domainAuthority = 90;
      notes.push("Academic institution or journal");
    } else if (sourceType === "news") {
      domainAuthority = 75;
      notes.push("Established news organization");
    } else if (sourceType === "documentation") {
      domainAuthority = 80;
      notes.push("Official documentation");
    }

    const isPrimarySource = sourceType === "government" || sourceType === "academic" || sourceType === "documentation";
    const isGovernment = sourceType === "government";
    const isAcademic = sourceType === "academic";
    const isPeerReviewed = sourceType === "academic" && /journal|peer.?review|doi|arxiv|pubmed/.test(`${result.title} ${result.snippet ?? ""}`.toLowerCase());
    const hasAuthor = Boolean(result.author && result.author.trim().length > 0);

    if (hasAuthor) {
      domainAuthority += 5;
      notes.push("Author identified");
    }

    if (result.publishedAt) {
      const ageDays = (Date.now() - result.publishedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < 30) {
        domainAuthority += 5;
        notes.push("Recent publication");
      } else if (ageDays > 365 * 5) {
        domainAuthority -= 10;
        notes.push("Older publication (>5 years)");
      }
    }

    domainAuthority = Math.max(0, Math.min(100, domainAuthority));

    return {
      domainAuthority,
      isPrimarySource,
      isGovernment,
      isAcademic,
      isPeerReviewed,
      hasAuthor,
      publicationDate: result.publishedAt,
      notes,
    };
  }

  private async persistSource(metadata: SourceMetadata): Promise<void> {
    await prisma.source.create({
      data: {
        researchSessionId: this.sessionId,
        title: metadata.title,
        url: metadata.url,
        provider: metadata.provider ?? "web",
        publishedAt: metadata.publishedAt ?? null,
        snippet: metadata.snippet ?? "",
        relevance: metadata.credibility.domainAuthority / 100,
        verified: metadata.credibility.isPrimarySource || metadata.credibility.isGovernment || metadata.credibility.isAcademic,
        content: null,
        fetchedAt: metadata.fetchedAt,
      },
    });
  }

}

/** Columns of the Source table that the research domain layer reads back. */
interface SourceRow {
  id: string;
  url: string;
  title: string;
  provider: string | null;
  publishedAt: Date | null;
  snippet: string | null;
  relevance: number | null;
  verified: boolean;
  content: string | null;
  fetchedAt: Date;
}

/**
 * Map a persisted Source row back into the research domain type.
 *
 * The table does not store the classified source type, so it is recomputed from
 * the stored URL/title/snippet. Credibility flags that are not persisted are
 * left false rather than guessed — a wrong "peer reviewed" badge would be worse
 * than a missing one.
 */
export function toSourceMetadata(source: SourceRow): SourceMetadata {
  const sourceType = classifySourceType(source.url, source.title, source.snippet ?? "");
  const notes: string[] = [];
  if (source.verified) notes.push("Reachable and verified");
  if (source.provider) notes.push(`Surfaced via ${source.provider}`);

  return {
    id: source.id,
    url: source.url,
    canonicalUrl: normalizeUrl(source.url),
    title: source.title,
    domain: extractDomain(source.url),
    sourceType,
    publishedAt: source.publishedAt ?? undefined,
    snippet: source.snippet ?? undefined,
    provider: source.provider ?? undefined,
    credibility: {
      domainAuthority: Math.round((source.relevance ?? 0.5) * 100),
      isPrimarySource: source.verified,
      isGovernment: sourceType === "government",
      isAcademic: sourceType === "academic",
      isPeerReviewed: false,
      hasAuthor: false,
      notes,
    },
    retrievalStatus: source.content ? "success" : "pending",
    contentLength: source.content?.length ?? 0,
    fetchedAt: source.fetchedAt,
    lastVerifiedAt: source.verified ? source.fetchedAt : undefined,
  };
}

export async function createSourceManager(options: SourceManagerOptions): Promise<SourceManager> {
  return new SourceManager(options);
}
