import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Languages, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { languageMeta, isRtl } from "@/lib/languages";

export interface ChatMessage {
  id: string;
  role: string;
  original_text: string;
  original_language: string | null;
  translated_text: string | null;
  display_language: string | null;
  created_at: string;
  pending?: boolean;
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const [showEnglish, setShowEnglish] = useState(false);

  const langCode = message.display_language ?? message.original_language;
  const meta = languageMeta(langCode);
  const rtl = isRtl(langCode);

  // The "translation toggle" reveals the English pivot the AI worked with,
  // but only when it actually differs from what is displayed.
  const english = message.translated_text?.trim();
  const canToggle = !!english && english !== message.original_text.trim() && langCode !== "en";

  return (
    <div className={cn("flex w-full gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
      )}

      <div className={cn("flex max-w-[78%] flex-col gap-1", isUser ? "items-end" : "items-start")}>
        <div
          dir={rtl ? "rtl" : "ltr"}
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
            isUser
              ? "rounded-br-md bg-user-bubble text-user-bubble-foreground"
              : "rounded-bl-md border border-border bg-assistant-bubble text-assistant-bubble-foreground",
            message.pending && "opacity-70",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.original_text}</p>
          ) : (
            <div className="prose-chat break-words">
              <ReactMarkdown>{showEnglish ? english || message.original_text : message.original_text}</ReactMarkdown>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          <span>
            {meta.flag} {meta.native}
          </span>
          {canToggle && (
            <button
              type="button"
              onClick={() => setShowEnglish((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Languages className="h-3 w-3" />
              {showEnglish ? "Show original" : "Show English"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}