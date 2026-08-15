#!/usr/bin/env node
// Stages the static client build into a stable `capacitor-dist/` folder that
// capacitor.config.ts points at, so the native iOS/Android shell bundles
// the app instead of loading it from a remote URL (see the comment in
// capacitor.config.ts for why that matters for App Store review).
//
// Why this script exists instead of pointing webDir straight at the build
// output: TanStack Start's build (via Vinxi/Nitro) can land the client
// assets in different places depending on the configured server preset
// (`.output/public` for most Nitro presets, `dist/client` or `dist` for
// some, `.vinxi/build/client` on older setups). Rather than hard-coding a
// path that might silently be wrong for your exact preset, this checks the
// common locations in order and copies the first one it finds. If none are
// found, it fails loudly instead of shipping an empty/stale app shell.
//
// Run automatically by `npm run cap:sync` (see package.json). Safe to run
// standalone: `node scripts/prepare-capacitor-dist.mjs`.

import { existsSync, cpSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = [
  ".output/public", // most Nitro presets (node-server, etc.)
  "dist/client", // some Vinxi/TanStack Start configurations
  ".vinxi/build/client",
  "dist", // plain Vite/SPA-style output
];

const TARGET = "capacitor-dist";

function looksLikeStaticSite(dir) {
  if (!existsSync(dir)) return false;
  const entries = readdirSync(dir);
  return entries.some((e) => e === "index.html") || entries.length > 0;
}

const found = CANDIDATES.find(looksLikeStaticSite);

if (!found) {
  console.error(
    `\n[prepare-capacitor-dist] Couldn't find a built client bundle in any of: ${CANDIDATES.join(", ")}.\n` +
      `Run "npm run build" first. If your build outputs somewhere else, add that path to\n` +
      `CANDIDATES in scripts/prepare-capacitor-dist.mjs.\n`,
  );
  process.exit(1);
}

rmSync(TARGET, { recursive: true, force: true });
cpSync(found, TARGET, { recursive: true });

console.log(`[prepare-capacitor-dist] Copied ${found} -> ${TARGET}/ for Capacitor.`);
