import type { DeviceDto, EventDto, OncallPageDto, ServiceDto } from "@hark/contracts";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CodeBlock } from "../../components/CodeBlock";
import {
  EmptyState,
  formatDateTime,
  LIST_PANEL,
  relativeTime,
  Segmented,
} from "../../components/DashboardKit";
import {
  ActivityItem,
  CopyLine,
  curlExample,
  isFailedEvent,
  ProgressRing,
  UsageMeter,
} from "../../components/DashboardParts";
import { IOS_DOWNLOAD_URL } from "../../components/SiteChrome";
import { primaryButtonSmall, rowButton, secondaryButton, textLink } from "../../components/ui";
import { api } from "../../lib/api";
import { notificationUsage, openPages, useDashboard } from "../../lib/dashboard";
import { setupProgress } from "../Dashboard";

/** `/dashboard`: setup checklist for new accounts, then a calm status summary. */
export function Overview() {
  const data = useDashboard();
  const setup = setupProgress(data);
  const pages = openPages(data.oncall);
  const firstName = data.user.name?.trim().split(/\s+/)[0];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] leading-[1.15] font-medium tracking-[-0.015em] text-white">
          {setup && setup.done < setup.total
            ? `Welcome to Hark${firstName ? `, ${firstName}` : ""}`
            : `${greeting()}${firstName ? `, ${firstName}` : ""}`}
        </h1>
        <p className="mt-1.5 text-ink-muted">
          {setup && setup.done < setup.total
            ? "A few steps and your agents can reach your iPhone."
            : "Here's how Hark is doing."}
        </p>
      </div>

      {pages.length > 0 ? <OpenPages pages={pages} /> : null}

      {setup && setup.done < setup.total ? <SetupChecklist setup={setup} /> : null}
      {setup && setup.done === setup.total ? <StatusStrip /> : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <UsageCard />
        <IphoneCard />
      </div>

      <UpcomingShift />

      <RecentActivity />
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// ---------------------------------------------------------------------------
// Open pages
// ---------------------------------------------------------------------------

function OpenPages({ pages }: { pages: OncallPageDto[] }) {
  const { teams, refreshOncall } = useDashboard();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const teamName = (teamId: string) =>
    Array.isArray(teams) ? teams.find((team) => team.id === teamId)?.name : undefined;

  const acknowledge = async (page: OncallPageDto) => {
    setBusyId(page.id);
    setError(null);
    try {
      await api.updatePage(page.id, "acknowledge");
      await refreshOncall();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not acknowledge this page");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="open-pages-heading" className="mb-5">
      <h2 className="sr-only" id="open-pages-heading">
        Open pages
      </h2>
      <ul className="space-y-3">
        {pages.slice(0, 3).map((page) => {
          const triggered = page.status === "triggered";
          const team = teamName(page.teamId);
          return (
            <li
              className={`rounded-3xl p-5 ring-1 ring-inset ${
                triggered
                  ? "bg-[linear-gradient(135deg,rgb(178_36_32/0.82),rgb(150_28_26/0.62))] shadow-[0_10px_40px_-12px_rgb(196_48_43/0.6)] ring-danger-line"
                  : "bg-warn/10 ring-warn/40"
              }`}
              key={page.id}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <p
                    className={`flex items-center gap-2 text-[13px] font-medium tracking-[0.02em] uppercase ${triggered ? "text-white/90" : "text-warn"}`}
                  >
                    <span aria-hidden="true" className="relative flex size-2">
                      {triggered ? (
                        <span className="absolute inset-0 animate-ping rounded-full bg-white opacity-75 motion-reduce:animate-none" />
                      ) : null}
                      <span
                        className={`relative size-2 rounded-full ${triggered ? "bg-white" : "bg-warn"}`}
                      />
                    </span>
                    {triggered ? "Open page · not acknowledged" : "Open page · acknowledged"}
                  </p>
                  <p className="mt-1.5 text-[20px] leading-snug font-medium text-white">
                    {page.title}
                  </p>
                  <p className="mt-1 text-sm text-white/85">
                    {[team, page.groupName, `triggered ${relativeTime(page.createdAt)}`]
                      .filter(Boolean)
                      .join(" · ")}
                    {page.acknowledgedBy ? ` · ${page.acknowledgedBy.name} is on it` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {triggered ? (
                    <button
                      className={primaryButtonSmall}
                      disabled={busyId === page.id}
                      onClick={() => void acknowledge(page)}
                      type="button"
                    >
                      {busyId === page.id ? "Acknowledging…" : "Acknowledge"}
                    </button>
                  ) : null}
                  <Link className={secondaryButton} to={`/dashboard/teams/${page.teamId}`}>
                    Open team
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Setup checklist
// ---------------------------------------------------------------------------

type Setup = NonNullable<ReturnType<typeof setupProgress>>;

function SetupChecklist({ setup }: { setup: Setup }) {
  const { services, mcpClients, apiTokens } = useDashboard();
  const { steps } = setup;
  const firstOpen = !steps.app ? 1 : !steps.signIn ? 2 : !steps.agent ? 3 : 4;
  const agentConnected =
    (mcpClients?.length ?? 0) > 0 || (apiTokens ?? []).some((token) => token.revokedAt === null);

  return (
    <section
      aria-labelledby="setup-heading"
      className="hark-glass hark-glass-strong rounded-[28px] p-4 sm:p-7"
    >
      <div className="flex items-center gap-4">
        <ProgressRing done={setup.done} total={setup.total} />
        <div className="min-w-0">
          <h2
            className="text-[22px] leading-[1.2] font-medium tracking-[-0.01em] text-white"
            id="setup-heading"
          >
            Set up Hark
          </h2>
          <p className="mt-0.5 text-ink-muted">
            {setup.done} of {setup.total} done · this list ticks itself off as you go.
          </p>
        </div>
      </div>

      <ol className="mt-6 space-y-2">
        <Step
          current={firstOpen === 1}
          done={steps.app}
          index={1}
          title="Get the iPhone app"
          summary="Hark delivers to your iPhone, with Live Activities and approvals."
        >
          <a
            className={primaryButtonSmall}
            href={IOS_DOWNLOAD_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 16 16">
              <path d="M11.2 8.5c0-1.6 1.3-2.4 1.4-2.4-.8-1.1-2-1.3-2.4-1.3-1-.1-2 .6-2.5.6s-1.3-.6-2.2-.6C4.3 4.8 3.2 5.5 2.6 6.6c-1.2 2.1-.3 5.2.9 6.9.6.8 1.2 1.7 2.1 1.7.8 0 1.2-.5 2.2-.5s1.3.5 2.2.5 1.5-.9 2-1.7c.6-.9.9-1.8.9-1.9 0 0-1.6-.7-1.7-3.1ZM9.6 3.6c.5-.6.8-1.3.7-2.1-.7 0-1.5.5-2 1.1-.4.5-.8 1.3-.7 2 .8.1 1.5-.4 2-1Z" />
            </svg>
            <span className="sm:hidden">App Store</span>
            <span className="hidden sm:inline">Download on the App Store</span>
          </a>
        </Step>

        <Step
          current={firstOpen === 2}
          done={steps.signIn}
          index={2}
          title="Sign in on your iPhone"
          summary="Open Hark and sign in with the same Apple or Google account you use here."
        >
          <p className="flex items-center gap-2 text-sm text-ink-faint">
            <span aria-hidden="true" className="relative flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-mint opacity-60 motion-reduce:animate-none" />
              <span className="relative size-2 rounded-full bg-mint" />
            </span>
            Waiting for your iPhone…
          </p>
        </Step>

        <Step
          current={firstOpen === 3}
          done={steps.agent}
          index={3}
          title="Connect an agent"
          summary="Pick one: an MCP server for Claude Code, OpenCode or Cursor, the harkctl CLI, or a plain webhook."
        >
          <ConnectChoice />
        </Step>

        <Step
          current={firstOpen === 4}
          done={steps.test}
          index={4}
          title="Send a test notification"
          summary="Make sure everything reaches your phone."
        >
          <SendTest agentConnected={agentConnected} services={services ?? []} />
        </Step>
      </ol>
    </section>
  );
}

function Step({
  index,
  title,
  summary,
  done,
  current,
  children,
}: {
  index: number;
  title: string;
  summary: string;
  done: boolean;
  current: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className={`flex gap-3 rounded-3xl px-3 py-4 transition-colors sm:gap-4 sm:px-4 ${current ? "bg-white/[0.06]" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-medium tabular-nums ${
          done
            ? "bg-mint text-green"
            : current
              ? "bg-white text-green"
              : "text-ink-muted ring-1 ring-line-strong ring-inset"
        }`}
      >
        {done ? (
          <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
            <path
              d="m3 8.5 3.1 3L13 4.8"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        ) : (
          index
        )}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <h3
          className={`text-[17px] leading-6 font-medium ${done ? "text-ink-muted line-through decoration-white/30" : "text-white"}`}
        >
          {title}
          <span className="sr-only">{done ? " (done)" : ""}</span>
        </h3>
        {done ? null : (
          <>
            <p className="mt-0.5 text-[15px] text-ink-muted">{summary}</p>
            <div className="mt-3.5">{children}</div>
          </>
        )}
      </div>
    </li>
  );
}

function ConnectChoice() {
  const { createService } = useDashboard();
  const [method, setMethod] = useState<"mcp" | "cli" | "webhook">("mcp");
  return (
    <div>
      <Segmented
        label="How to connect"
        onChange={setMethod}
        options={[
          { value: "mcp", label: "MCP" },
          { value: "cli", label: "CLI" },
          { value: "webhook", label: "Webhook" },
        ]}
        value={method}
      />
      <div className="mt-3">
        {method === "mcp" ? (
          <>
            <CopyLine label="MCP server URL" value={`${window.location.origin}/mcp`} />
            <p className="mt-2 text-[13px] text-ink-faint">
              Add it as a remote MCP server; you'll approve the connection here.
            </p>
          </>
        ) : null}
        {method === "cli" ? (
          <div className="space-y-2">
            <CopyLine label="install command" value="npm install -g harkctl" />
            <CopyLine label="sign-in command" value="harkctl auth login" />
          </div>
        ) : null}
        {method === "webhook" ? (
          <div className="flex flex-wrap items-center gap-3">
            <button className={primaryButtonSmall} onClick={createService} type="button">
              Create a webhook service
            </button>
            <span className="text-[13px] text-ink-faint">
              POST to its secret URL from CI, cron or anything.
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SendTest({
  services,
  agentConnected,
}: {
  services: ServiceDto[];
  agentConnected: boolean;
}) {
  const { refreshActivity } = useDashboard();
  const service = services.find((item) => item.webhookUrl);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  useEffect(() => {
    if (state !== "sent") return;
    const timeout = window.setTimeout(() => void refreshActivity(), 1200);
    return () => window.clearTimeout(timeout);
  }, [state, refreshActivity]);

  if (service?.webhookUrl) {
    const webhookUrl = service.webhookUrl;
    const send = async () => {
      setState("sending");
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": `dashboard-test-${Date.now()}`,
          },
          body: JSON.stringify({ body: "Test from your Hark dashboard. It works! 🎉" }),
        });
        setState(response.ok ? "sent" : "error");
      } catch {
        setState("error");
      }
    };
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className={primaryButtonSmall}
            disabled={state === "sending"}
            onClick={() => void send()}
            type="button"
          >
            {state === "sending" ? "Sending…" : `Send test via ${service.title}`}
          </button>
          <span className="text-[13px] text-ink-faint" role="status">
            {state === "sent"
              ? "Sent. Check your iPhone."
              : state === "error"
                ? "That didn't go through. Try the curl below."
                : "Or run it yourself:"}
          </span>
        </div>
        <CodeBlock className={CODE_CLASS} code={curlExample(webhookUrl)} language="bash" />
      </div>
    );
  }

  if (agentConnected) {
    return (
      <div>
        <p className="mb-2 text-sm text-ink-muted">Ask your agent:</p>
        <CopyLine label="prompt" value="Send me a test notification with Hark." />
      </div>
    );
  }

  return <p className="text-sm text-ink-faint">Connect an agent or create a service first.</p>;
}

const CODE_CLASS =
  "mt-3 overflow-x-auto rounded-2xl bg-code p-4 font-mono text-[12.5px] leading-relaxed text-code-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function StatusStrip() {
  const { devices, events, services, mcpClients, apiTokens } = useDashboard();
  const active = activeDevice(devices);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const failures = (events ?? []).filter(
    (event) => isFailedEvent(event) && new Date(event.createdAt).getTime() > dayAgo,
  ).length;
  const agents =
    (mcpClients?.length ?? 0) +
    (apiTokens ?? []).filter((token) => token.revokedAt === null).length;
  const serviceCount = services?.length ?? 0;

  const tone = !active ? "danger" : failures > 0 ? "warn" : "ok";
  const headline = !active
    ? "No active iPhone"
    : failures > 0
      ? `${failures} ${failures === 1 ? "delivery" : "deliveries"} failed today`
      : "Everything's working";
  const details = [
    active
      ? `${active.deviceName ?? "Your iPhone"} is receiving`
      : "sign in on your iPhone to receive",
    `${serviceCount} ${serviceCount === 1 ? "service" : "services"}`,
    `${agents} ${agents === 1 ? "agent" : "agents"} connected`,
  ];

  return (
    <div className="hark-glass flex items-center gap-3.5 rounded-3xl px-4 py-3.5 sm:px-5">
      <span
        aria-hidden="true"
        className={`grid size-9 shrink-0 place-items-center rounded-full ${
          tone === "ok"
            ? "bg-mint text-green"
            : tone === "warn"
              ? "bg-warn text-green"
              : "bg-danger-strong text-white"
        }`}
      >
        {tone === "ok" ? (
          <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
            <path
              d="m3 8.5 3.1 3L13 4.8"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        ) : (
          <span className="text-[15px] font-semibold">!</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-white">{headline}</p>
        <p className="text-sm text-ink-muted">{details.join(" · ")}</p>
      </div>
      {tone === "warn" ? (
        <Link className={`${rowButton} shrink-0`} to="/dashboard/notifications">
          Review
        </Link>
      ) : tone === "danger" ? (
        <Link className={`${rowButton} shrink-0`} to="/dashboard/devices">
          Devices
        </Link>
      ) : null}
    </div>
  );
}

function activeDevice(devices: DeviceDto[] | null): DeviceDto | undefined {
  return devices?.find((device) => device.active);
}

function UsageCard() {
  const { billing } = useDashboard();
  const usage = notificationUsage(billing);
  return (
    <div className="hark-glass flex flex-col rounded-3xl p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm text-ink-faint">Notifications this month</h2>
        <Link
          className="text-[13px] text-ink-muted transition-colors hover:text-white"
          to="/dashboard/billing"
        >
          {billing ? (billing.plan === "pro" ? "Hark Pro" : "Free plan") : "Plan"}
        </Link>
      </div>
      {usage ? <UsageMeter {...usage} /> : <p className="text-ink-faint">Loading…</p>}
    </div>
  );
}

function IphoneCard() {
  const { devices } = useDashboard();
  const active = activeDevice(devices);
  const others = (devices?.length ?? 0) - (active ? 1 : 0);
  return (
    <div className="hark-glass flex flex-col rounded-3xl p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm text-ink-faint">Your iPhone</h2>
        <Link
          className="text-[13px] text-ink-muted transition-colors hover:text-white"
          to="/dashboard/devices"
        >
          Manage
        </Link>
      </div>
      {devices === null ? <p className="text-ink-faint">Loading…</p> : null}
      {devices !== null && !active ? (
        <>
          <p className="text-[20px] leading-tight font-medium text-white">Not connected</p>
          <p className="mt-1.5 text-[13px] text-ink-faint">
            {devices.length > 0
              ? "Your iPhone is inactive. Sign in again from the Hark app."
              : "Sign in from the Hark app to receive notifications."}
          </p>
        </>
      ) : null}
      {active ? (
        <>
          <p className="flex items-center gap-2 text-[20px] leading-tight font-medium text-white">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-mint" />
            <span className="truncate">{active.deviceName ?? "iPhone"}</span>
          </p>
          <p className="mt-1.5 text-[13px] text-ink-faint">
            {active.liveActivitiesCapable ? "Live Activities ready · " : ""}
            seen {relativeTime(active.lastSeenAt)}
            {others > 0 ? ` · ${others} inactive` : ""}
          </p>
        </>
      ) : null}
    </div>
  );
}

function UpcomingShift() {
  const { oncall } = useDashboard();
  const shift = oncall?.shifts[0];
  if (!shift) return null;
  const now = Date.now();
  const onNow = new Date(shift.startsAt).getTime() <= now && new Date(shift.endsAt).getTime() > now;
  return (
    <Link
      className="hark-glass group mt-4 flex items-center gap-3.5 rounded-3xl px-5 py-4 transition-[filter] hover:brightness-110"
      to={`/dashboard/teams/${shift.teamId}`}
    >
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${onNow ? "bg-mint" : "bg-white/35"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-white">
          {onNow ? "You're on call" : "Your next shift"} · {shift.groupName}
        </span>
        <span className="block truncate text-sm text-ink-muted">
          {shift.teamName} ·{" "}
          {onNow
            ? `until ${formatDateTime(shift.endsAt)}`
            : `${formatDateTime(shift.startsAt)} – ${formatDateTime(shift.endsAt)}`}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
      >
        →
      </span>
    </Link>
  );
}

function RecentActivity() {
  const { events } = useDashboard();
  const recent: EventDto[] = (events ?? []).slice(0, 5);
  return (
    <section aria-labelledby="recent-heading" className="mt-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2
          className="text-[22px] leading-[1.2] font-medium tracking-[-0.01em] text-white"
          id="recent-heading"
        >
          Recent activity
        </h2>
        {recent.length > 0 ? (
          <Link className={textLink} to="/dashboard/notifications">
            View all <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>
      {events === null ? <p className="py-4 text-ink-faint">Loading activity…</p> : null}
      {events?.length === 0 ? (
        <EmptyState title="Nothing yet">
          Your first notification will show up here the moment it's sent.
        </EmptyState>
      ) : null}
      {recent.length > 0 ? (
        <ol className={LIST_PANEL}>
          {recent.map((activityEvent) => (
            <ActivityItem activityEvent={activityEvent} key={activityEvent.id} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}
