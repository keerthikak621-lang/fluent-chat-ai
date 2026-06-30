import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { languageName } from "./languages";

// ---------------------------------------------------------------------------
// Lovable AI gateway helper (OpenAI-compatible chat completions endpoint).
// LOVABLE_API_KEY is injected into the server runtime; it never reaches the
// browser. This helper is only ever invoked from inside server-fn handlers.
// ---------------------------------------------------------------------------
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

type GatewayMessage = { role: "system" | "user" | "assistant"; content: string };

async function callGateway(messages: GatewayMessage[], jsonMode = false): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("AI is not configured (missing LOVABLE_API_KEY).");

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

  // Surface gateway-specific failures so the UI can show useful messages.
  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS_EXHAUSTED");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI gateway error ${res.status}: ${detail.slice(0, 200)}`);
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

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, preferred_language")
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("profiles")
      .update(data)
      .eq("id", userId)
      .select("id, display_name, preferred_language")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------------------------------------------------------------------------
// Sessions (chat threads)
// ---------------------------------------------------------------------------
export const listSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("chat_sessions")
      .select("id, title, created_at, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: userId, title: "New chat" })
      .select("id, title, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

export const deleteSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("chat_sessions").delete().eq("id", data.sessionId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const renameSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ sessionId: z.string().uuid(), title: z.string().trim().min(1).max(120) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("chat_sessions")
      .update({ title: data.title })
      .eq("id", data.sessionId)
      .select("id, title, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
export const getMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("messages")
      .select(
        "id, session_id, role, original_text, original_language, translated_text, display_language, created_at",
      )
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------------------------------------------------------------------------
// The core AI + translation workflow.
//
// 1. Detect the language of the user's message and translate it to English.
// 2. Feed the English message + English conversation history to the LLM.
// 3. Get the assistant's reply AND its translation into the user's preferred
//    language in a single structured response.
// 4. Persist both messages (original text, English pivot, languages used).
// ---------------------------------------------------------------------------
export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        text: z.string().trim().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { sessionId, text } = data;

    // --- Confirm ownership + read preferred response language ----------------
    const { data: session, error: sessionError } = await supabase
      .from("chat_sessions")
      .select("id, title")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError) throw new Error(sessionError.message);
    if (!session) throw new Error("Conversation not found.");

    const { data: profile } = await supabase
      .from("profiles")
      .select("preferred_language")
      .eq("id", userId)
      .maybeSingle();
    const targetCode = profile?.preferred_language || "en";
    const targetName = languageName(targetCode);

    // --- Recent English context (last 10 messages) ---------------------------
    const { data: history } = await supabase
      .from("messages")
      .select("role, original_text, translated_text")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(10);
    const orderedHistory = (history ?? []).reverse();

    // --- Step 1: detect language + translate the user input to English -------
    let sourceCode = "en";
    let englishInput = text;
    try {
      const raw = await callGateway(
        [
          {
            role: "system",
            content:
              'You are a precise translation engine. Detect the language of the user message and translate it into English. Respond ONLY with strict JSON: {"sourceLang":"<ISO 639-1 code>","english":"<english translation>"}. If the message is already English, return it unchanged as "english".',
          },
          { role: "user", content: text },
        ],
        true,
      );
      const parsed = parseJson<{ sourceLang?: string; english?: string }>(raw);
      if (parsed?.english) englishInput = parsed.english;
      if (parsed?.sourceLang) sourceCode = parsed.sourceLang.toLowerCase().slice(0, 8);
    } catch (err) {
      if (err instanceof Error && (err.message === "RATE_LIMIT" || err.message === "CREDITS_EXHAUSTED")) {
        throw err;
      }
      // Non-fatal: fall back to treating input as English.
    }

    // --- Persist the user message --------------------------------------------
    const { data: userMessage, error: userInsertError } = await supabase
      .from("messages")
      .insert({
        session_id: sessionId,
        user_id: userId,
        role: "user",
        original_text: text,
        original_language: sourceCode,
        translated_text: englishInput,
        display_language: sourceCode,
      })
      .select(
        "id, session_id, role, original_text, original_language, translated_text, display_language, created_at",
      )
      .single();
    if (userInsertError) throw new Error(userInsertError.message);

    // --- Step 2: generate assistant reply + translation ----------------------
    const conversation: GatewayMessage[] = [
      {
        role: "system",
        content:
          `You are a helpful, friendly multilingual assistant. Continue the conversation naturally and answer the user's latest message. ` +
          `Respond ONLY with strict JSON: {"englishReply":"<your answer in English>","translatedReply":"<the same answer translated naturally into ${targetName}>"}. ` +
          `If ${targetName} is English, "translatedReply" must equal "englishReply". ` +
          `Keep answers clear and concise. You may use Markdown formatting inside the reply strings.`,
      },
      ...orderedHistory.map<GatewayMessage>((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.translated_text || m.original_text,
      })),
      { role: "user", content: englishInput },
    ];

    let englishReply = "";
    let translatedReply = "";
    const rawReply = await callGateway(conversation, true);
    const parsedReply = parseJson<{ englishReply?: string; translatedReply?: string }>(rawReply);
    if (parsedReply?.englishReply || parsedReply?.translatedReply) {
      englishReply = parsedReply.englishReply || parsedReply.translatedReply || "";
      translatedReply = parsedReply.translatedReply || parsedReply.englishReply || "";
    } else {
      // Model didn't return JSON — use raw text as the reply for both fields.
      englishReply = rawReply.trim();
      translatedReply = rawReply.trim();
    }
    if (!translatedReply) translatedReply = "Sorry, I couldn't generate a response. Please try again.";

    // --- Persist the assistant message ---------------------------------------
    const { data: assistantMessage, error: assistantInsertError } = await supabase
      .from("messages")
      .insert({
        session_id: sessionId,
        user_id: userId,
        role: "assistant",
        original_text: translatedReply,
        original_language: targetCode,
        translated_text: englishReply,
        display_language: targetCode,
      })
      .select(
        "id, session_id, role, original_text, original_language, translated_text, display_language, created_at",
      )
      .single();
    if (assistantInsertError) throw new Error(assistantInsertError.message);

    // --- Bump the session + auto-title on first message ----------------------
    const patch: { updated_at: string; title?: string } = {
      updated_at: new Date().toISOString(),
    };
    if (session.title === "New chat") {
      patch.title = englishInput.slice(0, 60) + (englishInput.length > 60 ? "…" : "");
    }
    await supabase.from("chat_sessions").update(patch).eq("id", sessionId);

    return { userMessage, assistantMessage };
  });