"use server";

import { signOut } from "@/auth/auth";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}