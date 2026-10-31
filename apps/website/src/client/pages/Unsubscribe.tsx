import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Brand, PAGE_COLUMN } from "../components/SiteChrome";
import { primaryButton, secondaryButton, textLink } from "../components/ui";
import { ApiRequestError, api, type EmailSubscription } from "../lib/api";

type State =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error" }
  | { kind: "ready"; subscription: EmailSubscription };

const heading =
  "text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-balance text-white";
const copy = "mt-3 text-[15px] leading-relaxed text-ink-muted";

/**
 * `/unsubscribe?u=&t=`: opt out of (or back into) Hark product emails from
 * the signed link in an email. Nothing changes until the button is pressed,
 * so link scanners that open the page don't unsubscribe anyone.
 */
export function Unsubscribe() {
  const [params] = useSearchParams();
  const query = new URLSearchParams({
    u: params.get("u") ?? "",
    t: params.get("t") ?? "",
  }).toString();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getEmailSubscription(query)
      .then((subscription) => {
        if (!cancelled) setState({ kind: "ready", subscription });
      })
      .catch((err) => {
        if (cancelled) return;
        const invalid = err instanceof ApiRequestError && err.status === 404;
        setState({ kind: invalid ? "invalid" : "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const change = async (subscribed: boolean) => {
    setBusy(true);
    try {
      setState({ kind: "ready", subscription: await api.setEmailSubscription(query, subscribed) });
    } catch {
      setState({ kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className={`${PAGE_COLUMN} flex h-16 items-center justify-between`}>
        <Brand />
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-6 pb-20">
        <section aria-live="polite" className="hark-glass w-full rounded-3xl p-5 sm:p-8">
          {state.kind === "loading" ? (
            <p className="text-[15px] text-ink-faint" role="status">
              Checking your link…
            </p>
          ) : null}

          {state.kind === "invalid" ? (
            <>
              <h1 className={heading}>This unsubscribe link doesn't work</h1>
              <p className={copy}>
                Use the link from the bottom of a Hark email, or email{" "}
                <a className={textLink} href="mailto:support@hark.fyi">
                  support@hark.fyi
                </a>{" "}
                and we'll take you off the list.
              </p>
              <Link className={`${secondaryButton} mt-6 h-11`} to="/">
                Go to Hark
              </Link>
            </>
          ) : null}

          {state.kind === "error" ? (
            <>
              <h1 className={heading}>Something went wrong</h1>
              <p className={copy}>Refresh the page to try again.</p>
            </>
          ) : null}

          {state.kind === "ready" && !state.subscription.unsubscribed ? (
            <>
              <h1 className={heading}>Unsubscribe from Hark emails?</h1>
              <p className={copy}>
                {state.subscription.email} will stop getting product updates and announcements.
                Notifications on your iPhone aren't affected.
              </p>
              <button
                className={`${primaryButton} mt-6 h-11 w-full`}
                disabled={busy}
                onClick={() => change(false)}
                type="button"
              >
                {busy ? "Unsubscribing…" : "Unsubscribe"}
              </button>
            </>
          ) : null}

          {state.kind === "ready" && state.subscription.unsubscribed ? (
            <>
              <h1 className={heading}>You're unsubscribed</h1>
              <p className={copy}>
                {state.subscription.email} won't get Hark product emails anymore. Notifications on
                your iPhone keep working.
              </p>
              <button
                className={`${secondaryButton} mt-6 h-11 w-full`}
                disabled={busy}
                onClick={() => change(true)}
                type="button"
              >
                {busy ? "Resubscribing…" : "Changed your mind? Resubscribe"}
              </button>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
