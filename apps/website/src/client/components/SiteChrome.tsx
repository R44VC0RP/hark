import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { signInWithApple, signInWithGoogle, useSession } from "../lib/auth";
import { AppleButton } from "./AppleButton";
import { GoogleButton } from "./GoogleButton";

export const APP_STORE_URL =
  "https://apps.apple.com/us/app/hark-developer-notifications/id6794121509";

/** Public TestFlight beta, for builds still waiting on App Store review. */
export const TESTFLIGHT_URL = "https://testflight.apple.com/join/PjCnKETB";

/**
 * Where download links point. Switch to TESTFLIGHT_URL while a new build
 * waits for App Store review.
 */
export const IOS_DOWNLOAD_URL = APP_STORE_URL;

/** Shared page column: left-aligned content in a 48rem measure. */
export const PAGE_COLUMN = "mx-auto w-full max-w-3xl px-6";

const navLink = "text-ink-muted transition-colors duration-150 hover:text-white";

export function Brand() {
  return (
    <Link to="/" className="flex items-center gap-[9px] text-[17px] font-medium text-white">
      {/* The app icon's mark: a white tile with a mint notification badge. */}
      <span aria-hidden="true" className="relative size-[18px] rounded-[5px] bg-white">
        <span className="absolute -top-[3px] -right-[3px] size-[8px] rounded-full bg-mint ring-2 ring-paper" />
      </span>
      Hark
    </Link>
  );
}

type NavPage = "docs" | "pricing";

/**
 * Site header: the Hark mark, Docs and Pricing, and a session-aware action
 * (Open dashboard when signed in, a Sign in menu otherwise). On narrow screens
 * only the action stays, as in the landing design.
 */
export function SiteHeader({
  current,
  className = PAGE_COLUMN,
  signInCallbackURL,
}: {
  current?: NavPage;
  /** Width/padding of the header row; defaults to the page column. */
  className?: string;
  signInCallbackURL?: string;
}) {
  const { data: session } = useSession();
  return (
    <header className={`${className} flex h-16 items-center justify-between`}>
      <Brand />
      <nav aria-label="Primary" className="flex items-center gap-[22px] text-[15px]">
        <NavItem current={current === "docs"} to="/docs">
          Docs
        </NavItem>
        <NavItem current={current === "pricing"} to="/pricing">
          Pricing
        </NavItem>
        {session ? (
          <Link className="text-white" to="/dashboard">
            Open dashboard
          </Link>
        ) : (
          <SignInMenu callbackURL={signInCallbackURL} />
        )}
      </nav>
    </header>
  );
}

function NavItem({
  to,
  current,
  children,
}: {
  to: string;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={`hidden sm:inline ${current ? "text-white" : navLink}`}
      to={to}
    >
      {children}
    </Link>
  );
}

/** "Sign in" opens a small glass menu with the two providers. */
export function SignInMenu({ callbackURL }: { callbackURL?: string }) {
  const [open, setOpen] = useState(false);
  const { isPending } = useSession();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        className="text-white"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        Sign in
      </button>
      {open ? (
        <div
          className="hark-glass hark-glass-strong absolute top-[calc(100%+12px)] right-0 z-40 flex w-64 flex-col gap-2.5 rounded-3xl p-3"
          id={menuId}
        >
          <AppleButton disabled={isPending} onClick={() => void signInWithApple(callbackURL)} />
          <GoogleButton disabled={isPending} onClick={() => void signInWithGoogle(callbackURL)} />
        </div>
      ) : null}
    </div>
  );
}

export function SiteFooter({ className = PAGE_COLUMN }: { className?: string }) {
  return (
    <footer className={className}>
      <div className="flex flex-wrap justify-between gap-4 border-t border-line pt-6 pb-9 text-sm text-ink-faint">
        <span>© 2026 Hark</span>
        <nav aria-label="Footer" className="flex flex-wrap gap-[22px]">
          <Link className="transition-colors hover:text-white" to="/docs">
            Docs
          </Link>
          <Link className="transition-colors hover:text-white" to="/pricing">
            Pricing
          </Link>
          <Link className="transition-colors hover:text-white" to="/privacy">
            Privacy
          </Link>
          <Link className="transition-colors hover:text-white" to="/terms">
            Terms
          </Link>
          <a className="transition-colors hover:text-white" href="/oss">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
