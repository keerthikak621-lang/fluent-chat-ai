import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, SendHorizonal, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { getMessages, sendMessage } from "@/lib/chat.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageBubble, type ChatMessage } from "./MessageBubble";

export function ChatWindow({ threadId }: { threadId: string }) {
  const queryClient = useQueryClient();
  const getMessagesFn = useServerFn(getMessages);
  const sendMessageFn = useServerFn(sendMessage);

  const [draft, setDraft] = useState("");
  // Optimistic items rendered while the server pipeline runs.
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages", threadId],
    queryFn: () => getMessagesFn({ data: { sessionId: threadId } }),
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => sendMessageFn({ data: { sessionId: threadId, text } }),
    onSuccess: () => {
      setOptimistic([]);
      queryClient.invalidateQueries({ queryKey: ["messages", threadId] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) => {
      // Roll back the optimistic user bubble and restore the draft.
      setOptimistic((prev) => {
        const failed = prev.find((m) => m.role === "user");
        if (failed) setDraft(failed.original_text);
        return [];
      });
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("RATE_LIMIT")) toast.error("Too many requests — please wait a moment.");
      else if (msg.includes("CREDITS_EXHAUSTED")) toast.error("AI credits exhausted. Add credits to continue.");
      else toast.error("Message failed to send. Please try again.");
    },
  });

  const allMessages = useMemo(() => [...messages, ...optimistic], [messages, optimistic]);

  // Keep the view pinned to the newest message.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [allMessages.length, sendMutation.isPending]);

  function handleSend() {
    const text = draft.trim();
    if (!text || sendMutation.isPending) return;
    setDraft("");
    setOptimistic([
      {
        id: `optimistic-${Date.now()}`,
        role: "user",
        original_text: text,
        original_language: null,
        translated_text: null,
        display_language: null,
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

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : allMessages.length === 0 ? (
            <EmptyState />
          ) : (
            allMessages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}

          {sendMutation.isPending && <TypingIndicator />}
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
            placeholder="Type in any language…"
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
          Lingua auto-detects your language and replies in your preferred language.
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Sparkles className="h-7 w-7" />
      </span>
      <h2 className="text-xl font-bold">Start the conversation</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Write in your own language. Lingua translates it, thinks in context, and answers in the
        language you prefer.
      </p>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-border bg-assistant-bubble px-4 py-3">
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/60" />
      </div>
    </div>
  );
}