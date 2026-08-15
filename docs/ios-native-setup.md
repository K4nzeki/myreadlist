# iOS native project setup

This has to be run locally (macOS + Xcode) — this sandbox has no network access
and can't install CocoaPods/Xcode, so the `ios/` folder isn't generated yet.

## 0. Architecture: bundled, not a remote web wrapper

The native app now bundles its own built assets (`capacitor-dist/`, produced
by `npm run cap:sync`) instead of pointing the WKWebView at the live
`myreadlist.lovable.app` site. See the comment at the top of
`capacitor.config.ts` for the full reasoning — short version: nothing in the
app's actual functionality depends on a live server (every read/write goes
straight from the device to Supabase), so there's no reason for the native
app to depend on one either, and doing so is one of the more common reasons
Apple flags an app under Guideline 4.2 ("web sites bundled as apps").

**This needs to be verified locally before you trust it**, since it
couldn't be built/run in the sandbox that made this change:

```sh
npm install
npm run cap:sync   # build -> stage into capacitor-dist/ -> cap sync
```

`scripts/prepare-capacitor-dist.mjs` looks in a few common TanStack
Start/Nitro output locations (`.output/public`, `dist/client`, etc.) and
copies whichever one actually has your build in it into `capacitor-dist/`.
If it can't find any of them, it fails loudly rather than shipping a stale
or empty bundle — if that happens, check where `npm run build` actually put
your client assets and add that path to `CANDIDATES` in that script.

After this, open the app in Xcode/Simulator and confirm sign-in, adding a
title, and navigating between tabs all still work fully offline-of-launch
(i.e. without hitting `myreadlist.lovable.app` at all — only Supabase calls
should appear in a network inspector).

## 1. Install dependencies and generate the native project

```sh
npm install
npx cap add ios
npx cap sync ios
```

`cap sync` pulls in the Capacitor plugins added in this pass (status bar,
splash screen, app, share, browser, haptics, keyboard) as CocoaPods,
including the privacy manifests (`PrivacyInfo.xcprivacy`) those plugins
ship with — you don't need to write one by hand unless you add further
third-party SDKs later.

## 2. Set a unique bundle ID before your first submission

In `capacitor.config.ts`, `appId` is currently `com.myreadlist.panels` — this
becomes your permanent bundle identifier and **cannot be changed after your
first App Store submission**. Change it now if you want something else,
then re-run `npx cap sync ios`.

## 3. Open the workspace and configure signing

```sh
npx cap open ios
```

In Xcode:
- **Signing & Capabilities** → select your Apple Developer team, let Xcode
  manage signing.
- **General** → Bundle Identifier should match `appId` above.
- **App Icons** → the existing `public/icon-*.png` assets are sized for the
  web manifest, not Apple's icon set, and `icon-512.png`/
  `apple-touch-icon.png` currently have an alpha channel. Apple's 1024×1024
  App Store icon must be fully opaque — flatten to an opaque background
  when you run them through an icon generator (e.g. `appicon.co`) into
  `Assets.xcassets/AppIcon.appiconset`, or App Store Connect will reject
  the binary at upload.
- **Launch Screen** → set the background to `#fdfcfa` to match
  `capacitor.config.ts`/`manifest.webmanifest` so there's no color flash on
  launch.

## 4. Things already handled in the app code (this pass)

- Status bar style, splash-screen hide, keyboard resize (inputs stay above
  the keyboard instead of being covered by it), and Android back-button
  handling — `src/lib/native.ts`, wired in `__root.tsx`.
- Light/success/warning haptic feedback on chapter bumps, finishing a
  title, deleting a title/account, and drag-reorder — same file, wired
  into the relevant actions in `routes/index.tsx`.
- Native share sheet for sharing a public list link — `ProfileDialog`.
- External links (e.g. AniList) and the report-abuse mailto link open in
  the system browser/mail app, not the app's own WebView.
- The PWA install banner and service worker are both disabled on native —
  they're web-only concerns and would be confusing/redundant inside the
  real app.
- In-app account deletion — Profile → Delete account.
- Privacy Policy and Terms pages at `/privacy` and `/terms`, linked from
  sign-up and the profile dialog, including a "Report" link on public list
  pages and a reserved-username blocklist for basic impersonation
  protection.

## 5. Known issue to fix before submitting: drag-to-reorder doesn't work on touch

The list-reorder feature (`draggable` + `onDragStart`/`onDragEnd` in
`routes/index.tsx`) uses the HTML5 drag-and-drop API, which is mouse-only —
it does not respond to touch at all. On a real iPhone/iPad, dragging a row
will silently do nothing. This wasn't in scope to rebuild in this pass (it
needs a touch-capable interaction, e.g. a long-press + pointer-events
implementation or a library like `@dnd-kit/core` with its touch sensor),
but it should be fixed or the reorder handle should be hidden on
touch/native before submission — a control that visibly does nothing is
exactly the kind of thing Apple's "app completeness" review looks for.

## 6. App Store Connect metadata

- **Privacy Policy URL**: `https://myreadlist.lovable.app/privacy`
- **App Privacy questionnaire**: this app collects an email address and a
  user ID, both linked to the user's identity, used for App Functionality
  (account + sync) — no analytics or advertising data is collected. Title
  searches are sent directly from the device to third-party catalog APIs
  (MyAnimeList/Jikan, Kitsu); disclose those as linked-out third-party
  processing if the questionnaire asks.
- Before archiving, double-check `SUPPORT_EMAIL` in `src/routes/shared.ts`
  has been replaced with a real, monitored address — reviewers do check
  this link, and it's also now used for the public-profile "Report" link.

## 7. Before you hit submit

- Test the whole flow once in the native build: sign up, add a title,
  bump a chapter (feel for the haptic tick), finish a title (haptic
  success), share a list link (confirm the native share sheet appears),
  tap the AniList link (confirm it opens in Safari, not inside the app),
  delete a throwaway test account.
- Confirm the app works with airplane mode toggled on right after launch,
  then off — since it no longer depends on `myreadlist.lovable.app`, the
  shell should load instantly either way; only the Supabase-backed data
  should be affected by connectivity.
- Take fresh App Store screenshots from the native build, not the website —
  reviewers compare what they see running to what's in the screenshots.
