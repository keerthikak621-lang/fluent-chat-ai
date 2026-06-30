import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { getProfile, updateProfile } from "@/lib/chat.functions";
import { PREFERRED_LANGUAGES } from "@/lib/languages";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Lets the user pick the language the AI should reply in. Persisted to the
// profile so it applies to every conversation and survives reloads.
export function LanguageSelector() {
  const queryClient = useQueryClient();
  const getProfileFn = useServerFn(getProfile);
  const updateProfileFn = useServerFn(updateProfile);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => getProfileFn(),
  });

  const mutation = useMutation({
    mutationFn: (preferred_language: string) =>
      updateProfileFn({ data: { preferred_language } }),
    onMutate: async (preferred_language) => {
      await queryClient.cancelQueries({ queryKey: ["profile"] });
      const previous = queryClient.getQueryData(["profile"]);
      queryClient.setQueryData(["profile"], (old: typeof profile) =>
        old ? { ...old, preferred_language } : old,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["profile"], ctx.previous);
      toast.error("Could not update language.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  const value = profile?.preferred_language ?? "en";

  return (
    <div className="flex items-center gap-2">
      {/* Input language is detected automatically by the AI on every message. */}
      <span
        className="hidden items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex"
        title="The language you type in is detected automatically."
      >
        <Globe className="h-3 w-3" />
        Auto-detect input
      </span>
      <span className="hidden text-xs text-muted-foreground sm:inline">Reply in</span>
      <Select value={value} onValueChange={(v) => mutation.mutate(v)} disabled={isLoading}>
        <SelectTrigger className="h-9 w-[150px]">
          {mutation.isPending ? (
            <span className="flex items-center gap-2 text-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          {PREFERRED_LANGUAGES.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              {l.flag} {l.native}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}