import { Link } from "react-router";
import { RoleSwitcher } from "../components/landing/RoleSwitcher";
import { IOS_DOWNLOAD_URL, SiteHeader } from "../components/SiteChrome";
import { primaryButton, textLink } from "../components/ui";

/** Wider than the docs column: copy on the left, the phone on the right. */
const LANDING_COLUMN = "mx-auto w-full max-w-6xl px-6";

const AGENTS = [
  { name: "Claude Code", src: "/agents/claude.png" },
  { name: "Codex", src: "/agents/codex.png" },
  { name: "OpenCode", src: "/agents/opencode.png" },
];

function AppleGlyph() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="17" viewBox="0 0 17 19" width="15">
      <path d="M13.97 10.08c-.02-2.23 1.82-3.32 1.9-3.37a4.08 4.08 0 0 0-3.2-1.73c-1.35-.14-2.66.81-3.35.81-.7 0-1.77-.8-2.92-.77a4.25 4.25 0 0 0-3.58 2.19c-1.55 2.68-.4 6.62 1.09 8.8.74 1.07 1.6 2.26 2.75 2.22 1.12-.05 1.54-.71 2.89-.71 1.34 0 1.74.71 2.9.68 1.2-.02 1.95-1.07 2.66-2.15a8.8 8.8 0 0 0 1.22-2.48 3.86 3.86 0 0 1-2.36-3.5ZM11.8 3.55A3.9 3.9 0 0 0 12.7.7a4 4 0 0 0-2.6 1.35 3.72 3.72 0 0 0-.92 2.74 3.3 3.3 0 0 0 2.62-1.24Z" />
    </svg>
  );
}

function Intro() {
  return (
    <div className="hark-roles-intro">
      <h1 className="hark-roles-title">Every alert your team needs, on the Lock Screen.</h1>
      <p className="hark-roles-lede">
        Notifications, approvals, Live Activities, signed-in web apps and on-call paging, from any
        webhook or coding agent.
      </p>
      <div className="hark-roles-cta">
        <a
          className={primaryButton}
          href={IOS_DOWNLOAD_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <AppleGlyph />
          Download for iPhone
        </a>
        <Link className={textLink} to="/docs">
          Read the docs <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="hark-roles-agents">
        <span className="flex shrink-0 gap-1">
          {AGENTS.map((agent) => (
            <img
              alt={agent.name}
              className="size-[22px] rounded-[6px]"
              height={22}
              key={agent.name}
              src={agent.src}
              width={22}
            />
          ))}
        </span>
        <span className="text-ink-faint">Built for agents:</span>
        <code className="truncate font-mono text-[0.92em] text-ink">
          npx skills add R44VC0RP/hark --skill hark
        </code>
      </div>
    </div>
  );
}

function FooterLine() {
  const link = "transition-colors hover:text-white";
  return (
    <footer className="hark-roles-footer">
      <span>© 2026 Hark</span>
      <nav aria-label="Footer" className="flex gap-4">
        <Link className={link} to="/pricing">
          Pricing
        </Link>
        <Link className={link} to="/privacy">
          Privacy
        </Link>
        <Link className={link} to="/terms">
          Terms
        </Link>
        <a className={link} href="/oss">
          GitHub
        </a>
      </nav>
    </footer>
  );
}

/**
 * One screen, no scrolling: the pitch and a role switcher whose phone replays
 * what Hark does for an engineer, the person on call, an agent and a team.
 */
export function Landing() {
  return (
    <div className="hark-landing flex h-dvh flex-col overflow-hidden">
      <SiteHeader className={LANDING_COLUMN} />
      <main className={`${LANDING_COLUMN} flex min-h-0 flex-1 flex-col`}>
        <RoleSwitcher footer={<FooterLine />} intro={<Intro />} />
      </main>
    </div>
  );
}
