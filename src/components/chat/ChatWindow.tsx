import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, SendHorizonal, Users } from "lucide-react";
import { toast } from "sonner";

import { loadConversation, sendMessage } from "@/lib/chat.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble, type ChatMessage } from "./MessageBubble";

export function ChatWindow({ conversationId }: { conversationId: string }) {
  const queryClient = useQueryClient();
  const loadFn = useServerFn(loadConversation);
  const sendFn = useServerFn(sendMessage);

  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => loadFn({ data: { conversationId } }),
  });

  // Live updates: refetch whenever a message lands in this conversation.
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
          queryClient.invalidateQueries({ queryKey: ["conversations"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);

  const sendMutation = useMutation({
    mutationFn: (text: string) => sendFn({ data: { conversationId, text } }),
    onSuccess: () => {
      setOptimistic([]);
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (err) => {
      setOptimistic((prev) => {
        const failed = prev[0];
        if (failed) setDraft(failed.original_text);
        return [];
      });
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("RATE_LIMIT")) toast.error("Too many requests — please wait a moment.");
      else if (msg.includes("CREDITS_EXHAUSTED")) toast.error("Translation credits exhausted.");
      else toast.error("Message failed to send. Please try again.");
    },
  });

  const allMessages = useMemo(
    () => [...(data?.messages ?? []), ...optimistic],
    [data?.messages, optimistic],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [allMessages.length, sendMutation.isPending]);

  function handleSend() {
    const text = draft.trim();
    if (!text || sendMutation.isPending || !data) return;
    setDraft("");
    setOptimistic([
      {
        id: `optimistic-${Date.now()}`,
        sender_id: data.meId,
        sender_name: "You",
        is_me: true,
        original_text: text,
        original_language: data.viewerLanguage,
        translated_text: text,
        translated_language: data.viewerLanguage,
        created_at: new Date().toISOString(),
        pending: true,
      },
    ]);
    sendMutation.mutate(text);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const convo = data?.conversation;
  const others = convo?.participants.filter((p) => p.id !== data?.meId) ?? [];
  const headerTitle = convo?.is_group
    ? convo.title || "Group chat"
    : others[0]?.display_name || others[0]?.username || "Conversation";
  const headerSub = convo?.is_group
    ? `${convo.participants.length} members`
    : others[0]
      ? `@${others[0].username}`
      : "";

  return (
    <div className="flex h-full flex-col">
      {/* Conversation header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-8">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {convo?.is_group ? <Users className="h-4 w-4" /> : headerTitle.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{headerTitle}</p>
          {headerSub && <p className="truncate text-xs text-muted-foreground">{headerSub}</p>}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : allMessages.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No messages yet. Say hello — it'll arrive in their language.
            </div>
          ) : (
            allMessages.map((m) => (
              <MessageBubble key={m.id} message={m} showSender={!!convo?.is_group} />
            ))
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-background/80 px-4 py-4 backdrop-blur sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message…"
            rows={1}
            className="max-h-40 min-h-[44px] flex-1 resize-none"
          />
          <Button
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={handleSend}
            disabled={!draft.trim() || sendMutation.isPending}
            aria-label="Send message"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizonal className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted-foreground">
          Messages are auto-translated into each person's preferred language.
        </p>
      </div>
    </div>
  );
}
