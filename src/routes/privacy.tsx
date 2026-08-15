  import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPolicy,
  head: () => ({
    meta: [
      { title: "Privacy Policy — Panels" },
      { name: "description", content: "How Panels collects, uses, and protects your data." },
    ],
  }),
});

// TODO before submitting to the App Store: replace the two placeholders
// below (contact email + "Last updated" date) with real values, and get
// this reviewed if you're not the sole operator of the service. This copy
// intentionally matches what the app actually does — update it here first
// if you change what data you collect.
const CONTACT_EMAIL = "support@myreadlist.app"; // TODO: replace with your real support address
const LAST_UPDATED = "August 15, 2026"; // TODO: keep in sync with edits to this page

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-4 py-10 sm:py-14">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Panels
        </Link>

        <h1 className="text-2xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-foreground/90">
          <p>
            Panels ("we", "our", "the app") is a reading tracker for manga, manhwa, manhua, and
            comics. This page explains what data we collect, why, and the choices you have.
          </p>

          <section>
            <h2 className="text-base font-semibold mb-2">Information we collect</h2>
            <ul className="list-disc pl-5 flex flex-col gap-1.5">
              <li>
                <span className="font-medium">Account information:</span> the email address and
                password you sign up with, and an optional username you choose.
              </li>
              <li>
                <span className="font-medium">Reading list data:</span> titles, types, chapter
                progress, status, and notes you add to your list, plus activity logs (chapters
                read, series completed) used to power your stats.
              </li>
              <li>
                <span className="font-medium">Device/app data:</span> basic error and crash
                information if something goes wrong, so we can fix it. We do not use this to
                build an advertising profile.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">What we don't collect</h2>
            <p>
              We don't request access to your camera, photo library, contacts, or precise
              location, and Panels contains no advertising or third-party analytics/tracking
              SDKs.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">How we use your information</h2>
            <p>
              Your account and reading-list data are used solely to run the app: signing you in,
              syncing your list across your devices, and showing your stats. If you set a
              username, your reading list becomes visible on a public, shareable page at
              <span className="font-mono text-xs mx-1">/u/your-id</span>
              so others can see what you're reading — this is opt-in in the sense that it only
              shows what you've added, and you can remove entries at any time.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Third parties</h2>
            <p>
              When you search for a title to add, your search text is sent directly from your
              device to public catalog APIs (MyAnimeList/Jikan and Kitsu) to find matching
              titles and cover art — the same way it would if you searched those sites directly.
              We don't send your account information (email, password) to them. Your account and
              reading-list data itself is stored with our database provider, Supabase.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Data retention & deletion</h2>
            <p>
              Your data is kept for as long as your account exists. You can permanently delete
              your account and all associated data at any time from Profile → Delete account
              inside the app. This is immediate and cannot be undone.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Security</h2>
            <p>
              Passwords are never stored in plain text. Access to your reading list data is
              restricted at the database level so only you (or, for public list pages, read-only
              access to what you've chosen to make visible) can reach it.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Children's privacy</h2>
            <p>
              Panels is not directed at children under 13, and we do not knowingly collect
              information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Changes to this policy</h2>
            <p>
              If we materially change what we collect or how we use it, we'll update this page
              and change the "Last updated" date above.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Contact</h2>
            <p>
              Questions about this policy or your data? Reach us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-2">
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
