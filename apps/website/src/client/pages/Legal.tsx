import { PAGE_COLUMN, SiteFooter, SiteHeader } from "../components/SiteChrome";

const updated = "October 28, 2026";

const SUPPORT_EMAIL = "support@hark.fyi";

function SupportLink() {
  return (
    <a className="hark-link" href={`mailto:${SUPPORT_EMAIL}`}>
      {SUPPORT_EMAIL}
    </a>
  );
}

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className={`${PAGE_COLUMN} flex-1 pt-7 pb-16 sm:pt-10`}>
        <h1 className="text-[clamp(32px,5vw,44px)] leading-[1.1] font-medium tracking-[-0.02em] text-white">
          {title}
        </h1>
        <p className="mt-3 text-sm text-ink-faint">Last updated {updated}</p>
        <div className="mt-8 max-w-[40rem] space-y-8 border-t border-line pt-8 text-[15px] leading-relaxed text-ink-muted">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-medium text-white">{title}</h2>
      {children}
    </section>
  );
}

export function Privacy() {
  return (
    <LegalLayout title="Privacy Policy">
      <Section title="Overview">
        <p>
          Hark is operated by Ryan Vogel. This policy explains the information Hark processes to
          deliver notifications, approvals, Live Activities, on-call pages, team features and
          signed-in web apps through the website, API, CLI, MCP server and iOS app. Hark does not
          sell personal information or use it for targeted advertising.
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
            Webhook and agent notification content such as titles, bodies, summaries, project names,
            images, destinations, idempotency keys, timestamps, read state, and delivery results.
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
            Teams you create or join: the team name, members and their roles, invite codes (stored
            as hashes), the email address an invite was sent to, who invited whom, and when people
            joined or left. Other members of a team can see your name, email address and profile
            image.
          </li>
          <li>
            On-call information: rotation schedules, your time zone, overrides, escalation steps,
            pages and their content, who was notified, acknowledgements, escalations and
            resolutions, and your paging preferences, including whether your iPhone allows Critical
            Alerts.
          </li>
          <li>
            Web apps you add or open in Hark: the app's name, address and icon, which team it
            belongs to, and your sign-in approval. When you approve sign-in, Hark gives that site a
            short-lived signed pass with an identifier made only for that site, your team and role
            for team apps, and your name and email only if you choose to share them. The site
            receives that information under its own privacy terms, not Hark's.
          </li>
          <li>
            Agent clients connected through the MCP server or the CLI: the client's name, the
            permissions you granted, and hashed access and refresh tokens.
          </li>
          <li>
            Subscription status and billing identifiers when you or your team choose a paid plan.
            Payment-card details are collected and handled by Stripe, not stored by Hark.
          </li>
          <li>Limited technical logs used to secure, operate, and troubleshoot the service.</li>
          <li>
            Product analytics such as page and app-screen visits, feature lifecycle events,
            first-touch campaign labels, referring and outbound hostnames, app version, coarse
            outcomes, and related account, service, device, anonymous-install, or session
            identifiers. Hark never puts notification content, summaries, project names, prompts,
            replies, tokens, full URLs, IP addresses, email addresses, or user-agent strings in
            analytics.
          </li>
        </ul>
      </Section>

      <Section title="How we use information">
        <p>
          We use this information to authenticate your account, create and secure webhook endpoints,
          deliver notifications, show delivery activity, prevent duplicate or abusive requests,
          deliver requested interactions and return your response to the authorized agent, start and
          update Live Activities you authorize, run teams and on-call rotations, route and escalate
          pages, sign you in to web apps you approve, bill for paid plans, provide support, and
          maintain the reliability and security of Hark.
        </p>
      </Section>

      <Section title="Service providers">
        <p>
          Hark relies on Google and Apple for authentication, Expo and Apple for push delivery and
          app distribution, Autumn and Stripe for billing, Amazon Web Services for hosting the API
          and database, Cloudflare for DNS, encrypted connections and traffic protection, and
          Inbound for support email. These providers process information only as needed to provide
          their services and under their own privacy terms.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          We retain account and service data while your account is active. Webhook and agent
          notification content — including titles, bodies, summaries, projects, and read state —
          persists in your inbox and is not expired on a schedule; it is removed when your account
          is deleted. You can permanently delete your account inside the Hark app. Deletion removes
          your services, devices, projects, notifications, activity, team memberships and web-app
          approvals from the active database; teams you own are handed to another admin or deleted.
          For accounts using Apple, Hark first asks Apple to revoke stored authorization grants;
          deletion stops and reports an error if that revocation cannot be confirmed. Limited backup
          copies may remain temporarily until rotated.
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
          Questions or privacy requests can be sent to <SupportLink />.
        </p>
      </Section>
    </LegalLayout>
  );
}

export function Terms() {
  return (
    <LegalLayout title="Terms of Service">
      <Section title="Agreement">
        <p>
          By using Hark, you agree to these terms. If you do not agree, do not use the service. You
          must be legally able to form a binding agreement and provide accurate account information.
        </p>
      </Section>

      <Section title="The service">
        <p>
          Hark turns webhooks and agent requests into push notifications, approvals, replies and
          Live Activities on registered iPhones, pages on-call teams, and opens web apps you add
          with a Hark sign-in. Features may change as the service develops, and beta or preview
          features may be modified or removed without notice.
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

      <Section title="On-call paging">
        <p>
          On-call paging is a convenience for engineering teams, not an emergency or life-safety
          service. Pages can be delayed, silenced or missed because of device settings, Focus,
          network conditions, Apple or Expo outages, or Hark itself. Do not rely on Hark as your
          only way to reach someone when harm to people or property is at stake, and keep a backup
          way to escalate.
        </p>
      </Section>

      <Section title="Teams and web apps">
        <p>
          Team owners and admins decide who joins a team, which apps it shares and who is on call,
          and are responsible for removing people who should no longer have access. Web apps you add
          or open in Hark are run by their own operators; Hark only signs you in with the details
          you approve and is not responsible for those sites or how they use that information.
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
          Hark is free for personal use within the limits shown on the pricing page. Teams need the
          Team plan, which the team owner starts on the Hark website and which is billed through
          Autumn and Stripe per seat: every member of the team, including the owner, is one seat at
          the monthly price shown before checkout. The seat count follows the team's membership, and
          charges change as people join or leave. Existing Hark Pro subscriptions continue on their
          current terms until canceled. Subscriptions renew automatically until canceled. You can
          manage or cancel a subscription from the web dashboard; cancellation takes effect at the
          end of the current paid period unless stated otherwise. Fees are non-refundable except
          where required by law. We may change future pricing with advance notice, but changes do
          not apply retroactively to an already-paid period.
        </p>
      </Section>

      <Section title="Third-party services">
        <p>
          Hark depends on services provided by Google, Apple, Expo, Autumn, Stripe, Amazon Web
          Services, Cloudflare and Inbound. Their availability and terms are outside Hark's control,
          and integrations may stop working if those services change.
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
          Questions about these terms can be sent to <SupportLink />.
        </p>
      </Section>
    </LegalLayout>
  );
}
