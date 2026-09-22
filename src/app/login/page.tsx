import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-background to-muted/40 px-4">
      <LoginForm />
    </div>
  );
}