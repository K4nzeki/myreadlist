# iOS native project setup

This has to be run locally (macOS + Xcode) — this sandbox has no network access
and can't install CocoaPods/Xcode, so the `ios/` folder isn't generated yet.

## 1. Install dependencies and generate the native project

```sh
npm install
npx cap add ios
npx cap sync ios
```

`cap sync` pulls in the Capacitor plugins added in this pass (status bar,
splash screen, app, share, browser) as CocoaPods, including the privacy
manifests (`PrivacyInfo.xcprivacy`) those plugins ship with — you don't need
to write one by hand unless you add further third-party SDKs later.

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
  web manifest, not Apple's icon set. Run them through an icon generator
  (e.g. `appicon.co`) into `Assets.xcassets/AppIcon.appiconset`.
- **Launch Screen** → set the background to `#fdfcfa` to match
  `capacitor.config.ts`/`manifest.webmanifest` so there's no color flash on
  launch.

## 4. Things already handled in the app code (this pass)

- Status bar style, splash-screen hide, and Android back-button handling —
  `src/lib/native.ts`, wired in `__root.tsx`.
- Native share sheet for sharing a public list link — `ProfileDialog`.
- External links (e.g. AniList) open in the system browser, not the app's
  own WebView.
- The PWA install banner and service worker are both disabled on native —
  they're web-only concerns and would be confusing/redundant inside the
  real app.
- In-app account deletion — Profile → Delete account.
- Privacy Policy and Terms pages at `/privacy` and `/terms`, linked from
  sign-up and the profile dialog.

## 5. App Store Connect metadata

- **Privacy Policy URL**: `https://myreadlist.lovable.app/privacy`
- **App Privacy questionnaire**: this app collects an email address and a
  user ID, both linked to the user's identity, used for App Functionality
  (account + sync) — no analytics or advertising data is collected. Title
  searches are sent directly from the device to third-party catalog APIs
  (MyAnimeList/Jikan, Kitsu); disclose those as linked-out third-party
  processing if the questionnaire asks.
- Before archiving, double-check `src/lib/native.ts`'s `CONTACT_EMAIL`
  placeholder in `privacy.tsx`/`terms.tsx` has been replaced with a real,
  monitored address — reviewers do check that link.

## 6. Before you hit submit

- Test the whole flow once in the native build: sign up, add an entry,
  share a list link (confirm the native share sheet appears), tap the
  AniList link (confirm it opens in Safari, not inside the app), delete a
  throwaway test account.
- Take fresh App Store screenshots from the native build, not the website —
  reviewers compare what they see running to what's in the screenshots.
# iOS native project setup

This has to be run locally (macOS + Xcode) — this sandbox has no network access
and can't install CocoaPods/Xcode, so the `ios/` folder isn't generated yet.

## 1. Install dependencies and generate the native project

```sh
npm install
npx cap add ios
npx cap sync ios
```

`cap sync` pulls in the Capacitor plugins added in this pass (status bar,
splash screen, app, share, browser) as CocoaPods, including the privacy
manifests (`PrivacyInfo.xcprivacy`) those plugins ship with — you don't need
to write one by hand unless you add further third-party SDKs later.

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
  web manifest, not Apple's icon set. Run them through an icon generator
  (e.g. `appicon.co`) into `Assets.xcassets/AppIcon.appiconset`.
- **Launch Screen** → set the background to `#fdfcfa` to match
  `capacitor.config.ts`/`manifest.webmanifest` so there's no color flash on
  launch.

## 4. Things already handled in the app code (this pass)

- Status bar style, splash-screen hide, and Android back-button handling —
  `src/lib/native.ts`, wired in `__root.tsx`.
- Native share sheet for sharing a public list link — `ProfileDialog`.
- External links (e.g. AniList) open in the system browser, not the app's
  own WebView.
- The PWA install banner and service worker are both disabled on native —
  they're web-only concerns and would be confusing/redundant inside the
  real app.
- In-app account deletion — Profile → Delete account.
- Privacy Policy and Terms pages at `/privacy` and `/terms`, linked from
  sign-up and the profile dialog.

## 5. App Store Connect metadata

- **Privacy Policy URL**: `https://myreadlist.lovable.app/privacy`
- **App Privacy questionnaire**: this app collects an email address and a
  user ID, both linked to the user's identity, used for App Functionality
  (account + sync) — no analytics or advertising data is collected. Title
  searches are sent directly from the device to third-party catalog APIs
  (MyAnimeList/Jikan, Kitsu); disclose those as linked-out third-party
  processing if the questionnaire asks.
- Before archiving, double-check `src/lib/native.ts`'s `CONTACT_EMAIL`
  placeholder in `privacy.tsx`/`terms.tsx` has been replaced with a real,
  monitored address — reviewers do check that link.

## 6. Before you hit submit

- Test the whole flow once in the native build: sign up, add an entry,
  share a list link (confirm the native share sheet appears), tap the
  AniList link (confirm it opens in Safari, not inside the app), delete a
  throwaway test account.
- Take fresh App Store screenshots from the native build, not the website —
  reviewers compare what they see running to what's in the screenshots.
