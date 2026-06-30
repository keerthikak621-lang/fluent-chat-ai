import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessagesSquare } from "lucide-react";

import { listSessions } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatIndex,
});

function ChatIndex() {
  const navigate = useNavigate();
  const listFn = useServerFn(listSessions);
  const redirected = useRef(false);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => listFn(),
  });

  // Open the most recent conversation automatically if one exists.
  useEffect(() => {
    if (!sessions || redirected.current) return;
    if (sessions.length > 0) {
      redirected.current = true;
      navigate({ to: "/chat/$threadId", params: { threadId: sessions[0].id } });
    }
  }, [sessions, navigate]);

  if (isLoading || (sessions && sessions.length > 0)) {
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
      <h2 className="text-xl font-bold">Welcome to Lingua</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Press “New chat” in the sidebar to start your first multilingual conversation.
      </p>
    </div>
  );
}