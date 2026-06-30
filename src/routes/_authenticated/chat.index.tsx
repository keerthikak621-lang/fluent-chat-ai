import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessagesSquare } from "lucide-react";

import { listConversations } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatIndex,
});

function ChatIndex() {
  const navigate = useNavigate();
  const listFn = useServerFn(listConversations);
  const redirected = useRef(false);

  const { data: conversations, isLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listFn(),
  });

  useEffect(() => {
    if (!conversations || redirected.current) return;
    if (conversations.length > 0) {
      redirected.current = true;
      navigate({ to: "/chat/$threadId", params: { threadId: conversations[0].id } });
    }
  }, [conversations, navigate]);

  if (isLoading || (conversations && conversations.length > 0)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <MessagesSquare className="h-7 w-7" />
      </span>
      <h2 className="text-xl font-bold">No conversations yet</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Add a friend by username or email in the sidebar, then tap their name to start a
        chat. Everything they send is instantly translated into your language.
      </p>
    </div>
  );
}
