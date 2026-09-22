import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatView } from "@/components/chat/chat-view";

export const metadata: Metadata = { title: "Conversation" };

export default async function ChatConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <ChatView key={id} conversationId={id} />
    </Suspense>
  );
}