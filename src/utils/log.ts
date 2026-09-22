/**
 * Structured logging. Never writes secrets. Fields: requestId, userId, model,
 * agent, tool, durationMs, tokens. Emits JSON lines; a log transport
 * (file/SIEM) can be attached here later without touching call sites.
 */

export type LogFields = Record<string, string | number | boolean | null | undefined>;

function write(level: "info" | "warn" | "error", message: string, fields?: LogFields) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};

export function safeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/secret|key|password|token|cookie|authorization/i.test(k)) continue;
    out[k] = typeof v === "string" && v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
  }
  return out;
}