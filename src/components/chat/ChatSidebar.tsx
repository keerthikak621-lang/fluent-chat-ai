import { useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Globe,
  Loader2,
  LogOut,
  MessageSquare,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import {
  listContacts,
  listConversations,
  searchUsers,
  addContact,
  removeContact,
  getOrCreateDirectConversation,
  createGroupConversation,
  type PublicUser,
} from "@/lib/chat.functions";
import { supabase } from "@/integrations/supabase/client";
import { languageMeta } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ChatSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams({ strict: false }) as { threadId?: string };
  const activeId = params.threadId;

  const listConvosFn = useServerFn(listConversations);
  const listContactsFn = useServerFn(listContacts);
  const openDmFn = useServerFn(getOrCreateDirectConversation);

  const { data: conversations = [], isLoading: convosLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => listConvosFn(),
  });
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => listContactsFn(),
  });

  const openDm = useMutation({
    mutationFn: (otherUserId: string) => openDmFn({ data: { otherUserId } }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      navigate({ to: "/chat/$threadId", params: { threadId: id } });
      onNavigate?.();
    },
    onError: () => toast.error("Could not open the chat."),
  });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  function convoLabel(c: (typeof conversations)[number]) {
    if (c.is_group) return c.title || "Group chat";
    const other = c.participants.find((p) => !contacts.every(() => true) || true) ;
    const named = c.participants.length === 2 ? c.participants : c.participants;
    const o = named.find((p) => p.username) ?? other;
    return o?.display_name || o?.username || "Conversation";
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Globe className="h-4.5 w-4.5" />
        </span>
        <span className="text-base font-bold">Lingua</span>
      </div>

      <div className="flex gap-2 px-3">
        <AddFriendDialog />
        <NewGroupDialog contacts={contacts} />
      </div>

      <div className="mt-4 flex-1 space-y-4 overflow-y-auto px-2 pb-2">
        {/* Conversations */}
        <div className="space-y-1">
          <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">
            Chats
          </p>
          {convosLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-sidebar-foreground/50" />
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-sidebar-foreground/50">
              No conversations yet.
            </p>
          ) : (
            conversations.map((c) => (
              <Link
                key={c.id}
                to="/chat/$threadId"
                params={{ threadId: c.id }}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors",
                  c.id === activeId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
                )}
              >
                {c.is_group ? (
                  <Users className="h-4 w-4 shrink-0 opacity-60" />
                ) : (
                  <MessageSquare className="h-4 w-4 shrink-0 opacity-60" />
                )}
                <span className="flex-1 truncate">{convoLabel(c)}</span>
              </Link>
            ))
          )}
        </div>

        {/* Contacts */}
        <div className="space-y-1">
          <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-sidebar-foreground/50">
            Contacts
          </p>
          {contacts.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-sidebar-foreground/50">
              Add a friend to start chatting.
            </p>
          ) : (
            contacts.map((p) => (
              <button
                key={p.id}
                onClick={() => openDm.mutate(p.id)}
                disabled={openDm.isPending}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold">
                  {(p.display_name || p.username).charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 truncate">{p.display_name || p.username}</span>
                <span className="text-xs opacity-60">{languageMeta(p.preferred_language).flag}</span>
              </button>
            ))
          )}
        </div>
      </div>

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

function AddFriendDialog() {
  const queryClient = useQueryClient();
  const searchFn = useServerFn(searchUsers);
  const addFn = useServerFn(addContact);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const found = await searchFn({ data: { query: query.trim() } });
      setResults(found);
      if (found.length === 0) toast.info("No one found with that username or email.");
    } catch {
      toast.error("Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  }

  const addMutation = useMutation({
    mutationFn: (contactId: string) => addFn({ data: { contactId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success("Contact added.");
    },
    onError: () => toast.error("Could not add contact."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex-1 justify-center gap-2" size="sm">
          <UserPlus className="h-4 w-4" />
          Add friend
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a friend</DialogTitle>
          <DialogDescription>Search by username or email address.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="username or you@example.com"
            autoFocus
          />
          <Button type="submit" size="icon" disabled={searching}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {results.map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {(p.display_name || p.username).charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.display_name || p.username}</p>
                <p className="truncate text-xs text-muted-foreground">@{p.username}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => addMutation.mutate(p.id)}
                disabled={addMutation.isPending}
              >
                Add
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewGroupDialog({ contacts }: { contacts: PublicUser[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createFn = useServerFn(createGroupConversation);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      createFn({ data: { title: title.trim(), memberIds: Array.from(selected) } }),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setOpen(false);
      setTitle("");
      setSelected(new Set());
      navigate({ to: "/chat/$threadId", params: { threadId: id } });
    },
    onError: () => toast.error("Could not create the group."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" className="justify-center gap-2">
          <Users className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>Name the group and pick members from your contacts.</DialogDescription>
        </DialogHeader>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Group name" />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {contacts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Add some contacts first.
            </p>
          ) : (
            contacts.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                <span className="flex-1 truncate text-sm">{p.display_name || p.username}</span>
                <span className="text-xs text-muted-foreground">@{p.username}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || selected.size === 0 || createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
