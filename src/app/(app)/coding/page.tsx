import type { Metadata } from "next";
import { CodingClient } from "./coding-client";

export const metadata: Metadata = { title: "Coding workspace" };

export default function CodingPage() {
  return <CodingClient />;
}