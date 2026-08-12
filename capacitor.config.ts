import type { CapacitorConfig } from "@capacitor/cli";

// This wraps the LIVE website in a native app shell — it does not bundle a
// static copy of the site. The website keeps deploying and updating exactly
// as it does today; the native app just loads it, the same way a browser
// tab would, but with a real app icon, splash screen, and no browser UI.
//
// Change `appId` to your own reverse-domain identifier before submitting
// (e.g. com.yourcompany.panels) — it must be unique per store account and
// cannot be changed after your first submission.
const config: CapacitorConfig = {
  appId: "com.myreadlist.panels",
  appName: "Panels",
  webDir: "dist", // unused in server mode below, but required by the CLI
  server: {
    // Points the native app at your production site instead of bundling
    // static files. Requires HTTPS (already true for your deployment) and
    // an internet connection to load, same as visiting the site normally.
    url: "https://myreadlist.lovable.app",
    cleartext: false,
  },
  backgroundColor: "#fdfcfa", // matches manifest.webmanifest background_color
  ios: {
    contentInset: "automatic",
  },
  android: {
    backgroundColor: "#fdfcfa",
  },
};

export default config;
