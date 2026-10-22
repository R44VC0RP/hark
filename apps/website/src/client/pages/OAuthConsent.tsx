import {
  API_TOKEN_SCOPE_DESCRIPTIONS,
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  OAUTH_OFFLINE_ACCESS_SCOPE,
} from "@hark/contracts";
import { useEffect, useMemo, useState } from "react";
import { AppleButton } from "../components/AppleButton";
import { GoogleButton } from "../components/GoogleButton";
import { Brand, PAGE_COLUMN } from "../components/SiteChrome";
import { primaryButton, secondaryButton } from "../components/ui";
import {
  getOAuthClientInfo,
  type OAuthClientInfo,
  oauthAuthClient,
  signedOAuthQuery,
  signInForOAuth,
  submitOAuthConsent,
} from "../lib/oauth-api";

/** Actions an MCP client can never take, whatever it is granted. */
const HUMAN_ONLY = [
  "answer your prompts",
  "acknowledge or escalate pages",
  "accept team invites",
  "approve app sign-in",
  "create API tokens",
  "start checkout",
];

interface ConsentRequest {
  oauthQuery: string;
  clientId: string;
  apiScopes: ApiTokenScope[];
  offlineAccess: boolean;
  redirectHost: string | null;
  expired: boolean;
}

function readRequest(): ConsentRequest | null {
  const oauthQuery = signedOAuthQuery();
  if (!oauthQuery) return null;
  const params = new URLSearchParams(oauthQuery);
  const clientId = params.get("client_id");
  if (!clientId) return null;
  const requested = new Set((params.get("scope") ?? "").split(" ").filter(Boolean));
  let redirectHost: string | null = null;
  try {
    const redirect = new URL(params.get("redirect_uri") ?? "");
    redirectHost = redirect.host || redirect.protocol.replace(/:$/, "");
  } catch {
    redirectHost = null;
  }
  const exp = Number(params.get("exp"));
  return {
    oauthQuery,
    clientId,
    apiScopes: API_TOKEN_SCOPES.filter((scope) => requested.has(scope)),
    offlineAccess: requested.has(OAUTH_OFFLINE_ACCESS_SCOPE),
    redirectHost,
    expired: Number.isFinite(exp) && exp > 0 && exp * 1000 < Date.now(),
  };
}

/**
 * OAuth consent (and sign-in) page for MCP clients. The authorization
 * endpoint redirects here with a signed query; approving posts the scopes
 * the person left ticked and follows the redirect back to the client.
 */
