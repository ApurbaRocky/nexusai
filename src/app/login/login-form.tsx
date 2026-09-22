"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction, type LoginActionResult } from "@/actions/auth";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    const result: LoginActionResult = await loginAction(formData);
    if (result.error) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.replace("/chat");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="items-center gap-3 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl brand-gradient text-white">
          <Sparkles className="size-5" />
        </div>
        <div>
          <CardTitle className="text-xl font-semibold tracking-tight">Welcome back to AI Nexus</CardTitle>
          <CardDescription className="mt-1">Sign in to your assistant workspace</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <span>
          New here?{" "}
          <Link href="/register" className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground">
            Create an account
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}