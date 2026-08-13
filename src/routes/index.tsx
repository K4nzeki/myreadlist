import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { AlertCircle, ArrowRight, BarChart3, BookOpen, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Eye, EyeOff, GripVertical, Layers, Lock, Loader2, Mail, Menu, Moon, RefreshCw, Search, Sparkles, Sun, User, X } from "lucide-react";
import { toast } from "sonner";
import { searchMAL, searchKitsu, searchAllTrackers } from "@/integrations/trackers";
import { useTheme } from "@/hooks/use-theme";
import { loadCachedEntries, saveCachedEntries } from "@/lib/offline-entries-cache";
import {
  TYPES,
  STATUSES,
  localMonthKey,
  localDayKey,
  parsePipeLine,
  parseSpaceLine,
  type EntryType,
  type EntryStatus,
  type Entry,
  type Parsed,
} from "./shared";

// Update to the correct relative path or alias
const StatsDialog = lazy(() => import("@/components/StatsDialog"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Panels — Synced Reading Tracker" },
      { name: "description", content: "Track and sync manga, manhwa, manhua, and comics across your devices." },
      { property: "og:title", content: "Panels — Synced Reading Tracker" },
      { property: "og:description", content: "A reading tracker that keeps your progress synced across devices and shareable with fellow readers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Tracker,
});

// Every entries query below selects this exact column set — kept as one
// constant so the row shape always matches the Entry type above.
const ENTRY_COLUMNS = "id, title, type, chapter, status, reread, created_at, cover_url, author, total_chapters, position";

// Matches an untouched auto-generated blank entry ("New title", "New title 2", …).
// Shared by the blur-commit check, the sign-out sweep, and the tab/app-close sweep
// below so all three agree on exactly what counts as "still a placeholder".
const DEFAULT_TITLE_RE = /^New title( \d+)?$/i;

// Time-of-day greeting for the header, based on the reader's local clock.
function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good early morning";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

// New titles are inserted above everything else (matches the existing
// "prepend to the list" behavior), without having to touch every other
// row's position. Each new title just gets a value lower than the current
// lowest — cheap, and leaves room to insert below it later via reordering.
function nextTopPosition(list: Entry[]): number {
  if (list.length === 0) return 0;
  return Math.min(...list.map((e) => e.position)) - 1;
}

type SearchResult = {
  id: number | string;
  title: string;
  type: EntryType;
  author: string | null;
  coverUrl: string | null;
  totalChapters: number | null;
  status: string | null;
  source?: string;
  // Whether this result's title is an exact (case-insensitive) match for
  // the title we searched for, vs. just the top fuzzy search hit. `type`
  // is only trustworthy to auto-apply when this is true — a fuzzy hit can
  // be a different series entirely, with a different (wrong) type.
  exactMatch?: boolean;
};

// AniList's public GraphQL API. No key required, CORS-enabled for browser
// use. It covers Manga/Manhwa/Manhua well (it's a manga/anime database) but
// has essentially no Western "Comic" catalog — Comic entries will mostly
// need to stay manual.
const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const ANILIST_QUERY = `
  query ($search: String) {
    Page(page: 1, perPage: 8) {
      media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
        id
        countryOfOrigin
        chapters
        status
        title { romaji english }
        coverImage { medium }
        staff(sort: RELEVANCE, perPage: 1) {
          edges { node { name { full } } }
        }
      }
    }
  }
`;

function guessTypeFromCountry(country: string | null | undefined): EntryType {
  switch (country) {
    case "KR":
      return "Manhwa";
    case "CN":
    case "TW":
      return "Manhua";
    default:
      return "Manga";
  }
}

async function searchAniList(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: query } }),
    signal,
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = (await res.json()) as {
    data?: {
      Page?: {
        media?: Array<{
          id: number;
          countryOfOrigin?: string | null;
          chapters?: number | null;
          status?: string | null;
          title?: { romaji?: string | null; english?: string | null };
          coverImage?: { medium?: string | null };
          staff?: { edges?: Array<{ node?: { name?: { full?: string | null } } }> };
        }>;
      };
    };
  };
  const media = json.data?.Page?.media ?? [];
  return media.map((m) => ({
    id: m.id,
    title: m.title?.english || m.title?.romaji || "Untitled",
    type: guessTypeFromCountry(m.countryOfOrigin),
    author: m.staff?.edges?.[0]?.node?.name?.full ?? null,
    coverUrl: m.coverImage?.medium ?? null,
    totalChapters: typeof m.chapters === "number" ? m.chapters : null,
    status: m.status ?? null,
    source: "AniList",
  }));
}

// Picks the best AniList match for a plain title string: an exact
// case-insensitive match if one exists, otherwise the top search hit.
// Returns null on no results or a network error so callers can just skip
// enrichment silently — AniList also has ~no Western "Comic" catalog, so
// misses there are expected. `exactMatch` is stamped on the result so
// callers can tell a real match from a fuzzy best-guess.
async function findAniListMatch(title: string): Promise<SearchResult | null> {
  try {
    const results = await searchAniList(title);
    if (!results.length) return null;
    const exact = results.find(
      (r) => r.title.trim().toLowerCase() === title.trim().toLowerCase(),
    );
    if (exact) return { ...exact, exactMatch: true };
    return { ...results[0], exactMatch: false };
  } catch {
    return null;
  }
}

function pickBestMatch<T extends { title: string }>(
  title: string,
  results: T[],
): (T & { exactMatch: boolean }) | null {
  if (!results.length) return null;
  const exact = results.find((r) => r.title.trim().toLowerCase() === title.trim().toLowerCase());
  if (exact) return { ...exact, exactMatch: true };
  return { ...results[0], exactMatch: false };
}

// Same as findAniListMatch, but falls back to MyAnimeList then Kitsu when
// AniList has no hit — mainly useful for Comic entries and other titles
// outside AniList's manga/manhwa/manhua-focused catalog. Any provider
// failing (network error, no results) just falls through to the next one;
// returns null only if every provider comes up empty.
async function findTrackerMatch(title: string): Promise<SearchResult | null> {
  const anilist = await findAniListMatch(title);
  if (anilist) return anilist;
  try {
    const mal = pickBestMatch(title, await searchMAL(title));
    if (mal) return mal;
  } catch {
    /* fall through to the next provider */
  }
  try {
    const kitsu = pickBestMatch(title, await searchKitsu(title));
    if (kitsu) return kitsu;
  } catch {
    /* no matches anywhere */
  }
  return null;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Runs findAniListMatch over a list with limited concurrency + a small
// delay per lookup, so bulk/file imports of many titles don't slam
// AniList's rate limit.
async function enrichWithAniList<T extends { title: string }>(
  items: T[],
  merge: (item: T, match: SearchResult) => T,
  concurrency = 4,
): Promise<T[]> {
  const out: T[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      const match = await findTrackerMatch(item.title);
      out[idx] = match ? merge(item, match) : item;
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

type SortKey = "title" | "type" | "chapter" | "status" | "reread" | "created_at";
type SortDir = "asc" | "desc";

function serialize(entries: Entry[]) {
  return entries
    .map((e) => `${e.title}|${e.chapter}|${e.status}|${e.type}|${e.reread}`)
    .join("\n");
}

function Tracker() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!authReady) {
    return <SplashScreen />;
  }
  if (!session) return <AuthPanel />;
  return (
    <TrackerApp
      userId={session.user.id}
      email={session.user.email ?? ""}
      accessToken={session.access_token}
    />
  );
}

function SplashScreen() {
  return (
    <div className="h-screen w-screen grid place-items-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-lg border-2 border-primary border-t-transparent animate-spin" />
        <span className="text-sm font-semibold text-primary tracking-tight">Panels</span>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="h-[100dvh] w-full bg-background text-foreground flex flex-col safe-t animate-pulse">
      <div className="border-b border-border px-3 sm:px-6 py-2 sm:py-3 flex items-center gap-3 sm:gap-6 flex-wrap">
        <div className="h-6 w-24 rounded bg-muted" />
        <div className="h-8 w-px bg-border hidden sm:block" />
        <div className="flex gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-16 rounded bg-muted" />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-3 sm:px-6 py-3 space-y-2">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-12 rounded-md bg-muted/70" />
        ))}
      </div>
    </div>
  );
}

