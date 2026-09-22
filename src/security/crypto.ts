/**
 * Field-level encryption for secrets (user-supplied API keys).
 * AES-256-GCM. Master key comes from ENCRYPTION_KEY (hex, 64 chars).
 */
import crypto from "node:crypto";
import { config } from "@/config";

const KEY_HEX = /^[0-9a-fA-F]{64}$/;
const keyMaterial = KEY_HEX.test(config.ENCRYPTION_KEY)
  ? Buffer.from(config.ENCRYPTION_KEY, "hex")
  : crypto.createHash("sha256").update(config.ENCRYPTION_KEY).digest();

export function encryptSecret(plaintext: string): { ciphertext: string; iv: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([enc, tag]).toString("hex"),
    iv: iv.toString("hex"),
  };
}

export function decryptSecret(ciphertextHex: string, ivHex: string): string {
  const data = Buffer.from(ciphertextHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  if (data.length < 16) throw new Error("Invalid ciphertext");
  const payload = data.subarray(0, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt secret");
  }
}

export function last4(secret: string): string {
  const trimmed = secret.trim().slice(-4);
  return trimmed || "****";
}

export function maskKey(secret: string): string {
  const l4 = last4(secret);
  return `••••••••${l4}`;
}