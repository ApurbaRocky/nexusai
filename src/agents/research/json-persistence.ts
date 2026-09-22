/**
 * JSON persistence helpers for the Research module.
 * Safely parses JSON strings with fallbacks.
 */

export function parseResearch<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}