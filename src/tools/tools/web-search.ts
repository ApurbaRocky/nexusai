/**
 * Web search tool (LOW risk). Replaceable search providers behind one facade.
 * Providers: none (disabled) | mock (clearly labelled) | brave | serper | tavily.
 *
 * Never invents results: unavailable/unconfigured -> ToolUnavailableError
 * with a friendly message so the UI can surface an actionable state.
 */
import { z } from "zod";
import type { ToolDef, ToolOutput } from "@/tools/types";
import { ToolUnavailableError } from "@/tools/types";
import { config } from "@/config";
import type { ChatSource } from "@/types";

export interface SearchResult {
  title: string;
  url: string;
  provider: string;
  publishedAt?: string;
  snippet?: string;
  relevance?: number;
  verified?: boolean;
}

export interface WebSearchAdapter {
  readonly id: string;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

// --- Mock adapter (development testing only, clearly labelled) -------------
export class MockSearchAdapter implements WebSearchAdapter {
  readonly id = "mock";
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [
      {
        title: `[MOCK] Overview — ${query.slice(0, 60)}`,
        url: "https://example.com/mock-overview",
        provider: "mock",
        snippet: "MOCK DATA. This is a development-only search result, not a real source. Configure a Search API key to get real results.",
        relevance: 0.9,
        verified: false,
      },
      {
        title: `[MOCK] Related discussion — ${query.slice(0, 40)}`,
        url: "https://example.com/mock-related",
        provider: "mock",
        snippet: "MOCK DATA. Clearly labelled placeholder used only when SEARCH_PROVIDER=mock.",
        relevance: 0.7,
        verified: false,
      },
    ];
    return results.slice(0, limit);
  }
}

// --- Brave Search ------------------------------------------------------------
class BraveSearchAdapter implements WebSearchAdapter {
  readonly id = "brave";
  constructor(private key: string, private baseUrl = "https://api.search.brave.com/res/v1/web/search") {}
  async search(query: string, limit = 8): Promise<SearchResult[]> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(limit));
    const res = await fetch(url, { headers: { "X-Subscription-Token": this.key, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Search service error (${res.status}).`);
    const data = (await res.json()) as {
      web?: { results?: { title?: string; url?: string; age?: string; description?: string }[] };
    };
    return (data.web?.results ?? []).map((r) => ({
      title: r.title ?? "Untitled",
      url: r.url ?? "",
      provider: "brave",
      publishedAt: r.age,
      snippet: r.description,
      verified: false,
    }));
  }
}

// --- Serper.dev --------------------------------------------------------------
class SerperSearchAdapter implements WebSearchAdapter {
  readonly id = "serper";
  constructor(private key: string) {}
  async search(query: string, limit = 8): Promise<SearchResult[]> {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": this.key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: limit }),
    });
    if (!res.ok) throw new Error(`Search service error (${res.status}).`);
    const data = (await res.json()) as { organic?: { title?: string; link?: string; date?: string; snippet?: string }[] };
    return (data.organic ?? []).map((r) => ({
      title: r.title ?? "Untitled",
      url: r.link ?? "",
      provider: "serper",
      publishedAt: r.date,
      snippet: r.snippet,
      verified: false,
    }));
  }
}

// --- Tavily --------------------------------------------------------------------
class TavilySearchAdapter implements WebSearchAdapter {
  readonly id = "tavily";
  constructor(private key: string) {}
  async search(query: string, limit = 8): Promise<SearchResult[]> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: this.key, query, max_results: limit, include_answer: false }),
    });
    if (!res.ok) throw new Error(`Search service error (${res.status}).`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; published_date?: string; content?: string; score?: number }[] };
    return (data.results ?? []).map((r) => ({
      title: r.title ?? "Untitled",
      url: r.url ?? "",
      provider: "tavily",
      publishedAt: r.published_date,
      snippet: r.content,
      relevance: r.score,
      verified: false,
    }));
  }
}

export function searchAdapter(): WebSearchAdapter {
  switch (config.SEARCH_PROVIDER) {
    case "brave":
      if (!config.SEARCH_API_KEY) throw new ToolUnavailableError("web-search", "Brave Search selected but SEARCH_API_KEY is not set.");
      return new BraveSearchAdapter(config.SEARCH_API_KEY);
    case "serper":
      if (!config.SEARCH_API_KEY) throw new ToolUnavailableError("web-search", "Serper selected but SEARCH_API_KEY is not set.");
      return new SerperSearchAdapter(config.SEARCH_API_KEY);
    case "tavily":
      if (!config.SEARCH_API_KEY) throw new ToolUnavailableError("web-search", "Tavily selected but SEARCH_API_KEY is not set.");
      return new TavilySearchAdapter(config.SEARCH_API_KEY);
    case "mock":
      return new MockSearchAdapter();
    case "none":
    default:
      throw new ToolUnavailableError(
        "web-search",
        "Web search is not configured. Set SEARCH_PROVIDER (brave, serper, tavily; or mock for development) in .env or Settings.",
      );
  }
}

const inputSchema = z.object({
  query: z.string().min(1, "Query cannot be empty").max(300).describe("Search query"),
  limit: z.number().int().min(1).max(10).default(5).optional(),
});

export const webSearchTool: ToolDef<typeof inputSchema> = {
  name: "web_search",
  description: "Search the web for recent, relevant information and return titles, URLs and snippets.",
  inputSchema,
  riskLevel: "low",
  async execute({ query, limit = 5 }): Promise<ToolOutput> {
    const adapter = searchAdapter();
    const started = Date.now();
    const results = await adapter.search(query, limit);
    const lines = results.map((r, i) => {
      const date = r.publishedAt ? ` (${r.publishedAt})` : "";
      return `${i + 1}. ${r.title}${date}\n   URL: ${r.url}\n   ${r.snippet ?? "No snippet."}`;
    });
    return {
      content: lines.length ? lines.join("\n\n") : "No results found.",
      data: { query, durationMs: Date.now() - started, results, provider: adapter.id },
    };
  },
};

export function searchResultsToSources(results: SearchResult[]): ChatSource[] {
  return results.map((r) => ({
    title: r.title,
    url: r.url,
    provider: r.provider,
    publishedAt: r.publishedAt,
    snippet: r.snippet,
    relevance: r.relevance,
    verified: r.verified,
  }));
}