function AuthPanel() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  // In signup mode this holds the account email. In signin mode it holds
  // either a username or an email ("identifier").
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"error" | "success">("error");
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [userFocused, setUserFocused] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">(
    "idle",
  );

  const emailTouched = email.length > 0;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const identifierValid = mode === "signup" ? emailValid : email.trim().length > 0;
  const pwTouched = password.length > 0;
  const pwValid = password.length >= 6;
  const usernameValid = /^[a-zA-Z0-9_]{3,40}$/.test(username.trim());

  // Debounced live availability check while typing a username at signup.
  useEffect(() => {
    if (mode !== "signup") return;
    const uname = username.trim();
    if (!uname) {
      setUsernameStatus("idle");
      return;
    }
    if (!usernameValid) {
      setUsernameStatus("invalid");
      return;
    }
    setUsernameStatus("checking");
    const handle = setTimeout(async () => {
      const { data, error } = await supabase.rpc("username_available", { p_username: uname });
      if (error) {
        setUsernameStatus("idle");
        return;
      }
      setUsernameStatus(data ? "available" : "taken");
    }, 400);
    return () => clearTimeout(handle);
  }, [username, mode, usernameValid]);

  const pwStrength = useMemo(() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }, [password]);

  const strengthLabel = ["Too short", "Weak", "Okay", "Good", "Strong"][pwStrength];
  const strengthColor = [
    "bg-destructive",
    "bg-destructive",
    "bg-ongoing",
    "bg-accent",
    "bg-finished",
  ][pwStrength];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "signup") {
        const uname = username.trim();
        if (!usernameValid) {
          throw new Error("Username must be 3-40 characters (letters, numbers, underscore).");
        }
        const { data: available, error: checkErr } = await supabase.rpc("username_available", {
          p_username: uname,
        });
        if (checkErr) throw checkErr;
        if (!available) throw new Error("That username is already taken.");

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { username: uname },
          },
        });
        if (error) throw error;
        setMsgKind("success");
        setMsg("Check your email to confirm, then sign in.");
      } else {
        const raw = email.trim();
        let loginEmail = raw;
        if (!raw.includes("@")) {
          const { data: resolvedEmail, error: rpcErr } = await supabase.rpc("email_for_username", {
            p_username: raw,
          });
          if (rpcErr) throw rpcErr;
          if (!resolvedEmail) throw new Error("Invalid login credentials");
          loginEmail = resolvedEmail;
        }
        const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
        if (error) throw error;
      }
    } catch (err) {
      setMsgKind("error");
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "signin" ? "signup" : "signin");
    setMsg(null);
    setUsernameStatus("idle");
  };

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-background text-foreground">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 h-[28rem] w-[28rem] rounded-full bg-primary/25 blur-[120px]" />
        <div className="absolute -bottom-48 -right-24 h-[26rem] w-[26rem] rounded-full bg-accent/20 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      <div className="relative z-10 h-full w-full grid lg:grid-cols-2">
        {/* Left / brand panel */}
        <div className="hidden lg:flex flex-col justify-between p-12 border-r border-border/60 bg-card/40 backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/15 border border-primary/30 grid place-items-center">
              <Layers className="h-[18px] w-[18px] text-primary" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold tracking-tight">Panels</span>
              <span className="text-xs text-muted-foreground">reading tracker</span>
            </div>
          </div>

          <div className="max-w-md">
            <h2 className="text-4xl font-bold tracking-tight leading-[1.15]">
              Every chapter,
              <br />
              <span className="text-primary">exactly where you left it.</span>
            </h2>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Track manga, manhwa, manhua, and comics across every device. Panels keeps your
              progress synced, shareable, and effortless.
            </p>

            <div className="mt-10 space-y-5">
              {[
                { icon: BookOpen, title: "One list, every series", desc: "Manga, manhwa, manhua, and comics — all in one place." },
                { icon: RefreshCw, title: "Synced everywhere", desc: "Pick up on your phone right where your laptop left off." },
                { icon: Sparkles, title: "Fast, focused tracking", desc: "No clutter. Just your list, your pace, your progress." },
              ].map((f) => (
                <div key={f.title} className="flex items-start gap-3.5">
                  <div className="mt-0.5 h-8 w-8 shrink-0 rounded-lg bg-secondary border border-border/60 grid place-items-center">
                    <f.icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{f.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground/70">Public by default. Your list, your account.</p>
        </div>

        {/* Right / form panel */}
        <div className="flex flex-col items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-sm">
            {/* Mobile-only brand header */}
            <div className="lg:hidden flex flex-col items-center gap-2 mb-8 text-center">
              <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/30 grid place-items-center">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold tracking-tight text-primary">Panels</span>
                <span className="text-xs text-muted-foreground">reading tracker</span>
              </div>
            </div>

            <div className="rounded-2xl border border-border/80 bg-card shadow-2xl shadow-black/5 p-6 sm:p-7">
              <div className="mb-6">
                <h1 className="text-xl font-semibold tracking-tight">
                  {mode === "signin" ? "Welcome back" : "Create your account"}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {mode === "signin" ? "Sign in to sync your reading list." : "Start tracking in under a minute."}
                </p>
              </div>

              <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
                {/* Email (signup) / Username-or-email (signin) */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="auth-email" className="text-xs font-medium text-muted-foreground">
                    {mode === "signin" ? "Username or email" : "Email"}
                  </label>
                  <div className="relative">
                    {mode === "signin" ? (
                      <User
                        className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors ${
                          emailFocused ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                    ) : (
                      <Mail
                        className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors ${
                          emailFocused ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                    )}
                    <input
                      id="auth-email"
                      type={mode === "signin" ? "text" : "email"}
                      required
                      autoComplete={mode === "signin" ? "username" : "email"}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onFocus={() => setEmailFocused(true)}
                      onBlur={() => setEmailFocused(false)}
                      placeholder={mode === "signin" ? "you@example.com or panel_reader" : "you@example.com"}
                      className={`w-full h-11 pl-10 pr-9 rounded-lg bg-input text-sm outline-none border transition-all focus:ring-2 focus:ring-ring/40 ${
                        emailTouched && !identifierValid
                          ? "border-destructive/60"
                          : "border-transparent focus:border-primary/50"
                      }`}
                    />
                    {emailTouched && mode === "signup" && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {emailValid ? (
                          <CheckCircle2 className="h-4 w-4 text-finished" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive/70" />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Username (signup only) */}
                {mode === "signup" && (
                  <div className="flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <label htmlFor="auth-username" className="text-xs font-medium text-muted-foreground">
                      Username
                    </label>
                    <div className="relative">
                      <User
                        className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors ${
                          userFocused ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                      <input
                        id="auth-username"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onFocus={() => setUserFocused(true)}
                        onBlur={() => setUserFocused(false)}
                        placeholder="e.g. panel_reader"
                        maxLength={40}
                        className={`w-full h-11 pl-10 pr-9 rounded-lg bg-input text-sm outline-none border transition-all focus:ring-2 focus:ring-ring/40 ${
                          usernameStatus === "taken" || usernameStatus === "invalid"
                            ? "border-destructive/60"
                            : "border-transparent focus:border-primary/50"
                        }`}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {usernameStatus === "checking" && (
                          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                        )}
                        {usernameStatus === "available" && <CheckCircle2 className="h-4 w-4 text-finished" />}
                        {(usernameStatus === "taken" || usernameStatus === "invalid") && (
                          <AlertCircle className="h-4 w-4 text-destructive/70" />
                        )}
                      </div>
                    </div>
                    {usernameStatus === "taken" && (
                      <p className="text-[11px] text-destructive/80">That username is already taken.</p>
                    )}
                    {usernameStatus === "invalid" && (
                      <p className="text-[11px] text-destructive/80">
                        3-40 characters: letters, numbers, underscore.
                      </p>
                    )}
                  </div>
                )}

                {/* Password */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="auth-password" className="text-xs font-medium text-muted-foreground">
                      Password
                    </label>
                    <span className="text-[11px] text-muted-foreground/70">min 6 characters</span>
                  </div>
                  <div className="relative">
                    <Lock
                      className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors ${
                        pwFocused ? "text-primary" : "text-muted-foreground"
                      }`}
                    />
                    <input
                      id="auth-password"
                      type={showPw ? "text" : "password"}
                      required
                      minLength={6}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={() => setPwFocused(true)}
                      onBlur={() => setPwFocused(false)}
                      placeholder="••••••••"
                      className={`w-full h-11 pl-10 pr-10 rounded-lg bg-input text-sm outline-none border transition-all focus:ring-2 focus:ring-ring/40 ${
                        pwTouched && !pwValid
                          ? "border-destructive/60"
                          : "border-transparent focus:border-primary/50"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {mode === "signup" && password.length > 0 && (
                    <div className="flex items-center gap-2 pt-0.5 animate-in fade-in duration-200">
                      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden flex gap-0.5">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className={`flex-1 rounded-full transition-colors duration-300 ${
                              i < pwStrength ? strengthColor : "bg-transparent"
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{strengthLabel}</span>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={busy || (mode === "signup" && (usernameStatus === "taken" || usernameStatus === "checking"))}
                  className="group h-11 mt-1 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100 transition-all flex items-center justify-center gap-1.5"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {mode === "signin" ? "Signing in…" : "Creating account…"}
                    </>
                  ) : (
                    <>
                      {mode === "signin" ? "Sign in" : "Create account"}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>

                {msg && (
                  <div
                    className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs animate-in fade-in slide-in-from-top-1 duration-200 ${
                      msgKind === "success"
                        ? "border-finished/30 bg-finished/10 text-finished"
                        : "border-destructive/30 bg-destructive/10 text-destructive"
                    }`}
                  >
                    {msgKind === "success" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    )}
                    <span>{msg}</span>
                  </div>
                )}
              </form>

              <div className="mt-6 pt-5 border-t border-border/60 text-center">
                <button
                  type="button"
                  onClick={switchMode}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {mode === "signin" ? (
                    <>No account? <span className="text-primary font-medium">Sign up</span></>
                  ) : (
                    <>Have an account? <span className="text-primary font-medium">Sign in</span></>
                  )}
                </button>
              </div>
            </div>

            <p className="text-center text-[11px] text-muted-foreground/60 mt-6">
              Public by default — anyone can view your list, only you can edit it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackerApp({
  userId,
  email,
  accessToken,
}: {
  userId: string;
  email: string;
  accessToken: string;
}) {
  const [entries, setEntries] = useState<Entry[]>(() => loadCachedEntries(userId));
  const entriesRef = useRef<Entry[]>([]);
  // Kept in sync with the latest access token so the tab/app-close sweep
  // (below) can read it synchronously from an unload-type event, where
  // there's no time to await supabase.auth.getSession().
  const accessTokenRef = useRef(accessToken);
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);
  // Tracks which entry's title input is currently focused, so the
  // tab/app-close sweep never yanks away a title the user is mid-typing.
  const focusedEntryIdRef = useRef<string | null>(null);
  const [_loading, setLoading] = useState(true);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState<{ ok: number; errors: string[] } | null>(null);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [panelOpen, setPanelOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);
  const [statsDialogOpen, setStatsDialogOpen] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<EntryType | "">("");
  const [statusFilter, setStatusFilter] = useState<EntryStatus | "">("");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const { resolved: theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  const reportDatabaseError = useCallback((action: string, error: { message: string }) => {
    const message = `${action} failed: ${error.message}`;
    console.error(`[Panels database] ${message}`, error);
    setSyncError(message);
    toast.error(message);
  }, []);

  // Display name for the header greeting. Falls back to the local part of
  // the email (never the full address) if no username has been set yet.
  const [username, setUsername] = useState<string | null>(null);
  const loadUsername = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    setUsername(data?.username || email.split("@")[0] || "Reader");
  }, [userId, email]);
  useEffect(() => {
    void loadUsername();
  }, [loadUsername]);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from("entries")
      .select(ENTRY_COLUMNS)
      .eq("user_id", userId)
      .order("position", { ascending: true });
    if (error) {
      reportDatabaseError("Loading your list", error);
    } else if (data) {
      setEntries(data as Entry[]);
      saveCachedEntries(userId, data as Entry[]);
      setSyncError(null);
    }
    setLoading(false);
  }, [reportDatabaseError, userId]);

  // Initial load
  useEffect(() => {
    void reload();
  }, [userId, reload]);

  // Refetch on window focus / tab visible / reconnect
  useEffect(() => {
    const onFocus = () => void reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const onOnline = () => {
      setIsOffline(false);
      void reload();
    };
    const onOffline = () => setIsOffline(true);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  // Realtime sync across devices
  useEffect(() => {
    const channel = supabase
      .channel(`entries-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string } | null)?.id;
            if (oldId) setEntries((prev) => prev.filter((e) => e.id !== oldId));
            return;
          }
          // NOTE: this used to rebuild a "clean" Entry with only a handful of
          // fields (id/title/type/chapter/status/reread), dropping
          // cover_url/author/total_chapters/created_at. Since Postgres
          // realtime UPDATE payloads include the full row, that reconstruction
          // was wiping out the cover art/author/chapter-total on every single
          // edit (chapter +1, status change, etc.) as soon as the echo of your
          // own write came back over the socket. Just use the row as-is.
          const row = payload.new as Entry;
          setEntries((prev) => {
            const idx = prev.findIndex((e) => e.id === row.id);
            if (idx === -1) return [row, ...prev];
            const next = [...prev];
            next[idx] = row;
            return next;
          });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const stats = useMemo(() => {
    const s = {
      chapters: 0,
      total: entries.length,
      rereads: 0,
      types: { Manga: 0, Manhwa: 0, Manhua: 0, Comic: 0 } as Record<EntryType, number>,
      statuses: { Reading: 0, Dropped: 0, Cancelled: 0, Finished: 0 } as Record<EntryStatus, number>,
      matrix: Object.fromEntries(
        TYPES.map((t) => [t, { Reading: 0, Dropped: 0, Cancelled: 0, Finished: 0 }]),
      ) as Record<EntryType, Record<EntryStatus, number>>,
    };
    for (const e of entries) {
      s.chapters += Number(e.chapter) || 0;
      s.rereads += Number(e.reread) || 0;
      s.types[e.type]++;
      s.statuses[e.status]++;
      if (s.matrix[e.type]) s.matrix[e.type][e.status]++;
    }
    return s;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = entries.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.status.toLowerCase().includes(q)
      );
    });
    if (!sortKey) return [...list].sort((a, b) => a.position - b.position);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      if (sortKey === "created_at") return String(av) < String(bv) ? -dir : String(av) > String(bv) ? dir : 0;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * dir;
    });
  }, [entries, filter, typeFilter, statusFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else {
        setSortKey(null);
        setSortDir("asc");
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortValue = sortKey ? `${sortKey}:${sortDir}` : "";

  const INITIAL_VISIBLE = 20;
  const VISIBLE_STEP = 20;
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [filter, typeFilter, statusFilter, sortKey, sortDir]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleCount < filtered.length;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = el.scrollTop;
        const delta = y - lastScrollY.current;
        if (y <= 8) {
          setToolbarHidden(false);
        } else if (Math.abs(delta) > 4) {
          setToolbarHidden(delta > 0);
        }
        lastScrollY.current = y;
        ticking = false;

        const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (remaining < 600) {
          setVisibleCount((c) => (c < filtered.length ? c + VISIBLE_STEP : c));
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [_loading, filtered.length]);
  const applySortValue = (v: string) => {
    if (!v) {
      setSortKey(null);
      setSortDir("asc");
      return;
    }
    const [k, d] = v.split(":") as [SortKey, SortDir];
    setSortKey(k);
    setSortDir(d);
  };

  const update = useCallback(
    async (id: string, patch: Partial<Entry>) => {
      const before = entriesRef.current.find((entry) => entry.id === id);
      const { data, error } = await supabase
        .from("entries")
        .update(patch)
        .eq("id", id)
        .eq("user_id", userId)
        .select(ENTRY_COLUMNS)
        .maybeSingle();
      if (error) {
        reportDatabaseError("Saving your change", error);
        return false;
      }
      if (!data) {
        reportDatabaseError("Saving your change", { message: "No matching row was updated. Please refresh and sign in again." });
        return false;
      }
      setEntries((prev) => prev.map((entry) => (entry.id === id ? (data as Entry) : entry)));
      setSyncError(null);
      // Log a completion whenever a title's status changes *into* Finished
      // (not on every save) — that's the event "titles read this month"
      // is built from. Logged against the reader's local calendar month so
      // it lands in the month they actually finished it, regardless of the
      // server's UTC offset.
      if (before && typeof patch.status === "string" && before.status !== "Finished" && (data as Entry).status === "Finished") {
        const { error: logError } = await supabase.from("completion_log").insert({
          user_id: userId,
          entry_id: id,
          title: (data as Entry).title,
          month: localMonthKey(),
        });
        // Log-only write feeding the Stats dialog — a failure here shouldn't
        // roll back or toast-error the save that already succeeded, but it
        // should be visible in the console instead of vanishing silently.
        if (logError) console.error("[Panels database] Logging completion failed:", logError);
      }
      // Log a chapter change (up or down) so the "chapters read" stat
      // stays accurate — the +1 button, typing a higher number, or
      // correcting a typo/over-count back down, for any title. A decrease
      // logs a negative delta, so correcting a chapter you bumped by
      // mistake nets back out of the day's total instead of leaving a
      // stats total that's now too high. Logged against the reader's
      // local calendar day, same reasoning as completion_log's local
      // month.
      if (before && typeof patch.chapter === "number" && patch.chapter !== before.chapter) {
        const { error: logError } = await supabase.from("chapter_log").insert({
          user_id: userId,
          entry_id: id,
          day: localDayKey(),
          delta: patch.chapter - before.chapter,
        });
        if (logError) console.error("[Panels database] Logging chapters read failed:", logError);
      }
      return true;
    },
    [reportDatabaseError, userId],
  );

  // Drag-and-drop reordering. Only enabled in the plain, unfiltered,
  // unsorted view — with a filter or column sort active there's no honest
  // mapping from "drag this row" back to a single global position, so we
  // disable it rather than do something surprising.
  const canReorder = !filter.trim() && !typeFilter && !statusFilter && !sortKey;
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const reorderEntries = useCallback(
    async (draggedId: string, targetId: string) => {
      if (draggedId === targetId) return;
      const current = [...entriesRef.current].sort((a, b) => a.position - b.position);
      const fromIdx = current.findIndex((x) => x.id === draggedId);
      const toIdx = current.findIndex((x) => x.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return;

      const reordered = [...current];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);

      // Only the rows whose position actually shifted need a write.
      const changed: { id: string; position: number }[] = [];
      reordered.forEach((entry, idx) => {
        if (entry.position !== idx) changed.push({ id: entry.id, position: idx });
      });
      if (changed.length === 0) return;

      // Optimistic local update so the drag feels instant.
      const nextPosition = new Map(changed.map((c) => [c.id, c.position]));
      setEntries((prev) =>
        prev.map((e) => (nextPosition.has(e.id) ? { ...e, position: nextPosition.get(e.id)! } : e)),
      );

      const results = await Promise.all(
        changed.map(({ id, position }) =>
          supabase.from("entries").update({ position }).eq("id", id).eq("user_id", userId),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        reportDatabaseError("Saving new order", failed.error);
        void reload();
      } else {
        setSyncError(null);
      }
    },
    [userId, reportDatabaseError, reload],
  );

  // Keyboard/touch-friendly alternative to dragging — swaps a title with its
  // immediate neighbor. Used by the up/down buttons on mobile, where native
  // HTML5 drag-and-drop isn't reliably supported.
  const moveEntry = useCallback(
    (id: string, direction: -1 | 1) => {
      const current = [...entriesRef.current].sort((a, b) => a.position - b.position);
      const idx = current.findIndex((x) => x.id === id);
      const targetIdx = idx + direction;
      if (idx === -1 || targetIdx < 0 || targetIdx >= current.length) return;
      void reorderEntries(id, current[targetIdx].id);
    },
    [reorderEntries],
  );

  const remove = async (id: string, message = "Title deleted") => {
    const { data, error } = await supabase
      .from("entries")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error) {
      reportDatabaseError("Deleting the title", error);
      return;
    }
    if (!data) {
      reportDatabaseError("Deleting the title", { message: "No matching row was deleted." });
      return;
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
    setSyncError(null);
    toast.success(message);
  };

  // Sign out, but first sweep away any entries that were left with the
  // untouched default "New title" / "New title 2" name — same rule used
  // when a title field is blurred without being renamed (see
  // commitTitleEdit below). This stops blank placeholder rows from
  // piling up in the synced list just because someone added a title,
  // never named it, and left.
  const signOutAndCleanup = useCallback(async () => {
    const stale = entriesRef.current.filter((e) => DEFAULT_TITLE_RE.test(e.title.trim()));
    if (stale.length > 0) {
      const ids = stale.map((e) => e.id);
      const { error } = await supabase
        .from("entries")
        .delete()
        .in("id", ids)
        .eq("user_id", userId);
      if (!error) {
        setEntries((prev) => prev.filter((e) => !ids.includes(e.id)));
      }
      // Don't block sign-out on cleanup failing — worst case the stale
      // rows are still there next time the user logs in.
    }
    await supabase.auth.signOut();
  }, [userId]);

  // Same sweep as signOutAndCleanup, but fired when the tab/app is closed,
  // refreshed, or backgrounded — not just on an explicit sign-out. Skips
  // whichever entry is currently focused so it never deletes a title the
  // user is actively mid-typing.
  //
  // Uses a raw `fetch` with `keepalive: true` (rather than the supabase-js
  // client) because a normal request gets cancelled the instant the page
  // actually unloads — keepalive requests are allowed to finish in the
  // background even after the tab is gone. It can't be awaited from here,
  // so this is best-effort: any row it misses just gets cleaned up next
  // time (on the next sign-out, or the next time this sweep runs).
  const sweepStaleTitles = useCallback(() => {
    const stale = entriesRef.current.filter(
      (e) => DEFAULT_TITLE_RE.test(e.title.trim()) && e.id !== focusedEntryIdRef.current,
    );
    if (stale.length === 0) return;
    const ids = stale.map((e) => e.id);

    // Remove locally right away — if the tab is actually closing there's
    // no later moment to update state, so don't wait on the network call.
    setEntries((prev) => prev.filter((e) => !ids.includes(e.id)));

    const token = accessTokenRef.current;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    if (!token || !supabaseUrl || !supabaseKey) return;

    const idFilter = ids.map((id) => `"${id}"`).join(",");
    const url = `${supabaseUrl}/rest/v1/entries?id=in.(${idFilter})&user_id=eq.${userId}`;
    try {
      void fetch(url, {
        method: "DELETE",
        keepalive: true,
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${token}`,
          Prefer: "return=minimal",
        },
      }).catch(() => {
        /* best-effort — a missed sweep just leaves the row for next time */
      });
    } catch {
      /* some browsers throw synchronously if the keepalive payload/queue
         is over budget — nothing to do but let it go */
    }
  }, [userId]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") sweepStaleTitles();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    // `pagehide` catches actual navigation/close on browsers where
    // visibilitychange fires late or not at all; calling the sweep twice
    // is harmless since deleting an already-deleted id is a no-op.
    window.addEventListener("pagehide", sweepStaleTitles);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", sweepStaleTitles);
    };
  }, [sweepStaleTitles]);

  const commitTitleEdit = useCallback(
    async (entry: Entry, rawTitle: string, revert: (value: string) => void) => {
      const title = rawTitle.trim();
      if (!title) {
        revert(entry.title);
        toast.error("A title cannot be empty");
        return;
      }
      const isDefaultTitle = DEFAULT_TITLE_RE.test(title);
      if (title === entry.title) {
        if (isDefaultTitle) {
          void remove(entry.id, "Removed — left as \"New title\"");
        }
        return;
      }

      if (isDefaultTitle) {
        void remove(entry.id, "Removed — left as \"New title\"");
        return;
      }

      const saved = await update(entry.id, { title });
      if (!saved) {
        revert(entry.title);
        return;
      }

      // Only auto-fill when this entry has no cover yet — never clobber
      // art the user picked via Search or already has from an import.
      if (!entry.cover_url) {
        const match = await findTrackerMatch(title);
        if (match) {
          // Same reasoning as backfillCovers: only trust `type` from an
          // exact title match, not a fuzzy best-guess result.
          void update(entry.id, {
            ...(match.exactMatch ? { type: match.type } : {}),
            cover_url: match.coverUrl,
            author: match.author,
            total_chapters: match.totalChapters,
          });
        }
      }
    },
    [update],
  );

  const addFromSearch = async (result: SearchResult) => {
    const taken = new Set(entries.map((e) => e.title.trim().toLowerCase()));
    const title = result.title.trim();
    if (!title) return false;
    if (taken.has(title.toLowerCase())) {
      toast.error(`"${title}" is already in your list`);
      return false;
    }
    const row = {
      user_id: userId,
      title,
      type: result.type,
      chapter: 0,
      status: "Reading",
      reread: 0,
      cover_url: result.coverUrl,
      author: result.author,
      total_chapters: result.totalChapters,
      position: nextTopPosition(entries),
    };
    const { data, error } = await supabase
      .from("entries")
      .insert(row)
      .select(ENTRY_COLUMNS)
      .single();
    if (error) {
      reportDatabaseError("Adding a title", error);
      return false;
    }
    if (data) {
      setSyncError(null);
      setEntries((prev) => [data as Entry, ...prev]);
      toast.success(`"${title}" added`);
      return true;
    }
    return false;
  };

  // Creates a new entry directly, skipping the AniList lookup. Used both
  // for the "blank placeholder" quick-add (no title passed) and for the
  // "can't find it on AniList, just add it" manual path in SearchDialog
  // (title passed in from whatever the user typed in the search box).
  const addBlank = async (rawTitle = "") => {
    const taken = new Set(entries.map((e) => e.title.trim().toLowerCase()));
    let title = rawTitle.trim();
    if (title) {
      if (taken.has(title.toLowerCase())) {
        toast.error(`"${title}" is already in your list`);
        return false;
      }
    } else {
      title = "New title";
      let n = 2;
      while (taken.has(title.toLowerCase())) title = `New title ${n++}`;
    }
    const row = { user_id: userId, title, type: "Manga", chapter: 0, status: "Reading", reread: 0, position: nextTopPosition(entries) };
    const { data, error } = await supabase
      .from("entries")
      .insert(row)
      .select(ENTRY_COLUMNS)
      .single();
    if (error) {
      reportDatabaseError("Adding a title", error);
      return false;
    }
    if (data) {
      setSyncError(null);
      setEntries((prev) => [data as Entry, ...prev]);
      toast.success(DEFAULT_TITLE_RE.test(title) ? "Title saved to your synced list" : `"${title}" added`);
      return true;
    }
    return false;
  };

  const [backfilling, setBackfilling] = useState(false);

  // Retroactively fetch covers/metadata for entries that never got enriched.
  const backfillCovers = async () => {
    const missing = entries.filter((e) => !e.cover_url);
    if (missing.length === 0) {
      toast.info("Every title already has a cover");
      return;
    }
    setBackfilling(true);
    try {
      // Only apply `type` when the tracker match was an exact title match.
      // A fuzzy/best-guess match (pickBestMatch's top-result fallback) can
      // be a different series entirely, and its type was overwriting a
      // correct manually-set type with a wrong guess.
      const enriched = await enrichWithAniList(missing, (entry, m) => ({
        ...entry,
        type: m.exactMatch ? m.type : entry.type,
        cover_url: m.coverUrl,
        author: m.author,
        total_chapters: m.totalChapters,
      }));
      let found = 0;
      for (const row of enriched) {
        if (!row.cover_url) continue;
        const ok = await update(row.id, {
          type: row.type,
          cover_url: row.cover_url,
          author: row.author,
          total_chapters: row.total_chapters,
        });
        if (ok) found++;
      }
      toast.success(
        found ? `Added covers for ${found} of ${missing.length} titles` : "No matches found on AniList, MyAnimeList, or Kitsu",
      );
    } finally {
      setBackfilling(false);
    }
  };

  const runImport = async () => {
    const lines = importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const toInsert: Parsed[] = [];
    const errors: string[] = [];
    const existing = new Set(entries.map((e) => e.title.trim().toLowerCase()));
    lines.forEach((line, i) => {
      const piped = line.includes("|") ? parsePipeLine(line) : null;
      const parsed = piped ?? parseSpaceLine(line).entry;
      const err = piped ? null : parseSpaceLine(line).error;
      if (parsed) {
        const key = parsed.title.trim().toLowerCase();
        if (existing.has(key)) {
          errors.push(`Line ${i + 1}: duplicate title "${parsed.title}"`);
        } else {
          existing.add(key);
          toInsert.push(parsed);
        }
      } else errors.push(`Line ${i + 1}: ${err ?? "invalid"}`);
    });
   let addedCount = 0;
    if (toInsert.length) {
      const enriched = await enrichWithAniList(toInsert, (p, m) => ({
        ...p,
        type: m.type ?? p.type,
        cover_url: m.coverUrl ?? undefined,
        author: m.author ?? undefined,
        total_chapters: m.totalChapters ?? undefined,
      }));
      const rows = enriched.map((p, i) => ({
        ...p,
        user_id: userId,
        // Land the whole pasted batch above the existing list, in the same
        // relative order the lines were pasted in.
        position: nextTopPosition(entries) - (enriched.length - 1) + i,
      }));
      const { data, error } = await supabase
        .from("entries")
        .insert(rows)
        .select(ENTRY_COLUMNS);
      if (error) {
        errors.push(error.message);
        reportDatabaseError("Importing titles", error);
      }
      else if (data) {
        setEntries((prev) => [...(data as Entry[]), ...prev]);
        addedCount = data.length;
      }
    }
    setImportMsg({ ok: addedCount, errors });
    if (addedCount && !errors.length) setImportText("");
  };

  const saveTxt = () => {
    const blob = new Blob([serialize(entries)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `panels-${date}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadTxt = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result ?? "");
      const loaded: Parsed[] = [];
      const existing = new Set(entries.map((e) => e.title.trim().toLowerCase()));
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const e = parsePipeLine(line);
        if (!e) continue;
        const key = e.title.trim().toLowerCase();
        if (existing.has(key)) continue;
        existing.add(key);
        loaded.push(e);
      }
      if (loaded.length) {
        const enriched = await enrichWithAniList(loaded, (p, m) => ({
          ...p,
          type: m.type ?? p.type,
          cover_url: m.coverUrl ?? undefined,
          author: m.author ?? undefined,
          total_chapters: m.totalChapters ?? undefined,
        }));
        const rows = enriched.map((p, i) => ({
          ...p,
          user_id: userId,
          position: nextTopPosition(entries) - (enriched.length - 1) + i,
        }));
        const { data, error } = await supabase
          .from("entries")
          .insert(rows)
          .select(ENTRY_COLUMNS);
        if (error) reportDatabaseError("Loading titles", error);
        else if (data) {
          setEntries((prev) => [...(data as Entry[]), ...prev]);
          toast.success(`${data.length} title${data.length === 1 ? "" : "s"} saved`);
        }
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  };

  if (_loading) {
    return <ListSkeleton />;
  }

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-background text-foreground flex flex-col safe-t">
      {isOffline && (
        <div
          role="status"
          className="px-3 sm:px-6 py-1.5 text-xs bg-muted text-muted-foreground border-b border-border"
        >
          You're offline — changes will sync once you're back online.
        </div>
      )}
      {syncError && (
        <div
          role="alert"
          className="px-3 sm:px-6 py-1.5 text-xs bg-destructive/15 text-destructive border-b border-destructive/30"
        >
          {syncError}
        </div>
      )}
      {/* Header + stats */}
      <header className="relative border-b border-border px-3 sm:px-6 py-4 sm:py-4 flex flex-col gap-3.5 sm:gap-3 overflow-hidden">
        <div className="pointer-events-none absolute -top-24 left-1/3 h-56 w-56 rounded-full bg-primary/10 blur-[100px]" />

        {/* Top row: brand + primary nav */}
        <div className="relative flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/30 grid place-items-center shrink-0">
              <Layers className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-primary leading-none">Panels</h1>
              <span className="hidden sm:inline text-xs text-muted-foreground">reading tracker</span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden lg:inline text-xs text-muted-foreground mr-1.5 whitespace-nowrap">
              {timeGreeting()}
              {username ? `, ${username}` : ""}
            </span>
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="shrink-0 h-9 w-9 grid place-items-center rounded-lg border border-border hover:bg-secondary hover:border-primary/30 transition-colors"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setPanelOpen((v) => !v)}
              aria-label="Toggle bulk import panel"
              aria-expanded={panelOpen}
              className={`hidden sm:grid shrink-0 h-9 w-9 place-items-center rounded-lg border transition-colors ${
                panelOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border hover:bg-secondary hover:border-primary/30"
              }`}
            >
              {panelOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setMobileActionsOpen((v) => !v)}
              aria-label="Toggle menu"
              aria-expanded={mobileActionsOpen}
              className={`sm:hidden shrink-0 h-9 w-9 grid place-items-center rounded-lg border transition-colors ${
                mobileActionsOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border hover:bg-secondary hover:border-primary/30"
              }`}
            >
              {mobileActionsOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Stat cards row */}
        <div className="relative">
          <div className="flex items-stretch gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-3 px-3 sm:mx-0 sm:px-0">
            <div className="snap-start"><StatCard icon={BookOpen} label="Chapters" value={stats.chapters.toLocaleString()} accent="primary" /></div>
            <div className="snap-start"><StatCard icon={Layers} label="Titles" value={stats.total} accent="finished" /></div>
            <div className="snap-start"><StatCard icon={RefreshCw} label="Rereads" value={stats.rereads} accent="ongoing" /></div>
            <div className="hidden md:flex items-center gap-1.5 px-3 rounded-lg border border-border/70 bg-card/40 shrink-0">
              {TYPES.map((t, i) => (
                <span key={t} className="text-xs whitespace-nowrap">
                  {i > 0 && <span className="text-border mr-1.5">·</span>}
                  <span className="text-foreground font-semibold">{stats.types[t]}</span>{" "}
                  <span className="text-muted-foreground">{t}</span>
                </span>
              ))}
            </div>
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              {STATUSES.map((s) => (
                <StatusPill key={s} status={s} count={stats.statuses[s]} />
              ))}
            </div>
          </div>
          {/* Edge fade hinting horizontal scroll, mobile only */}
          <div className="sm:hidden pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent" />
        </div>

        {/* Status pills — own single-line row on mobile so they don't fight the stat-card scroller */}
        <div className="sm:hidden flex items-center gap-1.5 flex-nowrap overflow-x-auto no-scrollbar -mx-3 px-3">
          {STATUSES.map((s) => (
            <StatusPill key={s} status={s} count={stats.statuses[s]} />
          ))}
        </div>

        {/* Action row */}
        <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
          <span className="text-xs text-muted-foreground lg:hidden">
            {timeGreeting()}
            {username ? `, ${username}` : ""}
          </span>

          {/* Mobile: hamburger opens a bottom sheet (see mobileActionsOpen below the header) instead of this being an inline dropdown */}

          {/* Desktop / tablet: inline buttons */}
          <div className="hidden sm:flex sm:ml-auto items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setProfileOpen(true)}
              className="h-8 px-3 rounded-lg border border-border hover:bg-secondary hover:border-primary/30 transition-colors inline-flex items-center gap-1.5 text-xs font-medium"
            >
              <User className="h-3.5 w-3.5" />
              Profile
            </button>
            <button
              onClick={() => setStatsDialogOpen(true)}
              className="h-8 px-3 rounded-lg border border-border hover:bg-secondary hover:border-primary/30 transition-colors inline-flex items-center gap-1.5 text-xs font-medium"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Statistics</span>
            </button>
            <button
              onClick={() => void backfillCovers()}
              disabled={backfilling}
              className="h-8 px-3 rounded-lg border border-border hover:bg-secondary hover:border-primary/30 transition-colors inline-flex items-center gap-1.5 disabled:opacity-60 text-xs font-medium"
              title="Fetch missing covers from AniList"
            >
              {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">
                {backfilling ? "Fetching covers…" : "Fetch covers"}
              </span>
              <span className="sm:hidden">Covers</span>
            </button>
            <Link
              to="/users"
              className="h-8 px-3 rounded-lg border border-border hover:bg-secondary hover:border-primary/30 transition-colors inline-flex items-center gap-1.5 text-xs font-medium"
            >
              <User className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Browse Users</span>
            </Link>
            <button
              onClick={() => void signOutAndCleanup()}
              className="h-8 px-3 rounded-lg border border-border text-muted-foreground hover:bg-destructive/10 hover:border-destructive/30 hover:text-destructive transition-colors text-xs font-medium"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Mobile action menu — a small bottom sheet triggered by the hamburger button, instead of an inline dropdown pushing the header content down. */}
      {mobileActionsOpen && (
        <div className="sm:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Menu">
          <div
            className="absolute inset-0 bg-background/60 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setMobileActionsOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 safe-b rounded-t-2xl border-t border-border bg-card shadow-lg animate-in slide-in-from-bottom duration-200 overflow-hidden">
            <div className="mx-auto mt-2.5 mb-1 h-1 w-10 rounded-full bg-border" />
            <nav className="py-1.5">
              <button
                onClick={() => {
                  setProfileOpen(true);
                  setMobileActionsOpen(false);
                }}
                className="flex items-center gap-3 w-full h-11 px-4 text-sm font-medium active:bg-secondary transition-colors"
              >
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                Profile
              </button>
              <button
                onClick={() => {
                  setStatsDialogOpen(true);
                  setMobileActionsOpen(false);
                }}
                className="flex items-center gap-3 w-full h-11 px-4 text-sm font-medium active:bg-secondary transition-colors"
              >
                <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
                Statistics
              </button>
              <button
                onClick={() => {
                  void backfillCovers();
                  setMobileActionsOpen(false);
                }}
                disabled={backfilling}
                className="flex items-center gap-3 w-full h-11 px-4 text-sm font-medium active:bg-secondary transition-colors disabled:opacity-60"
              >
                {backfilling ? (
                  <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                Fetch covers
              </button>
              <Link
                to="/users"
                onClick={() => setMobileActionsOpen(false)}
                className="flex items-center gap-3 w-full h-11 px-4 text-sm font-medium active:bg-secondary transition-colors"
              >
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                Browse Users
              </Link>
              <button
                onClick={() => {
                  setPanelOpen(true);
                  setMobileActionsOpen(false);
                }}
                className="flex items-center gap-3 w-full h-11 px-4 text-sm font-medium active:bg-secondary transition-colors"
              >
                <ClipboardList className="h-4 w-4 text-muted-foreground shrink-0" />
                Import
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={() => void signOutAndCleanup()}
                className="flex items-center gap-3 w-full h-11 px-4 text-sm font-medium text-destructive active:bg-destructive/10 transition-colors"
              >
                <X className="h-4 w-4 shrink-0" />
                Sign out
              </button>
            </nav>
          </div>
        </div>
      )}

      {profileOpen && (
        <ProfileDialog
          userId={userId}
          email={email}
          onClose={() => {
            setProfileOpen(false);
            void loadUsername();
          }}
        />
      )}

      {statsDialogOpen && (
        <Suspense fallback={null}>
          <StatsDialog userId={userId} stats={stats} onClose={() => setStatsDialogOpen(false)} />
        </Suspense>
      )}

      {searchDialogOpen && (
        <SearchDialog onAdd={addFromSearch} onAddManual={addBlank} onClose={() => setSearchDialogOpen(false)} />
      )}


      {/* Main grid */}
      <main id="main-content" className="flex-1 min-h-0 flex relative">
        {/* Table panel */}
        <section className="flex flex-col min-h-0 flex-1 border-r border-border">
          <div
            className={`flex flex-col gap-2.5 px-3 sm:px-4 border-b border-border bg-card/30 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 overflow-hidden transition-[max-height,opacity,padding,border-color] duration-300 ease-in-out ${
              toolbarHidden
                ? "max-h-0 opacity-0 py-0 border-transparent pointer-events-none"
                : "max-h-64 sm:max-h-40 opacity-100 py-3 sm:py-2.5"
            }`}
          >
            <div className="relative w-full sm:flex-1 sm:min-w-[8rem]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter your list…"
                className="w-full h-9 sm:h-9 pl-9 pr-3 rounded-full bg-input text-foreground placeholder:text-muted-foreground text-sm outline-none border border-transparent focus:border-primary/40 focus:ring-2 focus:ring-ring/40 transition-all"
              />
            </div>

            {/* Mobile: sort/type/status as an evenly-sized row.
                appearance-none + a small custom chevron (instead of each
                phone's native dropdown arrow, which eats 20-30px per
                select) reclaims width so all three comfortably fit one
                row without getting clipped. flex-1 basis-0 + min-w-0 keeps
                them equal width and able to shrink below their own
                content's natural size. */}
            <div className="flex gap-1 w-full min-w-0 sm:hidden">
              <div className="relative flex-1 basis-0 min-w-0">
                <select
                  value={sortValue}
                  onChange={(e) => applySortValue(e.target.value)}
                  className="appearance-none min-w-0 w-full h-8 pl-1.5 pr-3.5 rounded-lg bg-input border border-transparent text-[10px] outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer truncate"
                  aria-label="Sort"
                >
                  <option value="">My Order</option>
                  <option value="created_at:desc">Newly Added</option>
                  <option value="created_at:asc">Oldest Added</option>
                  <option value="title:asc">Title A → Z</option>
                  <option value="title:desc">Title Z → A</option>
                  <option value="chapter:desc">Ch. High → Low</option>
                  <option value="chapter:asc">Ch. Low → High</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground" />
              </div>
              <div className="relative flex-1 basis-0 min-w-0">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as EntryType | "")}
                  className="appearance-none min-w-0 w-full h-8 pl-1.5 pr-3.5 rounded-lg bg-input border border-transparent text-[10px] outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer truncate"
                  aria-label="Filter by type"
                >
                  <option value="">Types</option>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground" />
              </div>
              <div className="relative flex-1 basis-0 min-w-0">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as EntryStatus | "")}
                  className="appearance-none min-w-0 w-full h-8 pl-1.5 pr-3.5 rounded-lg bg-input border border-transparent text-[10px] outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer truncate"
                  aria-label="Filter by status"
                >
                  <option value="">Status</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground" />
              </div>
            </div>

            {/* Mobile: single button opens the search-or-add-manually dialog. */}
            <div className="flex gap-1.5 w-full min-w-0 sm:hidden">
              <button
                onClick={() => setSearchDialogOpen(true)}
                className="flex-1 basis-0 min-w-0 h-9 rounded-full bg-ongoing text-white dark:text-slate-950 text-xs font-semibold active:opacity-90 transition-all shadow-sm shadow-ongoing/30 inline-flex items-center justify-center gap-1.5"
              >
                <Search className="h-3.5 w-3.5" />
                + Add title
              </button>
            </div>
            {/* Desktop / tablet: original inline row */}
            <div className="hidden sm:flex flex-wrap items-center gap-1.5">
              <select
                value={sortValue}
                onChange={(e) => applySortValue(e.target.value)}
                className="h-9 px-3.5 rounded-full bg-input border border-transparent hover:border-border text-sm outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer shrink-0 max-w-[9rem] transition-colors"
                title="Sort"
                aria-label="Sort"
              >
                <option value="">My Order</option>
                <option value="created_at:desc">Newly Added</option>
                <option value="created_at:asc">Oldest Added</option>
                <option value="title:asc">Title A → Z</option>
                <option value="title:desc">Title Z → A</option>
                <option value="chapter:desc">Chapter High → Low</option>
                <option value="chapter:asc">Chapter Low → High</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as EntryType | "")}
                className="h-9 px-3.5 rounded-full bg-input border border-transparent hover:border-border text-sm outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer shrink-0 max-w-[7.5rem] transition-colors"
                title="Filter by type"
                aria-label="Filter by type"
              >
                <option value="">Types</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as EntryStatus | "")}
                className="h-9 px-3.5 rounded-full bg-input border border-transparent hover:border-border text-sm outline-none focus:ring-2 focus:ring-ring/40 cursor-pointer shrink-0 max-w-[8rem] transition-colors"
                title="Filter by status"
                aria-label="Filter by status"
              >
                <option value="">Status</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setSearchDialogOpen(true)}
                className="h-9 px-4 rounded-full bg-ongoing text-white dark:text-slate-950 text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all shrink-0 shadow-sm shadow-ongoing/30 inline-flex items-center gap-1.5"
                title="Search & add a title"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">+ Add</span>
              </button>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto overflow-x-hidden scroll-touch safe-b"
          >
            {/* Mobile card list */}
            <ul className="md:hidden divide-y divide-border">
              {filtered.length === 0 && (
                <li className="px-4 py-16 text-center text-muted-foreground text-sm">
                  {entries.length === 0
                    ? "No titles yet. Add one, or use the menu to paste a list."
                    : "Nothing matches that filter."}
                </li>
              )}
              {visible.map((e) => (
                <li key={e.id} className={`px-3 py-3 ${statusRowBorder(e.status)}`}>
                  <div className="flex items-stretch gap-3">
                    {e.cover_url ? (
                      <img
                        src={e.cover_url}
                        alt=""
                        className="w-20 sm:w-24 shrink-0 rounded-md object-cover bg-muted"
                      />
                    ) : (
                      <div className="w-20 sm:w-24 shrink-0 rounded-md bg-muted" />
                    )}
                    <div className="min-w-0 flex-1 flex flex-col gap-2">
                      <div className="flex items-start gap-2">
                        <input
                          key={`${e.id}-${e.title}`}
                          defaultValue={e.title}
                          onFocus={() => {
                            focusedEntryIdRef.current = e.id;
                          }}
                          onBlur={(ev) => {
                            if (focusedEntryIdRef.current === e.id) focusedEntryIdRef.current = null;
                            void commitTitleEdit(e, ev.target.value, (v) => {
                              ev.target.value = v;
                            });
                          }}
                          className="min-w-0 flex-1 bg-transparent outline-none focus:bg-input rounded px-2 py-1"
                        />
                        <div className="flex flex-col shrink-0">
                          <button
                            type="button"
                            onClick={() => moveEntry(e.id, -1)}
                            disabled={!canReorder}
                            aria-label={`Move ${e.title} up`}
                            title={canReorder ? "Move up" : "Clear filters & sorting to reorder"}
                            className="h-4 w-9 grid place-items-center text-muted-foreground disabled:opacity-30"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveEntry(e.id, 1)}
                            disabled={!canReorder}
                            aria-label={`Move ${e.title} down`}
                            title={canReorder ? "Move down" : "Clear filters & sorting to reorder"}
                            className="h-4 w-9 grid place-items-center text-muted-foreground disabled:opacity-30"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${e.title}"?`)) remove(e.id);
                          }}
                          aria-label="Delete title"
                          className="shrink-0 h-9 w-9 grid place-items-center rounded-md text-muted-foreground active:text-destructive text-xl leading-none"
                        >
                          ×
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={e.type}
                          onChange={(ev) => void update(e.id, { type: ev.target.value as EntryType })}
                          aria-label={`Type for ${e.title}`}
                          className="h-10 w-full min-w-0 rounded-md bg-input px-2 outline-none"
                        >
                          {TYPES.map((t) => (
                            <option key={t} value={t} className="bg-card">
                              {t}
                            </option>
                          ))}
                        </select>
                        <select
                          value={e.status}
                          onChange={(ev) => void update(e.id, { status: ev.target.value as EntryStatus })}
                          aria-label={`Status for ${e.title}`}
                          className={`h-10 w-full min-w-0 rounded-full px-3 outline-none font-semibold text-sm text-center appearance-none ${statusBadgeClasses(e.status)}`}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s} className="bg-card text-foreground">
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">Ch.</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            key={`m-${e.id}-chapter-${e.chapter}`}
                            defaultValue={e.chapter}
                            onBlur={(ev) => {
                              const chapter = Number(ev.target.value) || 0;
                              if (chapter !== e.chapter) void update(e.id, { chapter });
                            }}
                            className="min-w-0 flex-1 h-10 rounded-md bg-input px-2 outline-none"
                          />
                          <button
                            onClick={() => void update(e.id, { chapter: e.chapter + 1 })}
                            className="shrink-0 h-10 px-3 rounded-md bg-secondary text-secondary-foreground text-xs font-medium"
                          >
                            +1
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">Reread</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            key={`m-${e.id}-reread-${e.reread}`}
                            defaultValue={e.reread}
                            onBlur={(ev) => {
                              const reread = Number(ev.target.value) || 0;
                              if (reread !== e.reread) void update(e.id, { reread });
                            }}
                            className="min-w-0 flex-1 h-10 rounded-md bg-input px-2 outline-none"
                          />
                          <button
                            onClick={() => void update(e.id, { reread: e.reread + 1 })}
                            className="shrink-0 h-10 px-3 rounded-md bg-secondary text-secondary-foreground text-xs font-medium"
                          >
                            +1
                          </button>
                        </div>
                      </div>
                      <ChapterProgress chapter={e.chapter} total={e.total_chapters} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {hasMore && (
              <div className="md:hidden px-4 py-4 flex justify-center">
                <button
                  onClick={() => setVisibleCount((c) => c + VISIBLE_STEP)}
                  className="h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-secondary hover:border-primary/30 transition-colors"
                >
                  Load more ({filtered.length - visibleCount} left)
                </button>
              </div>
            )}

            <table className="hidden md:table w-full min-w-[620px] text-sm">
              <thead className="sticky top-0 bg-card/95 backdrop-blur-sm text-xs uppercase tracking-wide text-muted-foreground z-10 border-b border-border shadow-sm shadow-black/5">
                <tr>
                  <th className="w-8"></th>
                  <th className="w-12"></th>
                  <SortTh label="Title" k="title" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-left px-4 py-2" />
                  <SortTh label="Type" k="type" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-left px-2 py-2 w-28" />
                  <SortTh label="Ch." k="chapter" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-right px-2 py-2 w-24" align="right" />
                  <SortTh label="Status" k="status" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-left px-2 py-2 w-32" />
                  <SortTh label="Reread" k="reread" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} className="text-right px-2 py-2 w-20" align="right" />
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-muted-foreground">
                      {entries.length === 0
                        ? "No titles yet. Add one, or paste a list on the right."
                        : "Nothing matches that filter."}
                    </td>
                  </tr>
                )}
                {visible.map((e) => (
                  <tr
                    key={e.id}
                    onDragOver={(ev) => {
                      if (!canReorder || !dragId) return;
                      ev.preventDefault();
                      if (dragOverId !== e.id) setDragOverId(e.id);
                    }}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      if (!canReorder || !dragId) return;
                      void reorderEntries(dragId, e.id);
                      setDragId(null);
                      setDragOverId(null);
                    }}
                    className={`border-t border-border hover:bg-secondary/50 transition-colors group ${statusRowBorder(e.status)} ${
                      dragId === e.id ? "opacity-50" : ""
                    } ${dragOverId === e.id && dragId && dragId !== e.id ? "outline outline-2 outline-primary -outline-offset-2" : ""}`}
                  >
                    <td className="pl-2 sm:pl-3 py-1.5">
                      <button
                        type="button"
                        draggable={canReorder}
                        onDragStart={(ev) => {
                          if (!canReorder) {
                            ev.preventDefault();
                            return;
                          }
                          setDragId(e.id);
                          ev.dataTransfer.effectAllowed = "move";
                          ev.dataTransfer.setData("text/plain", e.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setDragOverId(null);
                        }}
                        disabled={!canReorder}
                        aria-label={`Reorder ${e.title}`}
                        title={canReorder ? "Drag to reorder" : "Clear search, filters, and sorting to reorder"}
                        className={`h-6 w-6 grid place-items-center rounded text-muted-foreground ${
                          canReorder ? "cursor-grab active:cursor-grabbing hover:text-foreground hover:bg-muted" : "cursor-not-allowed opacity-40"
                        }`}
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                    </td>
                    <td className="py-1.5 pl-1">
                      {e.cover_url ? (
                        <img
                          src={e.cover_url}
                          alt=""
                          className="h-24 w-16 rounded-lg object-cover bg-muted shadow-sm ring-1 ring-border/60 group-hover:ring-primary/30 transition-all"
                        />
                      ) : (
                        <div className="h-24 w-16 rounded-lg bg-muted grid place-items-center">
                          <BookOpen className="h-5 w-5 text-muted-foreground/40" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <input
                             key={`${e.id}-${e.title}`}
                             defaultValue={e.title}
                             onFocus={() => {
                               focusedEntryIdRef.current = e.id;
                             }}
                             onBlur={(ev) => {
                               if (focusedEntryIdRef.current === e.id) focusedEntryIdRef.current = null;
                               void commitTitleEdit(e, ev.target.value, (v) => {
                                 ev.target.value = v;
                               });
                             }}
                            className="w-full bg-transparent outline-none focus:bg-input rounded px-2 py-1"
                          />
                          <div className="px-2">
                            <ChapterProgress chapter={e.chapter} total={e.total_chapters} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={e.type}
                         onChange={(ev) => void update(e.id, { type: ev.target.value as EntryType })}
                        aria-label={`Type for ${e.title}`}
                        className="w-full bg-transparent hover:bg-input rounded px-2 py-1 outline-none cursor-pointer"
                      >
                        {TYPES.map((t) => (
                          <option key={t} value={t} className="bg-card">
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                           key={`${e.id}-chapter-${e.chapter}`}
                           defaultValue={e.chapter}
                           onBlur={(ev) => {
                             const chapter = Number(ev.target.value) || 0;
                             if (chapter !== e.chapter) void update(e.id, { chapter });
                           }}
                          className="w-16 bg-transparent text-right outline-none focus:bg-input rounded px-2 py-1"
                        />
                        <button
                           onClick={() => void update(e.id, { chapter: e.chapter + 1 })}
                          className="opacity-0 group-hover:opacity-100 transition text-xs px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground"
                          title="+1 chapter"
                        >
                          +1
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={e.status}
                        onChange={(ev) =>
                           void update(e.id, { status: ev.target.value as EntryStatus })
                        }
                        aria-label={`Status for ${e.title}`}
                        className={`w-full rounded-full px-3 py-1.5 outline-none cursor-pointer font-semibold text-xs text-center appearance-none transition-colors ${statusBadgeClasses(e.status)}`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s} className="bg-card text-foreground">
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <input
                          type="number"
                           key={`${e.id}-reread-${e.reread}`}
                           defaultValue={e.reread}
                           onBlur={(ev) => {
                             const reread = Number(ev.target.value) || 0;
                             if (reread !== e.reread) void update(e.id, { reread });
                           }}
                          className="w-16 bg-transparent text-right outline-none focus:bg-input rounded px-2 py-1"
                        />
                        <button
                           onClick={() => void update(e.id, { reread: e.reread + 1 })}
                          className="opacity-0 group-hover:opacity-100 transition text-xs px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground hover:bg-primary hover:text-primary-foreground"
                          title="+1 reread"
                        >
                          +1
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${e.title}"?`)) remove(e.id);
                        }}
                        aria-label={`Delete ${e.title}`}
                        className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-destructive text-lg leading-none"
                        title="Delete"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div className="hidden md:flex px-4 py-4 justify-center">
                <button
                  onClick={() => setVisibleCount((c) => c + VISIBLE_STEP)}
                  className="h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-secondary hover:border-primary/30 transition-colors"
                >
                  Load more ({filtered.length - visibleCount} left)
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Backdrop (mobile) */}
        {panelOpen && (
          <div
            onClick={() => setPanelOpen(false)}
            className="lg:hidden fixed inset-0 z-30 bg-background/70"
          />
        )}

        {/* Side panel */}
        <aside
          className={`${panelOpen ? "flex" : "hidden"} flex-col min-h-0 bg-card fixed inset-y-0 right-0 z-40 w-[88%] max-w-sm border-l border-border shadow-xl safe-t safe-b lg:static lg:z-auto lg:w-[360px] lg:max-w-none lg:shadow-none lg:pt-0 lg:pb-0`}
        >
          <div className="px-4 py-2 border-b border-border flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Bulk import</h2>
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-[10px] text-muted-foreground uppercase tracking-wide">
                Title … Ch Status Type Reread
              </span>
              <button
                onClick={() => setPanelOpen(false)}
                aria-label="Close bulk import panel"
                className="h-7 w-7 grid place-items-center rounded-md border border-border hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="p-4 flex flex-col gap-2 flex-1 min-h-0">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"Solo Leveling 179 Finished Manhwa 2\nOne Piece 1120 Reading Manga 0"}
              className="flex-1 min-h-0 resize-none bg-input rounded-md p-3 text-sm font-mono outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
            <div className="flex gap-2">
              <button
                onClick={runImport}
                className="flex-1 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                Import
              </button>
              <button
                onClick={() => {
                  setImportText("");
                  setImportMsg(null);
                }}
                className="h-9 px-3 rounded-md bg-secondary text-secondary-foreground text-sm hover:opacity-90"
              >
                Clear
              </button>
            </div>
            {importMsg && (
              <div className="text-xs space-y-1 max-h-24 overflow-auto">
                {importMsg.ok > 0 && (
                  <div className="text-accent">Added {importMsg.ok} entries.</div>
                )}
                {importMsg.errors.map((e, i) => (
                  <div key={i} className="text-destructive">
                    {e}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border p-4 flex gap-2">
            <button
              onClick={saveTxt}
              className="flex-1 h-9 rounded-md bg-accent text-accent-foreground text-sm font-medium hover:opacity-90"
            >
              Save .txt
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 h-9 rounded-md border border-border text-sm hover:bg-muted"
            >
              Load .txt
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={loadTxt}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}

function SearchDialog({
  onAdd,
  onAddManual,
  onClose,
}: {
  onAdd: (result: SearchResult) => Promise<boolean>;
  onAddManual: (title: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [addingId, setAddingId] = useState<number | string | null>(null);
  const [addingManual, setAddingManual] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setStatus("loading");
    const timer = setTimeout(() => {
      // AniList first (it's the primary, fastest-to-respond source and
      // supports request cancellation), then fold in MyAnimeList/Kitsu
      // results as they arrive so the list doesn't wait on the slowest
      // provider before showing anything.
      searchAniList(q, controller.signal)
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setStatus("idle");
        })
        .catch((err) => {
          if (cancelled || (err as Error).name === "AbortError") return;
          setStatus("error");
        });
      searchAllTrackers(q)
        .then((extra) => {
          if (cancelled || !extra.length) return;
          setResults((prev) => [...prev, ...extra]);
          setStatus("idle");
        })
        .catch(() => {
          /* extra providers are best-effort; AniList result (or its own error) still stands */
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleAdd = async (result: SearchResult) => {
    setAddingId(result.id);
    const ok = await onAdd(result);
    setAddingId(null);
    if (ok) onClose();
  };

  // Lets the user add whatever they typed even when AniList/MAL/Kitsu
  // don't have it (obscure, very new, or fan-translated-only titles).
  // Passing "" (empty query) falls through to the same auto-generated
  // "New title" placeholder the old blank-add button used to create.
  const handleAddManual = async () => {
    setAddingManual(true);
    const ok = await onAddManual(query.trim());
    setAddingManual(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4">
      <div className="w-full max-w-md max-h-[85dvh] flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Search & add a title</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search manga, manhwa, manhua…"
          className="h-10 px-3 rounded-md bg-input text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground -mt-1">
          Powered by AniList, MyAnimeList &amp; Kitsu.
        </p>
        <div className="flex-1 overflow-y-auto scroll-touch -mx-1 px-1 space-y-2">
          {status === "loading" && (
            <p className="text-xs text-muted-foreground px-1 py-6 text-center">Searching…</p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive px-1 py-6 text-center">
              Couldn't reach the search service. Try again in a moment.
            </p>
          )}
          {status === "idle" && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-xs text-muted-foreground px-1 py-6 text-center">No matches.</p>
          )}
          {results.map((r) => (
            <div
              key={`${r.source ?? "anilist"}-${r.id}`}
              className="flex items-center gap-3 rounded-md border border-border p-2 hover:bg-muted/40"
            >
              {r.coverUrl ? (
                <img
                  src={r.coverUrl}
                  alt=""
                  className="h-28 w-20 shrink-0 rounded-md object-cover bg-muted"
                />
              ) : (
                <div className="h-28 w-20 shrink-0 rounded-md bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{r.title}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {r.type}
                  {r.author ? ` · ${r.author}` : ""}
                  {typeof r.totalChapters === "number" ? ` · ${r.totalChapters} ch.` : ""}
                  {r.source ? ` · ${r.source}` : ""}
                </div>
              </div>
              <button
                onClick={() => void handleAdd(r)}
                disabled={addingId === r.id}
                className="shrink-0 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
              >
                {addingId === r.id ? "Adding…" : "Add"}
              </button>
            </div>
          ))}
        </div>
        <div className="pt-2 border-t border-border">
          <button
            type="button"
            onClick={() => void handleAddManual()}
            disabled={addingManual}
            className="w-full h-9 rounded-md border border-dashed border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            {addingManual
              ? "Adding…"
              : query.trim()
                ? `Can't find it? Add "${query.trim()}" anyway`
                : "Can't find it? Add a title manually"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChapterProgress({ chapter, total }: { chapter: number; total: number | null | undefined }) {
  if (!total || total <= 0) {
    // No known total (never enriched, or the source had no chapter count) —
    // show the chapter count on its own instead of rendering nothing.
    return (
      <div className="text-[10px] text-muted-foreground tabular-nums">
        Ch. {chapter} · total chapters unknown
      </div>
    );
  }
  const pct = Math.min(100, Math.round((chapter / total) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {chapter}/{total} · {pct}%
      </span>
    </div>
  );
}

const STAT_CARD_ACCENTS = {
  primary: {
    card: "border-primary/25 bg-primary/8",
    badge: "bg-primary/20 text-primary",
    value: "text-primary",
  },
  finished: {
    card: "border-finished/25 bg-finished/8",
    badge: "bg-finished/20 text-finished",
    value: "text-finished",
  },
  ongoing: {
    card: "border-ongoing/25 bg-ongoing/8",
    badge: "bg-ongoing/20 text-ongoing",
    value: "text-ongoing",
  },
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  accent = "primary",
}: {
  icon: typeof BookOpen;
  label: string;
  value: string | number;
  accent?: keyof typeof STAT_CARD_ACCENTS;
}) {
  const colors = STAT_CARD_ACCENTS[accent];
  return (
    <div className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl border shrink-0 ${colors.card}`}>
      <div className={`h-8 w-8 rounded-full grid place-items-center shrink-0 ${colors.badge}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className={`text-lg font-bold tabular-nums ${colors.value}`}>{value}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">
          {label}
        </span>
      </div>
    </div>
  );
}

function ProfileDialog({
  userId,
  email,
  onClose,
}: {
  userId: string;
  email: string;
  onClose: () => void;
}) {
  const [username, setUsername] = useState("");
  const [newEmail, setNewEmail] = useState(email);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();
      if (!active) return;
      setUsername(data?.username ?? "");
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const notes: string[] = [];
    try {
      const uname = username.trim();
      if (uname.length > 40) throw new Error("Username must be 40 characters or fewer.");
      const { error: pErr } = await supabase
        .from("profiles")
        .upsert({ id: userId, username: uname || null }, { onConflict: "id" });
      if (pErr)
        throw new Error(
          pErr.code === "23505" ? "That username is already taken." : pErr.message,
        );
      notes.push("Profile saved.");

      const trimmedEmail = newEmail.trim();
      if (trimmedEmail && trimmedEmail !== email) {
        const { error } = await supabase.auth.updateUser(
          { email: trimmedEmail },
          { emailRedirectTo: window.location.origin },
        );
        if (error) throw error;
        notes.push("Check your new email to confirm the change.");
      }

      if (password) {
        if (password.length < 6) throw new Error("Password must be at least 6 characters.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        notes.push("Password updated.");
      }
      setMsg({ text: notes.join(" ") });
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4">
      <form
        onSubmit={save}
        className="w-full max-w-sm flex flex-col gap-4 rounded-2xl border border-border/80 bg-card shadow-2xl shadow-black/10 p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/30 grid place-items-center">
              <User className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-base font-semibold">Your profile</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="h-8 w-8 grid place-items-center rounded-lg border border-border hover:bg-secondary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Username</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              maxLength={40}
              placeholder={loading ? "Loading…" : "your name"}
              className="w-full h-11 pl-10 pr-3 rounded-lg bg-input text-sm outline-none border border-transparent focus:border-primary/50 focus:ring-2 focus:ring-ring/40 transition-all"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full h-11 pl-10 pr-3 rounded-lg bg-input text-sm outline-none border border-transparent focus:border-primary/50 focus:ring-2 focus:ring-ring/40 transition-all"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">New password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              className="w-full h-11 pl-10 pr-10 rounded-lg bg-input text-sm outline-none border border-transparent focus:border-primary/50 focus:ring-2 focus:ring-ring/40 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy || loading}
          className="h-11 mt-1 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-[0.99] disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save changes"
          )}
        </button>
        {msg && (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
              msg.error
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-finished/30 bg-finished/10 text-finished"
            }`}
          >
            {msg.error ? (
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            )}
            <span>{msg.text}</span>
          </div>
        )}
      </form>
    </div>
  );
}

function SortTh({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  className,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  className?: string;
  align?: "right";
}) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === "asc" ? "▲" : "▼") : "";
  return (
    <th className={`font-medium ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground transition ${
          align === "right" ? "justify-end w-full" : ""
        } ${active ? "text-foreground" : ""}`}
      >
        <span>{label}</span>
        <span className="text-[9px] w-2">{arrow}</span>
      </button>
    </th>
  );
}

function statusColorClasses(status: EntryStatus) {
  return status === "Reading"
    ? "text-ongoing"
    : status === "Dropped"
      ? "text-dropped"
      : status === "Cancelled"
        ? "text-muted-foreground"
        : "text-finished";
}

function statusRowBorder(status: EntryStatus) {
  return status === "Reading"
    ? "border-l-2 border-l-ongoing"
    : status === "Dropped"
      ? "border-l-2 border-l-dropped"
      : status === "Cancelled"
        ? "border-l-2 border-l-muted-foreground/50"
        : "border-l-2 border-l-finished";
}

function statusBadgeClasses(status: EntryStatus) {
  return status === "Reading"
    ? "bg-ongoing/12 text-ongoing"
    : status === "Dropped"
      ? "bg-dropped/12 text-dropped"
      : status === "Cancelled"
        ? "bg-cancelled/15 text-muted-foreground"
        : "bg-finished/12 text-finished";
}

function StatusPill({ status, count }: { status: EntryStatus; count: number }) {
  const bg =
    status === "Reading"
      ? "bg-ongoing/12 border-ongoing/30"
      : status === "Dropped"
        ? "bg-dropped/12 border-dropped/30"
        : status === "Cancelled"
          ? "bg-cancelled/20 border-border"
          : "bg-finished/12 border-finished/30";
  return (
    <span
      className={`px-2.5 py-1 rounded-full font-semibold border whitespace-nowrap text-xs shrink-0 ${bg} ${statusColorClasses(status)}`}
    >
      {count} {status}
    </span>
  );
}
