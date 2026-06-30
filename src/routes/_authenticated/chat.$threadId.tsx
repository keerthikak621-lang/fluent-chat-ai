import { createFileRoute } from "@tanstack/react-router";

import { ChatWindow } from "@/components/chat/ChatWindow";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  component: ThreadRoute,
});

function ThreadRoute() {
  const { threadId } = Route.useParams();
  // `key` forces a clean remount (and fresh local state) per conversation.
  return <ChatWindow key={threadId} conversationId={threadId} />;
}
