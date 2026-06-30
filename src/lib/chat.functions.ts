import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { languageName } from "./languages";

// ---------------------------------------------------------------------------
// Lovable AI gateway helper — used only for real-time message translation.
// LOVABLE_API_KEY is injected into the server runtime; it never reaches the
// browser. Only ever invoked from inside server-fn handlers.
// ---------------------------------------------------------------------------
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

type GatewayMessage = { role: "system" | "user" | "assistant"; content: string };

async function callGateway(messages: GatewayMessage[], jsonMode = false): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Translation is not configured (missing LOVABLE_API_KEY).");

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Translation error ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Defensive JSON parse that tolerates ```json fences around the payload. */
function parseJson<T>(raw: string): T | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

/**
 * Translate a batch of texts from one language to another in a single AI call.
 * Order and length of the returned array always matches the input; on any
 * failure the original strings are returned unchanged (graceful degradation).
 */
async function translateBatch(
  texts: string[],
  fromCode: string,
  toCode: string,
): Promise<string[]> {
  if (texts.length === 0) return [];
  if (fromCode === toCode) return texts;

  const fromName = languageName(fromCode);
  const toName = languageName(toCode);

  const raw = await callGateway(
    [
      {
        role: "system",
        content:
          `You are a precise translation engine for a chat app. Translate each string in the ` +
          `provided JSON array from ${fromName} to ${toName}. Preserve meaning, tone and any ` +
          `emoji. Respond ONLY with strict JSON of the exact shape ` +
          `{"translations": ["<translation 1>", "<translation 2>", ...]} with the SAME number ` +
          `of items and in the SAME order as the input.`,
      },
      { role: "user", content: JSON.stringify(texts) },
    ],
    true,
  );

  const parsed = parseJson<{ translations?: string[] }>(raw);
  if (parsed?.translations && parsed.translations.length === texts.length) {
    return parsed.translations.map((t, i) => (typeof t === "string" && t.trim() ? t : texts[i]));
  }
  return texts;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, preferred_language, username, email")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        display_name: z.string().trim().min(1).max(80).optional(),
        preferred_language: z.string().trim().min(2).max(8).optional(),
        username: z
          .string()
          .trim()
          .min(3)
          .max(30)
          .regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers and underscores only.")
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("profiles")
      .update(data)
      .eq("id", userId)
      .select("id, display_name, preferred_language, username, email")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("That username is already taken.");
      throw new Error(error.message);
    }
    return row;
  });

// ---------------------------------------------------------------------------
// Contacts (address book)
// ---------------------------------------------------------------------------
export interface PublicUser {
  id: string;
  username: string;
  display_name: string | null;
  preferred_language: string;
}

/** Find people to add as contacts by exact email or (partial) username. */
export const searchUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PublicUser[]> => {
    const { userId } = context;
    const q = data.query.trim();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let builder = supabaseAdmin
      .from("profiles")
      .select("id, username, display_name, preferred_language")
      .neq("id", userId)
      .limit(10);

    if (q.includes("@")) {
      builder = builder.ilike("email", q);
    } else {
      builder = builder.ilike("username", `%${q}%`);
    }

    const { data: rows, error } = await builder;
    if (error) throw new Error(error.message);
    return (rows ?? []) as PublicUser[];
  });

export const addContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ contactId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.contactId === userId) throw new Error("You can't add yourself.");
    const { error } = await supabase
      .from("contacts")
      .upsert(
        { user_id: userId, contact_id: data.contactId },
        { onConflict: "user_id,contact_id", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ contactId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("contacts")
      .delete()
      .eq("user_id", userId)
      .eq("contact_id", data.contactId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PublicUser[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("contacts")
      .select("contact_id, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.contact_id);
    if (ids.length === 0) return [];

    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, username, display_name, preferred_language")
      .in("id", ids);
    if (pErr) throw new Error(pErr.message);

    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is PublicUser => !!p);
  });

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
export interface ConversationSummary {
  id: string;
  is_group: boolean;
  title: string | null;
  updated_at: string;
  participants: PublicUser[];
  lastMessage: string | null;
}

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConversationSummary[]> => {
    const { supabase, userId } = context;

    const { data: myParts, error: mpErr } = await supabase
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", userId);
    if (mpErr) throw new Error(mpErr.message);

    const convoIds = (myParts ?? []).map((p) => p.conversation_id);
    if (convoIds.length === 0) return [];

    const { data: convos, error: cErr } = await supabase
      .from("conversations")
      .select("id, is_group, title, updated_at")
      .in("id", convoIds)
      .order("updated_at", { ascending: false });
    if (cErr) throw new Error(cErr.message);

    const { data: allParts, error: apErr } = await supabase
      .from("conversation_participants")
      .select("conversation_id, user_id")
      .in("conversation_id", convoIds);
    if (apErr) throw new Error(apErr.message);

    const userIds = Array.from(new Set((allParts ?? []).map((p) => p.user_id)));
    const { data: profiles, error: prErr } = await supabase
      .from("profiles")
      .select("id, username, display_name, preferred_language")
      .in("id", userIds);
    if (prErr) throw new Error(prErr.message);
    const profById = new Map((profiles ?? []).map((p) => [p.id, p as PublicUser]));

    // Latest message per conversation (for the sidebar preview).
    const { data: recent } = await supabase
      .from("messages")
      .select("conversation_id, original_text, created_at")
      .in("conversation_id", convoIds)
      .order("created_at", { ascending: false });
    const lastByConvo = new Map<string, string>();
    for (const m of recent ?? []) {
      if (!lastByConvo.has(m.conversation_id)) lastByConvo.set(m.conversation_id, m.original_text);
    }

    return (convos ?? []).map((c) => {
      const members = (allParts ?? [])
        .filter((p) => p.conversation_id === c.id)
        .map((p) => profById.get(p.user_id))
        .filter((p): p is PublicUser => !!p);
      return {
        id: c.id,
        is_group: c.is_group,
        title: c.title,
        updated_at: c.updated_at,
        participants: members,
        lastMessage: lastByConvo.get(c.id) ?? null,
      };
    });
  });

/** Find an existing 1:1 conversation with another user, or create one. */
export const getOrCreateDirectConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ otherUserId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { userId } = context;
    const otherUserId = data.otherUserId;
    if (otherUserId === userId) throw new Error("You can't message yourself.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verify the other user exists.
    const { data: other, error: oErr } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", otherUserId)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!other) throw new Error("That person no longer exists.");

    // Find a shared non-group conversation between exactly these two people.
    const { data: mine } = await supabaseAdmin
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", userId);
    const { data: theirs } = await supabaseAdmin
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", otherUserId);

    const mineIds = new Set((mine ?? []).map((r) => r.conversation_id));
    const shared = (theirs ?? [])
      .map((r) => r.conversation_id)
      .filter((id) => mineIds.has(id));

    if (shared.length > 0) {
      const { data: directs } = await supabaseAdmin
        .from("conversations")
        .select("id")
        .eq("is_group", false)
        .in("id", shared);
      if (directs && directs.length > 0) return { id: directs[0].id };
    }

    // Create a fresh direct conversation.
    const { data: convo, error: convErr } = await supabaseAdmin
      .from("conversations")
      .insert({ is_group: false, created_by: userId })
      .select("id")
      .single();
    if (convErr) throw new Error(convErr.message);

    const { error: partErr } = await supabaseAdmin
      .from("conversation_participants")
      .insert([
        { conversation_id: convo.id, user_id: userId },
        { conversation_id: convo.id, user_id: otherUserId },
      ]);
    if (partErr) throw new Error(partErr.message);

    return { id: convo.id };
  });

export const createGroupConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().trim().min(1).max(80),
        memberIds: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: convo, error: convErr } = await supabaseAdmin
      .from("conversations")
      .insert({ is_group: true, title: data.title, created_by: userId })
      .select("id")
      .single();
    if (convErr) throw new Error(convErr.message);

    const memberSet = new Set<string>([userId, ...data.memberIds]);
    const rows = Array.from(memberSet).map((uid) => ({
      conversation_id: convo.id,
      user_id: uid,
    }));
    const { error: partErr } = await supabaseAdmin
      .from("conversation_participants")
      .insert(rows);
    if (partErr) throw new Error(partErr.message);

    return { id: convo.id };
  });

// ---------------------------------------------------------------------------
// Messages + live translation
// ---------------------------------------------------------------------------
export interface ConversationMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  is_me: boolean;
  original_text: string;
  original_language: string;
  translated_text: string; // in the viewer's preferred language
  translated_language: string;
  created_at: string;
}

export interface ConversationView {
  conversation: {
    id: string;
    is_group: boolean;
    title: string | null;
    participants: PublicUser[];
  };
  viewerLanguage: string;
  meId: string;
  messages: ConversationMessage[];
}

/**
 * Load a conversation and translate every message into the viewer's preferred
 * language. Translations are cached in message_translations so each message is
 * only translated once per target language.
 */
export const loadConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ conversationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ConversationView> => {
    const { supabase, userId } = context;
    const { conversationId } = data;

    // RLS ensures only participants can read this row.
    const { data: convo, error: cErr } = await supabase
      .from("conversations")
      .select("id, is_group, title")
      .eq("id", conversationId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!convo) throw new Error("Conversation not found.");

    const { data: parts } = await supabase
      .from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conversationId);
    const partIds = (parts ?? []).map((p) => p.user_id);

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, preferred_language")
      .in("id", partIds.length ? partIds : [userId]);
    const profById = new Map((profiles ?? []).map((p) => [p.id, p as PublicUser]));

    const viewerLanguage = profById.get(userId)?.preferred_language || "en";

    const { data: rawMessages, error: mErr } = await supabase
      .from("messages")
      .select("id, sender_id, original_text, original_language, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (mErr) throw new Error(mErr.message);
    const messages = rawMessages ?? [];

    // Which messages need a translation into the viewer's language?
    const needTranslation = messages.filter((m) => m.original_language !== viewerLanguage);
    const translations = new Map<string, string>();

    if (needTranslation.length > 0) {
      const ids = needTranslation.map((m) => m.id);
      const { data: cached } = await supabase
        .from("message_translations")
        .select("message_id, translated_text")
        .eq("language", viewerLanguage)
        .in("message_id", ids);
      for (const t of cached ?? []) translations.set(t.message_id, t.translated_text);

      const missing = needTranslation.filter((m) => !translations.has(m.id));
      if (missing.length > 0) {
        // Group missing messages by source language for efficient batching.
        const bySource = new Map<string, typeof missing>();
        for (const m of missing) {
          const arr = bySource.get(m.original_language) ?? [];
          arr.push(m);
          bySource.set(m.original_language, arr);
        }

        const toInsert: { message_id: string; language: string; translated_text: string }[] = [];
        for (const [sourceLang, group] of bySource) {
          let translated: string[];
          try {
            translated = await translateBatch(
              group.map((m) => m.original_text),
              sourceLang,
              viewerLanguage,
            );
          } catch (err) {
            if (
              err instanceof Error &&
              (err.message === "RATE_LIMIT" || err.message === "CREDITS_EXHAUSTED")
            ) {
              throw err;
            }
            translated = group.map((m) => m.original_text); // graceful fallback
          }
          group.forEach((m, i) => {
            const text = translated[i] ?? m.original_text;
            translations.set(m.id, text);
            toInsert.push({ message_id: m.id, language: viewerLanguage, translated_text: text });
          });
        }

        if (toInsert.length > 0) {
          await supabase
            .from("message_translations")
            .upsert(toInsert, { onConflict: "message_id,language", ignoreDuplicates: true });
        }
      }
    }

    const out: ConversationMessage[] = messages.map((m) => {
      const sender = profById.get(m.sender_id);
      const translated =
        m.original_language === viewerLanguage
          ? m.original_text
          : translations.get(m.id) ?? m.original_text;
      return {
        id: m.id,
        sender_id: m.sender_id,
        sender_name: sender?.display_name || sender?.username || "Someone",
        is_me: m.sender_id === userId,
        original_text: m.original_text,
        original_language: m.original_language,
        translated_text: translated,
        translated_language: viewerLanguage,
        created_at: m.created_at,
      };
    });

    return {
      conversation: {
        id: convo.id,
        is_group: convo.is_group,
        title: convo.title,
        participants: partIds
          .map((id) => profById.get(id))
          .filter((p): p is PublicUser => !!p),
      },
      viewerLanguage,
      meId: userId,
      messages: out,
    };
  });

/** Send a message in the sender's preferred language. */
export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        text: z.string().trim().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("preferred_language")
      .eq("id", userId)
      .maybeSingle();
    const sourceLang = profile?.preferred_language || "en";

    const { data: row, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: data.conversationId,
        sender_id: userId,
        original_text: data.text,
        original_language: sourceLang,
      })
      .select("id, sender_id, original_text, original_language, created_at")
      .single();
    if (error) throw new Error(error.message);

    // Bump the conversation so it floats to the top of everyone's list.
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.conversationId);

    return row;
  });
