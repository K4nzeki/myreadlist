import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

// Exported (not the script itself) so THEME_INIT_SCRIPT in
// theme-init-script.ts can stay in sync without duplicating the literal.
// This is a plain string export, so it doesn't trip the "file must only
// export components" Fast Refresh check the way THEME_INIT_SCRIPT did.
export const STORAGE_KEY = "panels-theme";

// Kept in sync with the inline script in __root.tsx (search THEME_INIT_SCRIPT
// there) — that script runs before React hydrates so the correct class is
// already on <html> and there's no light-flash on load.
function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

function applyClass(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Server-rendered default. The blocking inline script has already set the
  // real class on <html> by the time this hydrates, so this only affects
  // which icon the toggle button shows for one frame before the effect
  // below reconciles it — never causes a hydration mismatch since <html>'s
  // class isn't controlled by React.
  const [preference, setPreferenceState] = useState<ThemePreference>("dark");
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? "system";
    setPreferenceState(stored);
    const r = resolve(stored);
    setResolved(r);
    applyClass(r);
  }, []);

  useEffect(() => {
    if (preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolve("system");
      setResolved(r);
      applyClass(r);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    localStorage.setItem(STORAGE_KEY, pref);
    const r = resolve(pref);
    setResolved(r);
    applyClass(r);
  }, []);

  const toggle = useCallback(() => {
    setPreference(resolve(preference) === "dark" ? "light" : "dark");
  }, [preference, setPreference]);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
