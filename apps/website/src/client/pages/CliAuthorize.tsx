import {
  API_TOKEN_SCOPE_DESCRIPTIONS,
  type ApiTokenScope,
  type DeviceAuthorizationRequestDto,
} from "@hark/contracts";
import { useEffect, useState } from "react";
import { AppleButton } from "../components/AppleButton";
import { GoogleButton } from "../components/GoogleButton";
import { Brand, PAGE_COLUMN } from "../components/SiteChrome";
import { primaryButton, secondaryButton } from "../components/ui";
import { api } from "../lib/api";
import { signInWithApple, signInWithGoogle, useSession } from "../lib/auth";

/** Scopes that let a program take over the account or other people's access. */
const SENSITIVE_SCOPES = new Set<string>(["tokens:manage", "teams:write"]);
const LONG_LIVED_MS = 90 * 24 * 60 * 60 * 1000;

export function CliAuthorize() {
  const initialCode = new URLSearchParams(window.location.search).get("code") ?? "";
  const [code, setCode] = useState(initialCode);
  const [submittedCode, setSubmittedCode] = useState(initialCode);
  // A link can carry someone else's code; typing it in proves it is on your screen.
  const [codeFromLink, setCodeFromLink] = useState(initialCode !== "");
  const [request, setRequest] = useState<DeviceAuthorizationRequestDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!session || !submittedCode) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .getDeviceAuthorization(submittedCode)
      .then((response) => {
        if (!cancelled) setRequest(response.request);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Authorization not found");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, submittedCode]);

  const lookUp = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    window.history.replaceState(null, "", `/cli/authorize?code=${encodeURIComponent(normalized)}`);
    setRequest(null);
    setCodeFromLink(false);
    setSubmittedCode(normalized);
  };

  const resolve = async (action: "approve" | "deny") => {
    setBusy(true);
    setError(null);
    try {
      const response =
        action === "approve"
          ? await api.approveDeviceAuthorization(submittedCode)
          : await api.denyDeviceAuthorization(submittedCode);
      setRequest(response.request);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve authorization");
    } finally {
      setBusy(false);
    }
  };

  const callbackURL = `/cli/authorize?code=${encodeURIComponent(submittedCode || code.trim())}`;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className={`${PAGE_COLUMN} flex h-16 items-center justify-between`}>
        <Brand />
        {session ? (
          <span className="max-w-56 truncate text-sm text-ink-faint">{session.user.email}</span>
        ) : null}
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-6 pb-20">
        <section className="hark-glass w-full rounded-3xl p-5 sm:p-8">
          <h1 className="text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-balance text-white">
            Authorize a command-line client
          </h1>

          {!submittedCode ? (
            <form className="mt-6" onSubmit={lookUp}>
              <label className="text-[15px] text-ink-muted" htmlFor="device-code">
                Enter the code shown in your terminal
              </label>
              <input
                autoCapitalize="characters"
                autoComplete="one-time-code"
                className="hark-field mt-2 min-h-12 px-4 font-mono text-lg tracking-[0.12em] uppercase"
                id="device-code"
                maxLength={9}
                onChange={(event) => setCode(event.target.value)}
                placeholder="ABCD-EFGH"
                value={code}
              />
              <button className={`${primaryButton} mt-4 w-full`} type="submit">
                Continue
              </button>
            </form>
          ) : isPending ? (
            <p className="mt-6 text-[15px] text-ink-faint">Checking your session…</p>
          ) : !session ? (
            <div className="mt-6">
              <p className="mb-5 text-[15px] leading-relaxed text-ink-muted">
                Sign in to choose whether this client may access your Hark account. Signing in does
                not authorize it.
              </p>
              <div className="flex flex-wrap gap-3">
                <AppleButton onClick={() => void signInWithApple(callbackURL)} />
                <GoogleButton onClick={() => void signInWithGoogle(callbackURL)} />
              </div>
            </div>
          ) : loading ? (
            <p className="mt-6 text-[15px] text-ink-faint">Loading authorization request…</p>
          ) : request ? (
            <AuthorizationDetails
              busy={busy}
              codeFromLink={codeFromLink}
              onResolve={resolve}
              request={request}
            />
          ) : null}

          {error ? (
            <div
              className="mt-5 rounded-2xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger"
              role="alert"
            >
              {error}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  return `${Math.round(seconds / 60)} min ago`;
}

function AuthorizationDetails({
  request,
  busy,
  codeFromLink,
  onResolve,
}: {
  request: DeviceAuthorizationRequestDto;
  busy: boolean;
  codeFromLink: boolean;
  onResolve: (action: "approve" | "deny") => Promise<void>;
}) {
  const pending = request.status === "pending";
  const now = useNow(1000);
  const [confirmed, setConfirmed] = useState(false);
  const longLived = new Date(request.tokenExpiresAt).getTime() - now > LONG_LIVED_MS;
  const origin = [request.requesterUserAgent, request.requesterIp].filter(Boolean).join(", ");
  return (
    <div className="mt-6">
      <p className="mb-4 text-[15px] leading-relaxed text-ink-muted">
        This gives a program on another computer access to your Hark account. Only continue if you
        started it yourself, just now, with <span className="font-mono">harkctl auth login</span>.
      </p>
      <div className="rounded-2xl bg-panel p-4">
        <p className="text-[13px] text-ink-faint">Program asking for access</p>
        <p className="mt-1 font-medium text-white">{request.clientName}</p>
        {request.startedAt ? (
          <p className="mt-1 text-[13px] break-words text-ink-faint">
            Started {ago(request.startedAt, now)}
            {origin ? (
              <>
                {" "}
                from <span className="font-mono text-ink-muted">{origin}</span>
              </>
            ) : null}
          </p>
        ) : null}
        <div className="mt-4 flex items-end justify-between gap-4 border-t border-line pt-4">
          <div>
            <p className="text-[13px] text-ink-faint">Code</p>
            <p className="mt-1 font-mono text-lg tracking-[0.12em] text-white">
              {request.userCode}
            </p>
          </div>
          <p className="text-right text-[13px] leading-5 text-ink-faint">
            Request expires
            <br />
            {new Date(request.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <h2 className="text-[15px] font-medium text-white">It will be able to</h2>
        <ul className="mt-2 space-y-2">
          {request.scopes.map((scope) => {
            const info = API_TOKEN_SCOPE_DESCRIPTIONS[scope as ApiTokenScope];
            const sensitive = SENSITIVE_SCOPES.has(scope);
            return (
              <li
                className={`rounded-xl border px-3 py-2 ${sensitive ? "border-danger-line bg-danger-soft" : "border-line"}`}
                key={scope}
              >
                <span className="block text-[15px] font-medium text-white">
                  {info?.label ?? scope}
                  {sensitive ? (
                    <span className="ml-2 text-[13px] text-danger">Sensitive</span>
                  ) : null}
                </span>
                {info ? (
                  <span className="mt-0.5 block text-[13px] leading-5 text-ink-faint">
                    {info.description}
                  </span>
                ) : null}
                <span className="mt-1 block font-mono text-[12px] text-ink-disabled">{scope}</span>
              </li>
            );
          })}
        </ul>
        <p className={`mt-3 text-[13px] ${longLived ? "text-danger" : "text-ink-faint"}`}>
          {longLived ? "Long-lived: access lasts until " : "Access lasts until "}
          {new Date(request.tokenExpiresAt).toLocaleString()}.
        </p>
      </div>

      {pending && codeFromLink ? (
        <label
          className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-3 text-[15px] text-ink-muted"
          htmlFor="cli-authorize-confirm"
        >
          <input
            checked={confirmed}
            className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded accent-white"
            id="cli-authorize-confirm"
            onChange={(event) => setConfirmed(event.target.checked)}
            type="checkbox"
          />
          <span>
            I ran <span className="font-mono">harkctl auth login</span> myself and the code{" "}
            <span className="font-mono text-white">{request.userCode}</span> is on my screen.
          </span>
        </label>
      ) : null}

      {pending ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            className={`${secondaryButton} h-11`}
            disabled={busy}
            onClick={() => void onResolve("deny")}
            type="button"
          >
            Deny
          </button>
          <button
            className={primaryButton}
            disabled={busy || (codeFromLink && !confirmed)}
            onClick={() => void onResolve("approve")}
            type="button"
          >
            Authorize
          </button>
        </div>
      ) : (
        <div
          className={`mt-6 rounded-2xl px-4 py-3 text-[15px] ${request.status === "approved" || request.status === "consumed" ? "bg-white/12 text-white" : "bg-surface-hover text-ink-muted"}`}
        >
          {request.status === "approved" || request.status === "consumed"
            ? "Authorized. You can return to your terminal."
            : request.status === "denied"
              ? "Authorization denied."
              : "This authorization request expired."}
        </div>
      )}
    </div>
  );
}
