/**
 * Central application configuration.
 * Reads from environment variables with safe defaults for local development.
 * No secrets should ever be imported into client components from here.
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Auth
  AUTH_SECRET: z.string().min(1).default("dev-secret-change-me"),

  // Database (PostgreSQL in production, SQLite for local dev)
  DATABASE_URL: z.string().default("file:./prisma/dev.db"),

  // Field-level encryption master key (hex, 32 bytes -> 64 hex chars).
  // Used to encrypt user-provided API keys at rest.
  ENCRYPTION_KEY: z.string().min(32).default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),

  // AI providers (server-side supplier keys)
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_BASE_URL: z.string().optional().default("https://api.openai.com/v1"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  GOOGLE_AI_API_KEY: z.string().optional().default(""),
  GEMINI_BASE_URL: z.string().optional().default("https://generativelanguage.googleapis.com/v1beta"),
  LOCAL_MODEL_BASE_URL: z.string().optional().default("http://localhost:11434/v1"),
  LOCAL_MODEL_NAME: z.string().optional().default("llama3.1"),

  // Web search
  SEARCH_PROVIDER: z.enum(["none", "brave", "serper", "tavily", "mock"]).default("none"),
  SEARCH_API_KEY: z.string().optional().default(""),

  // Embeddings / RAG
  EMBEDDING_PROVIDER: z.enum(["none", "openai", "local"]).default("none"),
  EMBEDDING_MODEL: z.string().optional().default("text-embedding-3-small"),

  // Demo mode: a clearly-labelled mock provider for testing UI without API keys.
  ENABLE_DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Friendly startup error; never leak raw env stack traces to the browser.
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
}

export const config = parsed.data;

export const isProd = config.NODE_ENV === "production";
export const isDev = config.NODE_ENV === "development";
export const isDemoMode = config.ENABLE_DEMO_MODE;

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const ALLOWED_UPLOAD_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/json",
]);