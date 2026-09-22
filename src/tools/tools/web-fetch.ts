/**
 * Web Content Fetch Tool (LOW risk).
 * Fetches and extracts readable content from web URLs with SSRF protection.
 * Used by the Research Agent to retrieve full source content for verification.
 */
import { z } from "zod";
import type { ToolDef, ToolOutput } from "@/tools/types";
import { ToolUnavailableError } from "@/tools/types";

const MAX_CONTENT_LENGTH = 500_000;
const TIMEOUT_MS = 15_000;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "169.254.169.254",
  "metadata.azure.com",
  "metadata.threatstack.com",
]);

const BLOCKED_PORTS = new Set([22, 23, 25, 53, 110, 143, 465, 587, 993, 995, 3306, 5432, 6379, 8086, 9200, 27017]);

function isPrivateIP(ip: string): boolean {
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^169\.254\./,
    /^::1$/,
    /^fe80::/,
    /^fc00:/,
  ];
  return privateRanges.some((r) => r.test(ip));
}

async function resolveHost(hostname: string): Promise<string[]> {
  try {
    const { addresses } = await import("dns").then((dns) =>
      new Promise<{ addresses: string[] }>((resolve) => {
        dns.resolve4(hostname, (err, addresses) => {
          resolve({ addresses: err ? [] : addresses });
        });
      })
    );
    return addresses;
  } catch {
    return [];
  }
}

async function validateUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, error: "Only HTTP/HTTPS protocols allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(hostname)) {
    return { valid: false, error: "Access to this host is blocked" };
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === "https:" ? 443 : 80);
  if (BLOCKED_PORTS.has(port)) {
    return { valid: false, error: "Access to this port is blocked" };
  }

  const ips = await resolveHost(hostname);
  for (const ip of ips) {
    if (isPrivateIP(ip)) {
      return { valid: false, error: "Access to private IP addresses is blocked" };
    }
  }

  return { valid: true };
}

function extractReadableContent(html: string): { text: string; title: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "Untitled";

  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > MAX_CONTENT_LENGTH) {
    text = text.slice(0, MAX_CONTENT_LENGTH) + "... [truncated]";
  }

  return { text, title };
}

const inputSchema = z.object({
  url: z.string().url().describe("URL to fetch content from"),
  maxLength: z.number().int().min(1000).max(MAX_CONTENT_LENGTH).default(50000).optional(),
});

export const webFetchTool: ToolDef<typeof inputSchema> = {
  name: "web_fetch",
  description: "Fetch and extract readable text content from a web URL. Includes SSRF protection. Returns extracted text and title.",
  inputSchema,
  riskLevel: "low",
  async execute({ url, maxLength = 50000 }): Promise<ToolOutput> {
    const validation = await validateUrl(url);
    if (!validation.valid) {
      throw new ToolUnavailableError("web_fetch", validation.error ?? "URL validation failed");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "AI Nexus Research Bot/1.0 (+https://ainexus.local/bot)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const html = await response.text();
      const { text, title } = extractReadableContent(html);

      const truncated = text.length > maxLength ? text.slice(0, maxLength) + "... [truncated]" : text;

      return {
        content: `Title: ${title}\nURL: ${url}\n\n${truncated}`,
        data: { url, title, contentLength: text.length, truncated: text.length > maxLength },
      };
    } catch (err) {
      clearTimeout(timeout);
      if ((err as Error).name === "AbortError") {
        throw new ToolUnavailableError("web_fetch", "Request timed out");
      }
      throw new ToolUnavailableError("web_fetch", `Failed to fetch content: ${(err as Error).message}`);
    }
  },
};

export async function fetchWebContent(url: string, maxLength = 50000): Promise<{ text: string; title: string; contentLength: number }> {
  const validation = await validateUrl(url);
  if (!validation.valid) {
    throw new Error(validation.error ?? "URL validation failed");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AI Nexus Research Bot/1.0 (+https://ainexus.local/bot)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    const html = await response.text();
    const { text, title } = extractReadableContent(html);

    return { text: text.slice(0, maxLength), title, contentLength: text.length };
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw err;
  }
}