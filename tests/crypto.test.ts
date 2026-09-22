import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret, last4, maskKey } from "@/security/crypto";

describe("crypto (AES-256-GCM)", () => {
  it("round-trips a secret", () => {
    const secret = "sk-test-1234567890";
    const { ciphertext, iv } = encryptSecret(secret);
    expect(decryptSecret(ciphertext, iv)).toBe(secret);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("throws when tampered", () => {
    const { ciphertext, iv } = encryptSecret("hello");
    const flipped = (BigInt("0x" + ciphertext) ^ BigInt(1)).toString(16);
    expect(() => decryptSecret(flipped, iv)).toThrow();
  });

  it("masks keys", () => {
    expect(last4("sk-abcdef")).toBe("cdef");
    expect(maskKey("sk-abcdef")).toContain("cdef");
    expect(maskKey("sk-abcdef")).not.toContain("abcdef".slice(0, 3));
  });
});