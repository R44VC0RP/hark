import type { TeamInvitePreviewDto, TeamJoinResponse } from "@hark/contracts";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { AppleButton } from "../components/AppleButton";
import { TeamMark } from "../components/DashboardKit";
import { GoogleButton } from "../components/GoogleButton";
import { Brand, IOS_DOWNLOAD_URL, PAGE_COLUMN } from "../components/SiteChrome";
import { primaryButton, secondaryButton, textLink } from "../components/ui";
import { ApiRequestError, api } from "../lib/api";
import { signInWithApple, signInWithGoogle, useSession } from "../lib/auth";
import { API_ERROR_CODE_SEAT_LIMIT, withArticle } from "../lib/teams";

type Preview =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "error" }
  | { kind: "ready"; invite: TeamInvitePreviewDto };

type Outcome =
  | { kind: "idle" }
  | { kind: "joined"; response: TeamJoinResponse }
  | { kind: "seat_limit" }
  | { kind: "error"; message: string };

/** `/join/:code`: preview a team invite, sign in if needed, then accept it. */
export function Join() {
  const { code = "" } = useParams();
  const { data: session, isPending } = useSession();
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview({ kind: "loading" });
    api
      .getTeamInvite(code)
      .then((invite) => {
        if (!cancelled) setPreview({ kind: "ready", invite });
      })
      .catch((err) => {
        if (cancelled) return;
        const gone = err instanceof ApiRequestError && [400, 404, 410].includes(err.status);
        setPreview({ kind: gone ? "invalid" : "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const accept = async () => {
    setBusy(true);
    try {
      setOutcome({ kind: "joined", response: await api.acceptTeamInvite(code) });
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        (err.status === 402 || err.code === API_ERROR_CODE_SEAT_LIMIT)
      ) {
        setOutcome({ kind: "seat_limit" });
      } else if (err instanceof ApiRequestError && [404, 410].includes(err.status)) {
        setPreview({ kind: "invalid" });
      } else {
        setOutcome({
          kind: "error",
          message: err instanceof Error ? err.message : "Could not join the team",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const callbackURL = `/join/${encodeURIComponent(code)}`;
  const teamName = preview.kind === "ready" ? preview.invite.teamName : "this team";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className={`${PAGE_COLUMN} flex h-16 items-center justify-between`}>
        <Brand />
        {session ? (
          <span className="max-w-56 truncate text-sm text-ink-faint">{session.user.email}</span>
        ) : null}
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-6 pb-20">
        <section aria-live="polite" className="hark-glass w-full rounded-3xl p-5 sm:p-8">
          {preview.kind === "loading" ? (
            <p className="text-[15px] text-ink-faint" role="status">
              Checking your invite…
            </p>
          ) : null}

          {preview.kind === "invalid" ? (
            <>
              <h1 className="text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-balance text-white">
                This invite link doesn't work
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
                It may have expired, been revoked or already been used. Ask the person who invited
                you for a new link.
              </p>
              <Link className={`${secondaryButton} mt-6 h-11`} to="/">
                Go to Hark
              </Link>
            </>
          ) : null}

          {preview.kind === "error" ? (
            <>
              <h1 className="text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-white">
                Couldn't load this invite
              </h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
                Something went wrong on our side. Refresh the page to try again.
              </p>
            </>
          ) : null}

          {preview.kind === "ready" && outcome.kind === "joined" ? (
            <Joined code={code} response={outcome.response} />
          ) : null}

          {preview.kind === "ready" && outcome.kind !== "joined" ? (
            <>
              <div className="flex items-center gap-3.5">
                <TeamMark name={preview.invite.teamName} size="lg" />
                <div className="min-w-0">
                  <h1 className="text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-balance text-white">
                    Join {preview.invite.teamName}
                  </h1>
                  <p className="mt-1 text-[15px] text-ink-muted">
                    {preview.invite.memberCount}{" "}
                    {preview.invite.memberCount === 1 ? "member" : "members"} on Hark
                  </p>
                </div>
              </div>
              <p className="mt-5 text-[15px] leading-relaxed text-ink-muted">
                {preview.invite.invitedBy} invited you to join as{" "}
                {`${withArticle(preview.invite.role)}.`} You'll get the team's apps in Hark and can
                be added to its on-call rotations.
              </p>
              <p className="mt-2 text-[13px] text-ink-faint">
                Invite expires {new Date(preview.invite.expiresAt).toLocaleDateString()}.
              </p>

              {outcome.kind === "seat_limit" ? (
                <div
                  className="mt-5 rounded-2xl bg-warn/12 px-4 py-3 text-[15px] leading-relaxed text-white ring-1 ring-warn/40 ring-inset"
                  role="alert"
                >
                  {teamName} has no free seats right now. Ask the team owner to add a seat, then
                  open this link again.
                </div>
              ) : null}
              {outcome.kind === "error" ? (
                <div
                  className="mt-5 rounded-2xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger"
                  role="alert"
                >
                  {outcome.message}
                </div>
              ) : null}

              {isPending ? (
                <p className="mt-6 text-[15px] text-ink-faint">Checking your session…</p>
              ) : !session ? (
                <div className="mt-6">
                  <p className="mb-4 text-[15px] text-ink-muted">Sign in to accept the invite.</p>
                  <div className="flex flex-wrap gap-3">
                    <AppleButton onClick={() => void signInWithApple(callbackURL)} />
                    <GoogleButton onClick={() => void signInWithGoogle(callbackURL)} />
                  </div>
                </div>
              ) : (
                <div className="mt-6">
                  <button
                    className={`${primaryButton} w-full`}
                    disabled={busy}
                    onClick={() => void accept()}
                    type="button"
                  >
                    {busy
                      ? "Joining…"
                      : outcome.kind === "seat_limit"
                        ? "Try again"
                        : `Join ${preview.invite.teamName}`}
                  </button>
                  <p className="mt-3 text-center text-[13px] text-ink-faint">
                    Joining as {session.user.email}
                  </p>
                </div>
              )}
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function Joined({ code, response }: { code: string; response: TeamJoinResponse }) {
  return (
    <>
      <div className="flex items-center gap-3.5">
        <TeamMark name={response.team.name} size="lg" />
        <div className="min-w-0">
          <h1 className="text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-balance text-white">
            {response.joined ? "You're in." : "You're already a member."}
          </h1>
          <p className="mt-1 text-[15px] text-ink-muted">{response.team.name}</p>
        </div>
      </div>
      <p className="mt-5 text-[15px] leading-relaxed text-ink-muted">
        Open Hark on your iPhone to see the team's apps and get paged when you're on call.
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <a className={`${primaryButton} w-full`} href={`hark://join/${encodeURIComponent(code)}`}>
          Open Hark on iPhone
        </a>
        <a
          className={`${secondaryButton} h-11 w-full`}
          href={IOS_DOWNLOAD_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          Get Hark from the App Store
        </a>
      </div>
      <Link className={`${textLink} mt-5`} to={`/dashboard/teams/${response.team.id}`}>
        Go to the team dashboard <span aria-hidden="true">→</span>
      </Link>
    </>
  );
}
