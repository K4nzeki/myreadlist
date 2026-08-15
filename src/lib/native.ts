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

  const [{ StatusBar, Style }, { SplashScreen }, { App }, { Keyboard, KeyboardResize }] = await Promise.all([
    import("@capacitor/status-bar"),
    import("@capacitor/splash-screen"),
    import("@capacitor/app"),
    import("@capacitor/keyboard"),
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

  try {
    // "native" resizes the WebView itself when the keyboard opens, so
    // focused inputs (sign-up form, search dialog, add-title dialog) stay
    // above the keyboard instead of being covered by it — without this the
    // whole app reads as a website that never learned iOS has a keyboard.
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
  } catch {
    // Not available on this platform/version — inputs still work, just
    // without the resize behavior.
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

/**
 * Light haptic feedback for frequent, low-stakes interactions — bumping a
 * chapter, dropping a reordered row, toggling a filter. No-op on web (there
 * is no Taptic Engine to fall back to, and vibrating a laptop isn't a thing).
 */
export async function hapticTick() {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // Best-effort only — never block the interaction it's attached to.
  }
}

/**
 * Success notification haptic — finishing a title, completing an import.
 */
export async function hapticSuccess() {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // Best-effort only.
  }
}

/**
 * Warning haptic for destructive actions — deleting a title, deleting the
 * account — paired with the existing confirmation UI, not a replacement
 * for it.
 */
export async function hapticWarning() {
  if (!isNative()) return;
  try {
    const { Haptics, NotificationType } = await import("@capacitor/haptics");
    await Haptics.notification({ type: NotificationType.Warning });
  } catch {
    // Best-effort only.
  }
}
