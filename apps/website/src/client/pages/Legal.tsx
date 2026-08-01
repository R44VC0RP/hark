import { Link } from "react-router";

const updated = "July 26, 2026";

function LegalLayout({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header>
        <div className="mx-auto flex h-20 w-full max-w-3xl items-center justify-between px-6">
          <Link to="/" className="text-lg font-semibold">
            Hark
          </Link>
          <nav className="flex items-center gap-4 text-sm text-ink-subtle" aria-label="Primary">
            <Link className="transition hover:text-ink" to="/docs">
              Docs
            </Link>
            <Link className="transition hover:text-ink" to="/">
              Home
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <p className="text-accent-text mb-3 text-xs font-medium uppercase">{eyebrow}</p>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-ink-faint">Last updated {updated}</p>
        <div className="legal-copy mt-10 max-w-2xl space-y-8 text-sm leading-relaxed text-ink-muted">
          {children}
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Privacy() {
  return (
    <LegalLayout eyebrow="Legal" title="Privacy Policy">
      <Section title="Overview">
        <p>
          Hark is operated by Ryan Vogel. This policy explains the information Hark processes to
          deliver webhook notifications through the website and iOS app. Hark does not sell personal
          information or use it for targeted advertising.
        </p>
      </Section>

      <Section title="Information we process">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Your Google or Apple account identifier, name, email address, and profile image when
            provided by the sign-in service. Apple may provide a private relay email address.
          </li>
          <li>
            Encrypted Apple refresh tokens used only to revoke Sign in with Apple authorization when
            you delete your account.
          </li>
          <li>
            Service settings you create, including titles, image URLs, destination URLs, secret
            webhook-token hashes, and encrypted webhook tokens.
          </li>
          <li>
            Webhook content such as notification titles, bodies, images, destinations, idempotency
            keys, timestamps, and delivery results.
          </li>
          <li>
            Device information needed for delivery, including Expo and APNs push tokens, device
            name, platform, and last registration time.
          </li>
          <li>
            Agent access-token names, scopes, identifying prefixes, hashes, expiry and usage times.
            Plaintext agent tokens are shown once and are not stored by Hark.
          </li>
          <li>
            Approval and reply prompts, choices, expiry, response text or decision, requesting token
            identity, responding device, and response timestamps.
          </li>
          <li>
            Live Activity task titles, status text, optional detail and progress, expiry and update
            history, requesting token identity, and encrypted ActivityKit delivery tokens. Private
            mode replaces task content with generic text on the Lock Screen but does not remove the
            task content from Hark's encrypted network and account-scoped processing.
          </li>
          <li>
            Subscription status and billing identifiers when you choose a paid plan. Payment-card
            details are collected and handled by Stripe, not stored by Hark.
          </li>
          <li>Limited technical logs used to secure, operate, and troubleshoot the service.</li>
          <li>
            Product analytics such as page and app-screen visits, feature lifecycle events,
            first-touch campaign labels, referring and outbound hostnames, app version, coarse
            outcomes, and related account, service, device, anonymous-install, or session
            identifiers. Hark never puts notification content, prompts, replies, tokens, full URLs,
            IP addresses, email addresses, or user-agent strings in analytics.
          </li>
        </ul>
      </Section>

      <Section title="How we use information">
        <p>
          We use this information to authenticate your account, create and secure webhook endpoints,
          deliver notifications, show delivery activity, prevent duplicate or abusive requests,
          deliver requested interactions and return your response to the authorized agent, start and
          update Live Activities you authorize, provide support, and maintain the reliability and
          security of Hark.
        </p>
      </Section>

      <Section title="Service providers">
        <p>
          Hark relies on Google and Apple for authentication, Expo and Apple for push delivery and
          app distribution, Autumn and Stripe for optional web billing, and hosting infrastructure
          for the website, API, and database. These providers process information only as needed to
          provide their services and under their own privacy terms.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          We retain account and service data while your account is active and retain recent webhook
          activity for product operation and troubleshooting. You can permanently delete your
          account inside the Hark app. Deletion removes your services, devices, and activity from
          the active database. For accounts using Apple, Hark first asks Apple to revoke stored
          authorization grants; deletion stops and reports an error if that revocation cannot be
          confirmed. Limited backup copies may remain temporarily until rotated.
        </p>
      </Section>

      <Section title="Security and your choices">
        <p>
          Webhook URLs contain secret tokens and should be treated like passwords. You can rotate a
          webhook token or revoke a scoped agent token from the dashboard if it is exposed. Device
          responses require the signed-in account and a registered device identity. Hark uses access
          controls and encrypted network connections, but no online service can guarantee absolute
          security.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Hark is not directed to children under 13, and we do not knowingly collect personal
          information from children under 13.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions or privacy requests can be sent to{" "}
          <a
            className="text-accent-text underline underline-offset-2"
            href="mailto:ryan@mandarin3d.com"
          >
            ryan@mandarin3d.com
          </a>
          .
        </p>
      </Section>
    </LegalLayout>
  );
}

export function Terms() {
  return (
    <LegalLayout eyebrow="Legal" title="Terms of Service">
      <Section title="Agreement">
        <p>
          By using Hark, you agree to these terms. If you do not agree, do not use the service. You
          must be legally able to form a binding agreement and provide accurate account information.
        </p>
      </Section>

      <Section title="The service">
        <p>
          Hark provides private webhook endpoints that convert submitted data into push
          notifications on registered devices. Features may change as the service develops, and beta
          or preview features may be modified or removed without notice.
        </p>
      </Section>

      <Section title="Agent interactions">
        <p>
          Scoped agent tokens may create approval or reply requests for your own registered devices.
          You are responsible for deciding what authority an agent receives and for reviewing
          prompts before responding. Hark does not guarantee that a push is delivered, seen, or
          answered, and callers must treat canceled, expired, denied, and missing responses safely.
        </p>
      </Section>

      <Section title="Your account and webhook secrets">
        <p>
          You are responsible for activity under your account and for keeping webhook URLs and
          account access secure. Agent API tokens are also credentials; grant only needed scopes,
          configure an expiry where practical, and revoke affected tokens if exposed.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Do not use Hark to violate law, infringe rights, distribute malware, harass others,
          attempt unauthorized access, overload the service, evade rate limits, or send content you
          do not have permission to process. We may suspend abusive or harmful activity.
        </p>
      </Section>

      <Section title="Your content">
        <p>
          You retain ownership of content you submit. You grant Hark permission to process that
          content only as needed to operate the service. You are responsible for ensuring your
          webhook content, images, and destination links are lawful and appropriately licensed.
        </p>
      </Section>

      <Section title="Paid plans">
        <p>
          Hark Pro is an optional subscription purchased on the Hark website and billed in advance
          through Autumn and Stripe. The current price and billing interval are shown before
          checkout. Subscriptions renew automatically until canceled. You can manage or cancel a
          subscription from the web dashboard; cancellation takes effect at the end of the current
          paid period unless stated otherwise. Fees are non-refundable except where required by law.
          We may change future pricing with advance notice, but changes do not apply retroactively
          to an already-paid period.
        </p>
      </Section>

      <Section title="Third-party services">
        <p>
          Hark depends on services provided by Google, Expo, Apple, Autumn, Stripe, and hosting
          providers. Their availability and terms are outside Hark's control, and integrations may
          stop working if those services change.
        </p>
      </Section>

      <Section title="Availability and warranties">
        <p>
          Hark is provided “as is” and “as available.” Push delivery is not guaranteed, may be
          delayed or duplicated, and can be affected by device settings and third-party services. To
          the extent permitted by law, Hark disclaims implied warranties and is not liable for
          indirect, incidental, special, or consequential damages.
        </p>
      </Section>

      <Section title="Termination and changes">
        <p>
          You may stop using Hark or delete your account at any time. We may suspend access for
          violations, security risks, or service discontinuation. We may update these terms and will
          post the updated date on this page.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms can be sent to{" "}
          <a
            className="text-accent-text underline underline-offset-2"
            href="mailto:ryan@mandarin3d.com"
          >
            ryan@mandarin3d.com
          </a>
          .
        </p>
      </Section>
    </LegalLayout>
  );
}
