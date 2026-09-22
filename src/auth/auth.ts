import NextAuth from "next-auth";
import { authConfig } from "@/auth/config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** Authenticated route-handler session with the user id resolved. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};