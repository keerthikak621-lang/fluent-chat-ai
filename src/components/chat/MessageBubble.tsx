import { useState } from "react";
import { Languages } from "lucide-react";

import { cn } from "@/lib/utils";
import { languageMeta, isRtl } from "@/lib/languages";
import type { ConversationMessage } from "@/lib/chat.functions";

export type ChatMessage = ConversationMessage & { pending?: boolean };

export function MessageBubble({
  message,
  showSender,
}: {
  message: ChatMessage;
  showSender?: boolean;
}) {
  const isUser = message.is_me;
  const [showOriginal, setShowOriginal] = useState(false);

  // The sender sees their own text untranslated; recipients see the translation
  // into their preferred language, with a toggle to reveal the original.
  const wasTranslated =
    !isUser && message.original_language !== message.translated_language &&
    message.translated_text.trim() !== message.original_text.trim();

  const shown = showOriginal ? message.original_text : message.translated_text;
  const shownLang = showOriginal ? message.original_language : message.translated_language;
  const rtl = isRtl(shownLang);
  const meta = languageMeta(shownLang);

  return (
    <div className={cn("flex w-full flex-col gap-1", isUser ? "items-end" : "items-start")}>
      {showSender && !isUser && (
        <span className="px-1 text-xs font-medium text-muted-foreground">{message.sender_name}</span>
      )}

      <div className={cn("flex max-w-[80%] flex-col gap-1", isUser ? "items-end" : "items-start")}>
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
          <p className="whitespace-pre-wrap break-words">{shown}</p>
        </div>

        <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          <span>
            {meta.flag} {meta.native}
          </span>
          {wasTranslated && (
            <button
              type="button"
              onClick={() => setShowOriginal((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors hover:bg-muted hover:text-foreground"
            >
              <Languages className="h-3 w-3" />
              {showOriginal ? "Show translation" : "Show original"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
