/**
 * Research Agent Types (Phase 2).
 * Core domain types for the research pipeline.
 */

export type ResearchMode = "quick" | "standard" | "deep";

export type ResearchStatus =
  | "planning"
  | "searching"
  | "analyzing"
  | "verifying"
  | "synthesizing"
  | "complete"
  | "failed"
  | "cancelled";

export type SourceType =
  | "news"
  | "academic"
  | "government"
  | "documentation"
  | "company"
  | "blog"
  | "forum"
  | "other";

export type ConfidenceLevel =
  | "strongly_supported"
  | "supported"
  | "mixed_evidence"
  | "limited_evidence"
  | "uncertain";

export interface ResearchConfig {
  mode: ResearchMode;
  maxQueries: number;
  maxSources: number;
  maxIterations: number;
  maxContentLength: number;
  maxResearchTimeMs: number;
  dateRange?: { from?: Date; to?: Date };
  sourceTypes?: SourceType[];
  language?: string;
  depth?: ResearchMode;
}

export interface ResearchPlan {
  id: string;
  researchQuestion: string;
  goal?: string;
  questions: ResearchQuestion[];
  searchStrategy: SearchStrategy;
  estimatedQueries: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResearchQuestion {
  id: string;
  question: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "complete" | "skipped";
  assignedQueries: string[];
  findings: ResearchFinding[];
}

export interface SearchStrategy {
  primaryQueries: string[];
  followUpQueries: string[];
  sourceTypePriorities: SourceType[];
  dateRange?: { from?: Date; to?: Date };
  language?: string;
}

export interface SearchIteration {
  id: string;
  query: string;
  results: NormalizedSearchResult[];
  sourcesAdded: number;
  timestamp: Date;
  reasoning: string;
}

export interface NormalizedSearchResult {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: Date;
  author?: string;
  sourceType: SourceType;
  relevanceScore: number;
  content?: string;
  contentLength: number;
  retrievedAt: Date;
  searchProvider: string;
  searchQuery: string;
}

export interface SourceMetadata {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  domain: string;
  sourceType: SourceType;
  publishedAt?: Date;
  author?: string;
  language?: string;
  /** Short excerpt returned by the search provider (never fabricated). */
  snippet?: string;
  /** Search provider that surfaced this source, e.g. "brave". */
  provider?: string;
  /** Full extracted content from the source (if fetched). */
  content?: string;
  credibility: CredibilityMetadata;
  retrievalStatus: "pending" | "success" | "failed" | "partial";
  contentHash?: string;
  contentLength: number;
  fetchedAt: Date;
  lastVerifiedAt?: Date;
}

export interface CredibilityMetadata {
  domainAuthority: number;
  isPrimarySource: boolean;
  isGovernment: boolean;
  isAcademic: boolean;
  isPeerReviewed: boolean;
  hasAuthor: boolean;
  publicationDate?: Date;
  citationCount?: number;
  notes: string[];
}

export interface ResearchFinding {
  id: string;
  researchQuestionId: string;
  claim: string;
  evidence: Evidence[];
  sourceIds: string[];
  confidence: ConfidenceLevel;
  category: string;
  conflicts: Conflict[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Evidence {
  sourceId: string;
  excerpt: string;
  url: string;
  relevanceScore: number;
  supports: "supports" | "contradicts" | "neutral";
  /** Research question this excerpt answers, when the extractor resolved one. */
  researchQuestionId?: string;
}

export interface Conflict {
  id: string;
  findingId: string;
  description: string;
  sources: ConflictingSource[];
  resolution?: string;
  detectedAt: Date;
}

export interface ConflictingSource {
  sourceId: string;
  claim: string;
  excerpt: string;
  url: string;
}

export interface Citation {
  id: string;
  findingId: string;
  sourceId: string;
  claim: string;
  excerpt: string;
  url: string;
  title: string;
  publishedAt?: Date;
  retrievedAt: Date;
  relevanceScore: number;
}

export interface ResearchReport {
  id: string;
  sessionId: string;
  title: string;
  /** Full rendered markdown body of the report. */
  markdown: string;
  executiveSummary: string;
  researchQuestion: string;
  methodology: string;
  keyFindings: ResearchFinding[];
  evidence: Evidence[];
  areasOfAgreement: string[];
  conflictingEvidence: Conflict[];
  limitations: string[];
  conclusion: string;
  references: Citation[];
  metadata: ReportMetadata;
  createdAt: Date;
}

export interface ReportMetadata {
  mode: ResearchMode;
  totalQueries: number;
  totalSources: number;
  totalIterations: number;
  durationMs: number;
  searchProviders: string[];
  synthesisProvider: string;
  dateRange?: { from?: Date; to?: Date };
  sourceTypes: SourceType[];
  language: string;
}

export interface ResearchSession {
  id: string;
  userId: string;
  projectId?: string;
  topic: string;
  goal?: string;
  mode: ResearchMode;
  config: ResearchConfig;
  status: ResearchStatus;
  plan?: ResearchPlan;
  iterations: SearchIteration[];
  sources: SourceMetadata[];
  findings: ResearchFinding[];
  conflicts: Conflict[];
  report?: ResearchReport;
  progress: ResearchProgress;
  cost: ResearchCost;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface ResearchProgress {
  currentStep: string;
  stepsCompleted: string[];
  totalSteps: number;
  sourcesFound: number;
  sourcesAnalyzed: number;
  queriesExecuted: number;
  iterationsCompleted: number;
  percentage: number;
}

export interface ResearchCost {
  searchRequests: number;
  aiRequests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
}

export interface ResearchFilters {
  dateRange?: { from?: Date; to?: Date };
  sourceTypes?: SourceType[];
  language?: string;
  mode?: ResearchMode;
  minRelevance?: number;
  verifiedOnly?: boolean;
}

export const DEFAULT_RESEARCH_CONFIG: Record<ResearchMode, ResearchConfig> = {
  quick: {
    mode: "quick",
    maxQueries: 5,
    maxSources: 10,
    maxIterations: 1,
    maxContentLength: 50000,
    maxResearchTimeMs: 60000,
  },
  standard: {
    mode: "standard",
    maxQueries: 10,
    maxSources: 25,
    maxIterations: 2,
    maxContentLength: 150000,
    maxResearchTimeMs: 180000,
  },
  deep: {
    mode: "deep",
    maxQueries: 25,
    maxSources: 50,
    maxIterations: 5,
    maxContentLength: 500000,
    maxResearchTimeMs: 600000,
  },
};

export function getConfigForMode(mode: ResearchMode): ResearchConfig {
  return { ...DEFAULT_RESEARCH_CONFIG[mode] };
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function classifySourceType(url: string, title: string, snippet?: string): SourceType {
  const domain = extractDomain(url).toLowerCase();
  const text = `${title} ${snippet ?? ""}`.toLowerCase();

  if (/\.gov($|\/)/.test(domain) || /government|official/.test(text)) return "government";
  if (/\.edu($|\/)/.test(domain) || /university|college|institute|journal|doi|arxiv|pubmed/.test(text)) return "academic";
  if (/news|reuters|apnews|bbc|cnn|nytimes|wsj|ft\.com|theguardian|bloomberg/.test(domain)) return "news";
  if (/docs|documentation|api|reference|manual|guide|tutorial|github\.com\/.*\/wiki/.test(domain)) return "documentation";
  if (/company|corporation|inc\.|ltd\.|blog\.|medium\.com|substack/.test(text)) return "company";
  if (/blog|forum|reddit|stackexchange|stack overflow|quora|hackernews/.test(domain)) return "forum";
  if (/blog|medium\.com|substack|personal|opinion/.test(text)) return "blog";

  return "other";
}

/** Shape returned by the research workflow to the HTTP layer. */
export interface ResearchRunOutput {
  sessionId: string;
  status: "complete" | "failed";
  sources: ResearchSourceSummary[];
  /** Markdown report, or "" when synthesis produced nothing. */
  report: string;
  note?: string;
}

export interface ResearchSourceSummary {
  title: string;
  url: string;
  provider?: string;
  publishedAt?: string;
  snippet?: string;
  relevance?: number;
  verified?: boolean;
}
