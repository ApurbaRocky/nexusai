"use server";

import { signIn } from "@/auth/auth";

export interface LoginActionResult {
  error?: string;
}

export async function loginAction(formData: FormData): Promise<LoginActionResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const result = await signIn("credentials", { email, password, redirect: false }).catch((err) => {
    // Auth.js throws on failed credentials when redirect:false on some versions.
    return err as Error;
  });

  const error = (result as { error?: string })?.error;
  if (error) return { error };

  const raw = result as unknown as { error?: string; ok?: boolean; status?: number; url?: string } | Error;
  if (raw instanceof Error) {
    return { error: "Invalid email or password." };
  }
  if (raw && (raw.ok === false || raw.status === 401 || typeof raw.error === "string")) {
    return { error: "Invalid email or password." };
  }

  // On success redirect through the login page via ?logged_in=1 so the client
  // can navigate; the proxy will bounce signed-in users off /login anyway.
  return {};
}