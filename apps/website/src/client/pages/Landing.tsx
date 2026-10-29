import { Link } from "react-router";
import { Focus } from "../components/landing/Focus";
import { IOS_DOWNLOAD_URL, SiteHeader } from "../components/SiteChrome";
import { primaryButton, textLink } from "../components/ui";

/** Wider than the docs column: copy on the left, the phone on the right. */
const LANDING_COLUMN = "mx-auto w-full max-w-6xl px-6";

function AppleGlyph() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="17" viewBox="0 0 17 19" width="15">
      <path d="M13.97 10.08c-.02-2.23 1.82-3.32 1.9-3.37a4.08 4.08 0 0 0-3.2-1.73c-1.35-.14-2.66.81-3.35.81-.7 0-1.77-.8-2.92-.77a4.25 4.25 0 0 0-3.58 2.19c-1.55 2.68-.4 6.62 1.09 8.8.74 1.07 1.6 2.26 2.75 2.22 1.12-.05 1.54-.71 2.89-.71 1.34 0 1.74.71 2.9.68 1.2-.02 1.95-1.07 2.66-2.15a8.8 8.8 0 0 0 1.22-2.48 3.86 3.86 0 0 1-2.36-3.5ZM11.8 3.55A3.9 3.9 0 0 0 12.7.7a4 4 0 0 0-2.6 1.35 3.72 3.72 0 0 0-.92 2.74 3.3 3.3 0 0 0 2.62-1.24Z" />
    </svg>
  );
}

function Cta() {
  return (
    <>
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
    </>
  );
}

const hintLink =
  "underline decoration-white/20 underline-offset-[3px] transition-colors duration-150 hover:text-white hover:decoration-white/60";

/** Everything else Hark does, each a link into the docs, then the legal pages. */
function Hint() {
  return (
    <>
      <span>
        Also:{" "}
        <a className={hintLink} href="/docs#activity-api">
          Live Activities
        </a>{" "}
        ·{" "}
        <a className={hintLink} href="/docs#mcp">
          MCP
        </a>{" "}
        &amp;{" "}
        <a className={hintLink} href="/docs#cli">
          CLI
        </a>{" "}
        ·{" "}
        <a className={hintLink} href="/docs">
          and more
        </a>
      </span>
      <nav aria-label="Legal">
        <Link className={hintLink} to="/privacy">
          Privacy
        </Link>{" "}
        ·{" "}
        <Link className={hintLink} to="/terms">
          Terms
        </Link>
      </nav>
    </>
  );
}

/**
 * One screen, no scrolling, one thing to look at: the niche headline and a
 * phone that shows one matching moment for each audience in turn.
 */
export function Landing() {
  return (
    <div className="hark-landing flex h-dvh flex-col overflow-hidden">
      <SiteHeader />
      <main className={`${LANDING_COLUMN} flex min-h-0 flex-1 flex-col`}>
        <Focus cta={<Cta />} hint={<Hint />} />
      </main>
    </div>
  );
}