export function OAuthConsent() {
  const request = useMemo(readRequest, []);
  const { data: session, isPending } = oauthAuthClient.useSession();
  const [client, setClient] = useState<OAuthClientInfo | null>(null);
  const [selected, setSelected] = useState<Set<ApiTokenScope>>(
    () => new Set(request?.apiScopes ?? []),
  );
  const [offlineAccess, setOfflineAccess] = useState(request?.offlineAccess ?? false);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request || request.expired) return;
    let cancelled = false;
    void getOAuthClientInfo(request.clientId, request.oauthQuery)
      .then((info) => {
        if (!cancelled) setClient(info);
      })
      .catch(() => {
        if (!cancelled) setClient({ client_id: request.clientId });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const clientName = client?.client_name?.trim() || "An MCP client";

  const decide = async (accept: boolean) => {
    if (!request) return;
    setBusy(accept ? "approve" : "deny");
    setError(null);
    try {
      const scopes = accept
        ? [
            ...API_TOKEN_SCOPES.filter((scope) => selected.has(scope)),
            ...(offlineAccess ? [OAUTH_OFFLINE_ACCESS_SCOPE] : []),
          ]
        : undefined;
      const url = await submitOAuthConsent(accept, scopes, request.oauthQuery);
      // The signed request is spent; back or refresh lands on "Nothing to authorize".
      window.history.replaceState(null, "", "/oauth/consent");
      setDone(accept ? "approved" : "denied");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete the authorization");
      setBusy(null);
    }
  };

  const toggle = (scope: ApiTokenScope) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });

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
          {!request || request.expired ? (
            <>
              <h1 className="text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-balance text-white">
                {request?.expired ? "This request expired" : "Nothing to authorize"}
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
                Start the connection again from your MCP client. It opens this page with a fresh
                request.
              </p>
            </>
          ) : (
            <>
              <ClientHeader client={client} name={clientName} redirectHost={request.redirectHost} />

              {isPending ? (
                <p className="mt-6 text-[15px] text-ink-faint">Checking your session…</p>
              ) : !session ? (
                <div className="mt-6">
                  <p className="mb-5 text-[15px] leading-relaxed text-ink-muted">
                    Sign in to choose what {clientName} may do with your Hark account. Signing in
                    does not connect it.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <AppleButton onClick={() => void signInForOAuth("apple")} />
                    <GoogleButton onClick={() => void signInForOAuth("google")} />
                  </div>
                </div>
              ) : done ? (
                <div className="mt-6 rounded-2xl bg-white/12 px-4 py-3 text-[15px] text-white">
                  {done === "approved"
                    ? `Connected. Returning to ${clientName}…`
                    : `Denied. Returning to ${clientName}…`}
                </div>
              ) : (
                <>
                  <fieldset className="mt-6">
                    <legend className="text-[15px] font-medium text-white">
                      Allow {clientName} to
                    </legend>
                    <ul className="mt-3 space-y-2">
                      {request.apiScopes.map((scope) => (
                        <ScopeOption
                          key={scope}
                          checked={selected.has(scope)}
                          description={API_TOKEN_SCOPE_DESCRIPTIONS[scope].description}
                          label={API_TOKEN_SCOPE_DESCRIPTIONS[scope].label}
                          onChange={() => toggle(scope)}
                          scope={scope}
                        />
                      ))}
                      {request.offlineAccess ? (
                        <ScopeOption
                          checked={offlineAccess}
                          description="Refresh its access without asking again until you disconnect it. Unticked, you approve again about every hour."
                          label="Stay connected"
                          onChange={() => setOfflineAccess((value) => !value)}
                          scope={OAUTH_OFFLINE_ACCESS_SCOPE}
                        />
                      ) : null}
                    </ul>
                  </fieldset>

                  <p className="mt-4 text-[13px] leading-5 text-ink-faint">
                    It can never {HUMAN_ONLY.join(", ")}: those stay with you. Disconnect it any
                    time from your dashboard.
                  </p>

                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                      className={`${secondaryButton} h-11`}
                      disabled={busy !== null}
                      onClick={() => void decide(false)}
                      type="button"
                    >
                      {busy === "deny" ? "Denying…" : "Deny"}
                    </button>
                    <button
                      className={primaryButton}
                      disabled={busy !== null || selected.size === 0}
                      onClick={() => void decide(true)}
                      type="button"
                    >
                      {busy === "approve" ? "Connecting…" : "Approve"}
                    </button>
                  </div>
                  {selected.size === 0 ? (
                    <p className="mt-3 text-[13px] text-ink-faint">
                      Choose at least one permission, or deny.
                    </p>
                  ) : null}
                </>
              )}
            </>
          )}

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

function ClientHeader({
  client,
  name,
  redirectHost,
}: {
  client: OAuthClientInfo | null;
  name: string;
  redirectHost: string | null;
}) {
  // Registration is unauthenticated; only https links and images are shown.
  const logoUri = client?.logo_uri?.startsWith("https:") ? client.logo_uri : null;
  const clientUri = client?.client_uri?.startsWith("https:") ? client.client_uri : null;
  return (
    <div className="flex items-start gap-4">
      {logoUri ? (
        <img
          alt=""
          className="size-12 shrink-0 rounded-2xl bg-white object-cover ring-1 ring-white/15"
          src={logoUri}
        />
      ) : (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-lg font-medium text-green">
          {name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <h1 className="text-[22px] leading-[1.2] font-medium tracking-[-0.01em] text-balance text-white">
          Connect {name} to Hark
        </h1>
        <p className="mt-1 text-[13px] leading-5 text-ink-faint">
          {redirectHost ? (
            <>
              Returns to <span className="font-mono text-ink-muted">{redirectHost}</span>
            </>
          ) : null}
          {redirectHost && clientUri ? " · " : null}
          {clientUri ? (
            <a
              className="underline decoration-line-strong underline-offset-2 hover:text-white"
              href={clientUri}
              rel="noreferrer noopener"
              target="_blank"
            >
              {safeHost(clientUri)}
            </a>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

function ScopeOption({
  scope,
  label,
  description,
  checked,
  onChange,
}: {
  scope: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  const id = `scope-${scope.replace(/[^a-z]/gi, "-")}`;
  return (
    <li>
      <label
        className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line px-3.5 py-3 transition-colors hover:bg-surface-hover has-[:checked]:border-line-strong has-[:checked]:bg-white/6"
        htmlFor={id}
      >
        <input
          checked={checked}
          className="mt-0.5 size-[18px] shrink-0 cursor-pointer rounded accent-white"
          id={id}
          onChange={onChange}
          type="checkbox"
        />
        <span className="min-w-0">
          <span className="block text-[15px] font-medium text-white">{label}</span>
          <span className="mt-0.5 block text-[13px] leading-5 text-ink-faint">{description}</span>
          <span className="mt-1 block font-mono text-[12px] text-ink-disabled">{scope}</span>
        </span>
      </label>
    </li>
  );
}
