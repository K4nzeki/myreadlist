import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Local storage key used to remember a user's "not now" dismissal so the
// banner doesn't nag them on every visit.
const DISMISS_KEY = "panels-install-prompt-dismissed-at";
// If dismissed, wait this long before showing it again.
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
// Don't show it the instant someone lands on the page — wait until they've
// looked around a bit, so it feels like a helpful nudge, not a popup ad.
const SHOW_DELAY_MS = 15_000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own flag for "launched from home screen".
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function wasRecentlyDismissed() {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const dismissedAt = Number(raw);
  if (Number.isNaN(dismissedAt)) return false;
  return Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
}

/**
 * A custom "install this app" banner. Purely additive progressive
 * enhancement — renders nothing for users who already have it installed,
 * who recently dismissed it, or (server-side) during SSR.
 *
 * - Android/Chrome/Edge: captures the native `beforeinstallprompt` event and
 *   offers a one-tap install button.
 * - iOS Safari: there is no programmatic install API, so we show the
 *   "Share -> Add to Home Screen" instructions instead.
 */
export default function InstallAppPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // iOS never fires beforeinstallprompt, so use the delay + user-agent
    // check instead to decide whether to show the manual instructions.
    if (isIos()) {
      timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    }

    // If the app gets installed through any path, hide the banner.
    const handleInstalled = () => setVisible(false);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
    setShowIosSteps(false);
  };

  const handleInstallClick = async () => {
    if (isIos()) {
      setShowIosSteps(true);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    } else {
      dismiss();
    }
    setDeferredPrompt(null);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Panels app"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-sm items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4"
    >
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Download className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        {!showIosSteps ? (
          <>
            <p className="text-sm font-medium text-card-foreground">Install Panels</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Add it to your home screen for a faster, full-screen experience.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleInstallClick}>
                Install
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Not now
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-card-foreground">Install on iPhone/iPad</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              Tap <Share className="h-3.5 w-3.5" /> Share, then "Add to Home Screen".
            </p>
            <div className="mt-3">
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Got it
              </Button>
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
