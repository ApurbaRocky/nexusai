import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-background to-muted/40 px-4">
      <RegisterForm />
    </div>
  );
}