/**
 * Runtime input validation and sanitization for API boundaries.
 * Zod schemas + helpers for sanitizing untrusted content.
 */
import { z } from "zod";
import { audit, type AuditContext } from "@/security/audit";
import { UPLOAD_MAX_BYTES } from "@/config";

export const maxLength = (n: number) => (msg: string) => z.string().max(n, msg);

export const emailSchema = z.string().email().max(254).transform((e) => e.trim().toLowerCase());

export const passwordSchema = z
  .string({
    message: "Password must be at least 8 characters",
  })
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  // Require letters + numbers, nothing unusual; unicode-safe length check.
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), {
    message: "Password must contain at least one letter and one number",
  });

export const nameSchema = z
  .string()
  .min(1, "Name is required")
  .max(80, "Name is too long")
  .transform((v) => v.trim());

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
});

export const chatSchema = z.object({
  conversationId: z.string().cuid().optional().nullable(),
  content: z.string().min(1, "Message cannot be empty").max(32000, "Message is too long"),
  model: z.string().max(120).optional().nullable(),
  agent: z.string().max(120).optional().nullable(),
  projectId: z.string().cuid().optional().nullable(),
  attachments: z
    .array(
      z.object({
        name: z.string().max(255),
        type: z.string().max(255),
        size: z.number().int().max(UPLOAD_MAX_BYTES).optional(),
        dataUrl: z.string().max(4_000_000).optional(), // base64 (images/text snippets)
      }),
    )
    .max(8)
    .optional(),
});

export const settingsSchema = z.object({
  name: z.string().min(1).max(80).trim().optional(),
  defaultModel: z.string().max(120).optional(),
  defaultAgent: z.string().max(120).optional(),
  memoryEnabled: z.boolean().optional(),
});

export async function validatePayload<T>(
  schema: z.ZodType<T>,
  input: unknown,
  ctx?: AuditContext,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    await audit("security.validation_failed", ctx, {
      path: first?.path.join("."),
      code: first?.code,
    }).catch(() => {});
    return { ok: false, error: first?.message ?? "Invalid request data." };
  }
  return { ok: true, data: result.data };
}

/**
 * Sanitize untrusted text (extracted from web pages / uploaded files)
 * before it is inserted into the conversation as *content* rather than
 * instructions. Keeps surrounding whitespace and readable prose intact.
 * NOTE: separation of UNTRUSTED content from SYSTEM/DEVELOPER/USER message
 * roles happens inside the prompt builder (src/ai/prompts/safety.ts).
 */
export function sanitizeUntrustedText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .slice(0, 200_000);
}

/** Block obvious try-to-do/ignore-style tokens already at the transport layer. */
export function containsPromptAttack(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns = [/ignore (all )?(previous|prior|above) instructions/, /you are now (davinci|gpt)/, /system prompt override/];
  return patterns.some((r) => r.test(lower));
}