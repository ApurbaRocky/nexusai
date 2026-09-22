import type { Metadata } from "next";
import { ResearchClient } from "./research-client";

export const metadata: Metadata = { title: "Research" };

export default function ResearchPage() {
  return <ResearchClient />;
}