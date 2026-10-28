import { useEffect } from "react";
import { Link } from "react-router";
import { PAGE_COLUMN, SiteFooter, SiteHeader } from "../components/SiteChrome";
import { primaryButton, textLink } from "../components/ui";

/** Unknown routes. The server answers those with this page prerendered (dist/404.html) and a 404 status. */
export function NotFound() {
  useEffect(() => {
    document.title = "Page not found — Hark";
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className={`${PAGE_COLUMN} flex-1 pt-10 pb-16`}>
        <h1 className="text-[clamp(32px,5vw,44px)] leading-[1.1] font-medium tracking-[-0.02em] text-white">
          This page doesn’t exist.
        </h1>
        <p className="mt-3 max-w-[30rem] text-lg leading-[1.55] text-ink-muted">
          The link may be old, or the address has a typo.
        </p>
        <div className="mt-[22px] flex flex-wrap items-center gap-[22px]">
          <Link className={primaryButton} to="/">
            Go home
          </Link>
          <Link className={textLink} to="/docs">
            Read the docs <span aria-hidden="true">→</span>
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
