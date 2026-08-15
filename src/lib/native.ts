// Native-shell glue. Everything here is a no-op on the web — it only does
// anything when running inside the Capacitor-wrapped iOS/Android app, so the
// website itself is completely unaffected.
import { Capacitor } from "@capacitor/core";

export const isNative = () => Capacitor.isNativePlatform();

/**
 * Call once, as early as possible on the client. Sets up status bar
 * styling, hides the launch splash screen once the app shell has painted,
 * and makes Android's hardware back button behave like a browser "back"
 * instead of exiting the app from any screen.
 */
export async function initNativeShell() {
  if (!isNative()) return;

  const [{ StatusBar, Style }, { SplashScreen }, { App }] = await Promise.all([
    import("@capacitor/status-bar"),
    import("@capacitor/splash-screen"),
    import("@capacitor/app"),
  ]);

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#fdfcfa" });
    }
  } catch {
    // Some platforms/devices don't support every StatusBar call — never
    // block app startup on this.
  }

  // Give the shell a moment to hydrate before dropping the splash screen so
  // users don't see a flash of an empty page underneath it.
  window.setTimeout(() => {
    SplashScreen.hide().catch(() => {});
  }, 250);

  App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  }).catch(() => {});
}

/**
 * Shares a link using the native share sheet on iOS/Android, falling back
 * to the Web Share API, then to clipboard-copy on platforms/browsers that
 * support neither.
 */
export async function shareLink(opts: { title: string; text?: string; url: string }) {
  if (isNative()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share(opts);
      return "shared" as const;
    } catch {
      // User cancelled the native share sheet, or the plugin errored —
      // either way don't fall through to a clipboard copy that would
      // surprise them.
      return "cancelled" as const;
    }
  }
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share(opts);
      return "shared" as const;
    } catch {
      return "cancelled" as const;
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(opts.url);
    return "copied" as const;
  }
  return "unsupported" as const;
}

/**
 * Opens a URL:
 * - Native app: the in-app native browser (SFSafariViewController /
 *   Chrome Custom Tabs), so external sites never load inside the app's own
 *   WKWebView.
 * - Web: a normal new tab, same as a plain <a target="_blank"> would do.
 */
export async function openExternal(url: string) {
  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch {
      // Fall through to the web behavior if the plugin isn't available.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
