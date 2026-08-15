import type { CapacitorConfig } from "@capacitor/cli";

// ARCHITECTURE DECISION (App Store review): this app is built with
// TanStack Start, but nothing in the actual app logic depends on its
// server — every read/write goes straight from the device to Supabase
// (protected by RLS), and no route uses a loader or server function. That
// means the "server" here is really just producing static HTML/JS/CSS, so
// there is no technical reason for the native app to depend on a live
// website at all.
//
// Earlier, this pointed at `server.url: "https://myreadlist.lovable.app"`,
// i.e. the native shell was just a browser tab loading the live site. That
// pattern is one of the most common reasons Apple flags an app under
// Guideline 4.2 ("apps that are simply web sites bundled as apps... may be
// rejected") — the reviewer sees a WebView pointed at a URL and nothing
// that couldn't be a bookmark. Bundling the build output into the binary
// instead (what this file now does) means the app ships and runs
// self-contained, works if myreadlist.lovable.app is ever slow/down/moved,
// and reads as an actual app rather than a wrapped tab — while everything
// dynamic (your account, your list, sync) still works exactly the same,
// since that was never server-dependent in the first place.
//
// `webDir` below points at `capacitor-dist/`, produced by
// `npm run cap:sync` (build -> scripts/prepare-capacitor-dist.mjs -> cap
// sync). See that script for why it exists instead of pointing straight at
// the raw build output.
//
// Change `appId` to your own reverse-domain identifier before submitting
// (e.g. com.yourcompany.panels) — it must be unique per store account and
// cannot be changed after your first submission.
const config: CapacitorConfig = {
  appId: "com.myreadlist.panels",
  appName: "Panels",
  webDir: "capacitor-dist",
  backgroundColor: "#fdfcfa", // matches manifest.webmanifest background_color
  ios: {
    contentInset: "automatic",
  },
  android: {
    backgroundColor: "#fdfcfa",
  },
};

export default config;
