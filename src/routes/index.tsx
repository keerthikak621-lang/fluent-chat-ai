import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Globe, Languages, MessageSquareText, ShieldCheck, Sparkles, History } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LANGUAGES } from "@/lib/languages";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lingua — AI Multilingual Chat" },
      {
        name: "description",
        content:
          "Chat in your own language. Lingua translates in real time and replies intelligently in the language you prefer.",
      },
      { property: "og:title", content: "Lingua — AI Multilingual Chat" },
      {
        property: "og:description",
        content: "Chat in your own language. Lingua translates and replies in your preferred language.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();

  // Skip the landing page for users who are already signed in.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/chat" });
    });
  }, [navigate]);

  const features = [
    { icon: Languages, title: "Real-time translation", body: "Type in any of 10 languages — Lingua detects and translates instantly." },
    { icon: Sparkles, title: "Context-aware AI", body: "Answers that understand your full conversation, not just the last line." },
    { icon: History, title: "Saved history", body: "Every thread is stored, with original and translated text preserved." },
    { icon: ShieldCheck, title: "Secure by default", body: "Private accounts with row-level security on every message." },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-bold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Globe className="h-5 w-5" />
          </span>
          Lingua
        </div>
        <Button asChild variant="outline">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -left-24 top-40 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-6 py-20 text-center sm:py-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <MessageSquareText className="h-3.5 w-3.5 text-primary" /> AI-powered multilingual chat
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-tight sm:text-6xl">
            Speak your language.
            <br />
            <span className="text-primary">Let AI handle the rest.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Lingua detects what you type, translates it in real time, and replies intelligently in
            the language you prefer — all in one seamless conversation.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="px-8">
              <Link to="/auth">Start chatting free</Link>
            </Button>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {LANGUAGES.map((l) => (
              <span
                key={l.code}
                className="rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground"
              >
                {l.flag} {l.native}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        Built with Lingua — multilingual AI chat.
      </footer>
    </div>
  );
}
