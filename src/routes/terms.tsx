import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/terms")({
  component: TermsOfService,
  head: () => ({
    meta: [
      { title: "Terms of Service — Panels" },
      { name: "description", content: "The terms that govern your use of Panels." },
    ],
  }),
});

// TODO before submitting to the App Store: replace the placeholders below
// (contact email + "Last updated" date), and have this reviewed if you
// want binding legal terms rather than a plain-language baseline.
const CONTACT_EMAIL = "support@myreadlist.app"; // TODO: replace with your real support address
const LAST_UPDATED = "August 15, 2026"; // TODO: keep in sync with edits to this page

function TermsOfService() {
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

        <h1 className="text-2xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 flex flex-col gap-6 text-sm leading-relaxed text-foreground/90">
          <p>
            These terms govern your use of Panels (the "app"). By creating an account, you agree
            to them.
          </p>

          <section>
            <h2 className="text-base font-semibold mb-2">Your account</h2>
            <p>
              You're responsible for the activity on your account and for keeping your password
              secure. You must provide a valid email address and are responsible for keeping it
              up to date so you can receive account-related messages (like password resets).
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Acceptable use</h2>
            <p>You agree not to use Panels to:</p>
            <ul className="list-disc pl-5 mt-1.5 flex flex-col gap-1.5">
              <li>Impersonate another person, or use a username that's misleading or abusive.</li>
              <li>Attempt to access another user's account or data.</li>
              <li>Abuse, overload, or interfere with the service (including automated scraping).</li>
              <li>Upload unlawful, harassing, or infringing content into your list entries.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Your content</h2>
            <p>
              You own the reading-list entries, notes, and username you add. If you set a
              username, your list becomes visible on a public page others can view via a share
              link. You can remove any entry, or delete your account entirely, at any time.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Third-party data</h2>
            <p>
              Title search results and cover art come from third-party catalog services
              (MyAnimeList/Jikan, Kitsu). We don't control that data's accuracy or availability.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Termination</h2>
            <p>
              You can delete your account at any time from Profile → Delete account. We may
              suspend or terminate accounts that violate these terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Service "as is"</h2>
            <p>
              Panels is provided as-is, without warranties of any kind. We aren't liable for any
              loss of data or service interruption, to the extent permitted by law.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Changes</h2>
            <p>
              We may update these terms from time to time. Continued use of the app after a
              change means you accept the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">Contact</h2>
            <p>
              Questions about these terms? Reach us at{" "}
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
