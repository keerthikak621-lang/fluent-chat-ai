import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Globe, Loader2, LogOut, Plus, Trash2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

import { listSessions, createSession, deleteSession } from "@/lib/chat.functions";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function ChatSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as { threadId?: string };
  const activeId = params.threadId;

  const listFn = useServerFn(listSessions);
  const createFn = useServerFn(createSession);
  const deleteFn = useServerFn(deleteSession);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => listFn(),
  });

  const createMutation = useMutation({
    mutationFn: () => createFn(),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate({ to: "/chat/$threadId", params: { threadId: session.id } });
      onNavigate?.();
    },
    onError: () => toast.error("Could not start a new chat."),
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => deleteFn({ data: { sessionId } }),
    onSuccess: (_res, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (sessionId === activeId) navigate({ to: "/chat" });
    },
    onError: () => toast.error("Could not delete the chat."),
  });

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Globe className="h-4.5 w-4.5" />
        </span>
        <span className="text-base font-bold">Lingua</span>
      </div>

      <div className="px-3">
        <Button
          className="w-full justify-start gap-2"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          New chat
        </Button>
      </div>

      {/* Session list */}
      <div className="mt-4 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">
          History
        </p>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-sidebar-foreground/50" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-sidebar-foreground/50">
            No conversations yet.
          </p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors",
                s.id === activeId
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
              )}
            >
              <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
              <Link
                to="/chat/$threadId"
                params={{ threadId: s.id }}
                onClick={onNavigate}
                className="flex-1 truncate"
              >
                {s.title}
              </Link>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    aria-label="Delete chat"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
                    <AlertDialogDescription>
                      “{s.title}” and all of its messages will be permanently removed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => deleteMutation.mutate(s.id)}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}