import type {
  ApiTokenDto,
  AppDto,
  BillingDto,
  DeviceDto,
  EventDto,
  LiveActivityDto,
  OAuthClientGrantDto,
  ServiceCreatedResponse,
  ServiceDto,
  TeamDto,
} from "@hark/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import { AppsSection } from "../components/AppsSection";
import { useConfirm } from "../components/ConfirmDialog";
import { CopyField } from "../components/CopyField";
import {
  Badge,
  DashboardHeader,
  EmptyState,
  InlineCode,
  LIST_PANEL,
  relativeTime,
  SECTION,
  SectionHeading,
  TeamMark,
} from "../components/DashboardKit";
import {
  ActivityItem,
  CopyLine,
  curlExample,
  numberFormat,
  UsageMeter,
} from "../components/DashboardParts";
import { DASHBOARD_COLUMN, DashboardTabs } from "../components/DashboardTabs";
import { McpClientsSection } from "../components/McpClientsSection";
import { SiteFooter } from "../components/SiteChrome";
import { TeamsSection } from "../components/TeamsSection";
import {
  closeButton,
  primaryButtonSmall,
  rowButton,
  rowDangerButton,
  secondaryButton,
} from "../components/ui";
import { api, isMissingRoute, type OncallMeResponse } from "../lib/api";
import { useSession } from "../lib/auth";
import {
  DashboardContext,
  type DashboardData,
  notificationUsage,
  openPages,
  useDashboard,
} from "../lib/dashboard";
import { oauthApi } from "../lib/oauth-api";
import { TEAM_SEAT_PRICE_MONTHLY, teamSummary } from "../lib/teams";

/**
 * Tab bodies drop the top rule of their first section and set its heading at
 * page-title size; each tab also carries a visually hidden h1.
 */
const TAB_BODY =
  "[&>section:first-of-type]:mt-0 [&>section:first-of-type]:border-t-0 [&>section:first-of-type]:pt-0 [&>section:first-of-type_h2:first-of-type]:text-[28px] [&>section:first-of-type_h2:first-of-type]:leading-[1.15] [&>section:first-of-type_h2:first-of-type]:tracking-[-0.015em]";

export function TabPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={TAB_BODY}>
      <h1 className="sr-only">{title}</h1>
      {children}
    </div>
  );
}

function agentPrompt(webhookUrl: string, devices: DeviceDto[], deviceRouting: boolean): string {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["body"],
    properties: {
      body: {
        type: "string",
        minLength: 1,
        maxLength: 2000,
        description: "Notification message body.",
      },
      title: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        description: "Optional sender title. Overrides the service default.",
      },
      imageUrl: {
        type: "string",
        format: "uri",
        pattern: "^https://",
        maxLength: 2048,
        description: "Optional avatar URL. Overrides the service default.",
      },
      url: {
        type: "string",
        format: "uri",
        maxLength: 2048,
        description: "Optional destination opened when the notification is tapped.",
      },
      // Only accounts with device routing (legacy Hark Pro) may send deviceIds;
      // everyone else gets a 402, so the schema leaves it out for them.
      ...(deviceRouting
        ? {
            deviceIds: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              uniqueItems: true,
              items: {
                type: "string",
                ...(devices.length > 0 ? { enum: devices.map((device) => device.id) } : {}),
              },
              description:
                "Optional routing targets. Omit to notify every active registered device.",
            },
          }
        : {}),
    },
  };

  return [
    "Configure an integration that sends notifications through this Hark webhook.",
    "",
    `Webhook endpoint: ${webhookUrl}`,
    "Method: POST",
    "Header: Content-Type: application/json",
    "",
    "Payload JSON Schema:",
    JSON.stringify(schema, null, 2),
    "",
    "Minimal test request:",
    curlExample(webhookUrl),
    "",
    "Use body for the notification message. title, imageUrl, and url are optional per-request overrides of the service defaults.",
    ...(deviceRouting
      ? [
          "Omit deviceIds to deliver to all devices. Include one or more IDs to route only to those devices.",
        ]
      : ["Every request is delivered to the account's active iPhone."]),
    ...(deviceRouting && devices.length > 0
      ? [
          "",
          "Registered devices:",
          ...devices.map((device) => `- ${device.deviceName ?? "iPhone"}: ${device.id}`),
        ]
      : []),
  ].join("\n");
}

/**
 * `/dashboard/*`: the site header, a sticky tab bar and the current tab. Loads
 * the account's data once and shares it with every tab through context.
 */
export function DashboardLayout() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  const [services, setServices] = useState<ServiceDto[] | null>(null);
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [liveActivities, setLiveActivities] = useState<LiveActivityDto[] | null>(null);
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [apiTokens, setApiTokens] = useState<ApiTokenDto[] | null>(null);
  const [apps, setApps] = useState<AppDto[] | null>(null);
  const [teams, setTeams] = useState<TeamDto[] | "unsupported" | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingDto | null>(null);
  const [oncall, setOncall] = useState<OncallMeResponse | null>(null);
  const [mcpClients, setMcpClients] = useState<OAuthClientGrantDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceDto | null>(null);
  const [reveal, setReveal] = useState<
    (ServiceCreatedResponse & { kind: "created" | "rotated" }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [svc, dev, tokenState, activity, liveActivityState, billingState, appState] =
        await Promise.all([
          api.listServices(),
          api.listDevices(),
          api.listApiTokens(),
          api.listEvents(),
          api.listLiveActivities(),
          api.getBilling(),
          api.listApps(),
        ]);
      setServices(svc.services);
      setApps(appState.apps);
      setDevices(dev.devices);
      setApiTokens(tokenState.tokens);
      setEvents(activity.events);
      setLiveActivities(liveActivityState.activities);
      setBilling(billingState);
    } catch {
      setError("Could not load your dashboard data. Please refresh and try again.");
    }
    try {
      setMcpClients((await oauthApi.listClients()).clients);
    } catch {
      setMcpClients((current) => current ?? []);
    }
  }, []);

  const refreshOncall = useCallback(async () => {
    try {
      setOncall(await api.getMyOncall());
    } catch {
      // Older servers have no /api/oncall/me; the overview just shows no pages.
    }
  }, []);

  const refreshTeams = useCallback(async () => {
    try {
      const { teams: next } = await api.listTeams();
      setTeams(next);
      setTeamsError(null);
      if (next.length > 0) void refreshOncall();
    } catch (err) {
      if (isMissingRoute(err)) setTeams("unsupported");
      else setTeamsError("Could not load your teams.");
    }
  }, [refreshOncall]);

  const refreshActivity = useCallback(async () => {
    try {
      const [activity, liveActivityState] = await Promise.all([
        api.listEvents(),
        api.listLiveActivities(),
      ]);
      setEvents(activity.events);
      setLiveActivities(liveActivityState.activities);
    } catch {
      // Keep the last successful activity snapshot visible.
    }
  }, []);

  // Team checkout returns here with `?team=<id>&billing=success`; the team page
  // shows the activation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const teamId = params.get("team");
    if (teamId && params.get("billing") === "success") {
      navigate(`/dashboard/teams/${encodeURIComponent(teamId)}?billing=success`, { replace: true });
    }
  }, [navigate]);

  useEffect(() => {
    if (!isPending && !session) {
      navigate("/", { replace: true });
      return;
    }
    if (session) {
      void refresh();
      void refreshTeams();
    }
  }, [session, isPending, navigate, refresh, refreshTeams]);

  const inTeams = Array.isArray(teams) && teams.length > 0;
  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => {
      void refreshActivity();
      if (inTeams) void refreshOncall();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [session, refreshActivity, refreshOncall, inTeams]);

  const user = session?.user;
  const context = useMemo<DashboardData | null>(
    () =>
      user
        ? {
            user,
            services,
            events,
            liveActivities,
            devices,
            apiTokens,
            apps,
            teams,
            teamsError,
            billing,
            oncall,
            mcpClients,
            refresh,
            refreshActivity,
            refreshOncall,
            setApps,
            setTeams,
            setApiTokens,
            setMcpClients,
            createService: () => setCreating(true),
            editService: setEditing,
            revealRotated: (response) => {
              setReveal({ ...response, kind: "rotated" });
              void refresh();
            },
          }
        : null,
    [
      user,
      services,
      events,
      liveActivities,
      devices,
      apiTokens,
      apps,
      teams,
      teamsError,
      billing,
      oncall,
      mcpClients,
      refresh,
      refreshActivity,
      refreshOncall,
    ],
  );

  if (isPending || !context) {
    return (
      <div className="flex min-h-dvh flex-col">
        <DashboardHeader />
        <DashboardTabs />
        <main className={`${DASHBOARD_COLUMN} flex-1 pt-10`}>
          <p className="text-ink-faint" role="status">
            Loading your dashboard…
          </p>
        </main>
      </div>
    );
  }

  const pageCount = openPages(oncall).filter((page) => page.status === "triggered").length;
  const setup = setupProgress(context);

  return (
    <DashboardContext.Provider value={context}>
      <div className="flex min-h-dvh flex-col">
        <DashboardHeader />
        <DashboardTabs
          badges={{
            ...(setup && setup.done < setup.total
              ? { overview: { label: `${setup.done}/${setup.total}`, tone: "quiet" as const } }
              : {}),
            ...(pageCount > 0
              ? { teams: { label: String(pageCount), tone: "danger" as const } }
              : {}),
          }}
          hidden={teams === "unsupported" ? ["teams"] : []}
        />

        <main className={`${DASHBOARD_COLUMN} flex-1 pt-9 pb-20 sm:pt-12`}>
          {error ? (
            <div
              className="mb-6 rounded-2xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {reveal ? (
            <WebhookReveal
              deviceRouting={billing?.features.deviceRouting ?? false}
              devices={devices?.filter((device) => device.active) ?? []}
              reveal={reveal}
              onDismiss={() => setReveal(null)}
            />
          ) : null}

          <Outlet />
        </main>

        <SiteFooter className={DASHBOARD_COLUMN} />

        {creating ? (
          <ServiceModal
            onCancel={() => setCreating(false)}
            onCreated={(response) => {
              setCreating(false);
              setReveal({ ...response, kind: "created" });
              void refresh();
            }}
          />
        ) : null}

        {editing ? (
          <ServiceModal
            service={editing}
            onCancel={() => setEditing(null)}
            onUpdated={() => {
              setEditing(null);
              void refresh();
            }}
          />
        ) : null}
      </div>
    </DashboardContext.Provider>
  );
}

/** Setup checklist progress, or `null` while the data it needs is loading. */
export function setupProgress(data: DashboardData) {
  const { devices, services, apiTokens, mcpClients, events } = data;
  if (devices === null || services === null || apiTokens === null || events === null) return null;
  const hasDevice = devices.length > 0;
  const steps = {
    app: hasDevice,
    signIn: hasDevice,
    agent:
      services.length > 0 ||
      apiTokens.some((token) => token.revokedAt === null) ||
      (mcpClients?.length ?? 0) > 0,
    test: events.length > 0,
  };
  const done = Object.values(steps).filter(Boolean).length;
  return { steps, done, total: 4 };
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function NotificationsTab() {
  const { services, devices, billing, liveActivities, events, refreshActivity, createService } =
    useDashboard();
  const activeDeviceCount = devices?.filter((device) => device.active).length ?? null;
  const deliveryDeviceCount =
    activeDeviceCount === null || billing?.limits.devices === null
      ? activeDeviceCount
      : Math.min(activeDeviceCount, billing?.limits.devices ?? activeDeviceCount);

  return (
    <TabPage title="Notifications">
      <section aria-labelledby="services-heading" className={SECTION}>
        <SectionHeading
          id="services-heading"
          title="Services"
          description={
            deliveryDeviceCount === null
              ? "Each service gets a secret webhook URL."
              : deliveryDeviceCount === 0
                ? "No iPhone registered yet — sign in inside the Hark app to receive notifications."
                : `Each service gets a secret webhook URL. Delivering to ${deliveryDeviceCount} registered ${deliveryDeviceCount === 1 ? "iPhone" : "iPhones"}.`
          }
          action={
            <button type="button" onClick={createService} className={primaryButtonSmall}>
              New service
            </button>
          }
        />
        <ServiceList services={services} />
      </section>

      <LiveActivities activities={liveActivities} />

      <ActivityLog events={events} onRefresh={refreshActivity} />
    </TabPage>
  );
}

export function AgentsTab() {
  const { apiTokens, setApiTokens, setMcpClients } = useDashboard();
  return (
    <TabPage title="Agents">
      <ConnectAgentSection />
      <McpClientsSection onChange={setMcpClients} />
      <AgentTokens
        tokens={apiTokens}
        onRevoked={(id) =>
          setApiTokens((current) => current?.filter((token) => token.id !== id) ?? current)
        }
      />
    </TabPage>
  );
}

export function AppsTab() {
  const { apps, setApps, teams, user } = useDashboard();
  return (
    <TabPage title="Apps">
      <AppsSection
        apps={apps}
        onChanged={(next) =>
          setApps((current) => current?.map((app) => (app.id === next.id ? next : app)) ?? null)
        }
        onRemoved={(id) => setApps((current) => current?.filter((app) => app.id !== id) ?? null)}
        teams={Array.isArray(teams) ? teams : null}
        viewerName={user.name}
      />
    </TabPage>
  );
}

export function TeamsTab() {
  const { teams, teamsError, setTeams } = useDashboard();
  return (
    <TabPage title="Teams">
      {teams === "unsupported" ? (
        <EmptyState title="Teams aren't available on this server." />
      ) : (
        <TeamsSection
          error={teamsError}
          onCreated={(team) =>
            setTeams((current) => [...(Array.isArray(current) ? current : []), team])
          }
          teams={teams}
        />
      )}
    </TabPage>
  );
}

export function DevicesTab() {
  const { devices, billing, refresh } = useDashboard();
  return (
    <TabPage title="Devices">
      <Devices devices={devices} billing={billing} onRemoved={() => void refresh()} />
    </TabPage>
  );
}

export function BillingTab() {
  const { billing, teams } = useDashboard();
  return (
    <TabPage title="Billing">
      <PlanSection billing={billing} />
      {Array.isArray(teams) ? <TeamBillingSection teams={teams} /> : null}
    </TabPage>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function ConnectAgentSection() {
  const mcpUrl = `${window.location.origin}/mcp`;
  return (
    <section aria-labelledby="connect-heading" className={SECTION}>
      <SectionHeading
        id="connect-heading"
        title="Agents"
        description="Let Claude Code, OpenCode, Cursor or any agent send you notifications, ask for approvals and run Live Activities."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="hark-glass flex flex-col rounded-3xl p-5">
          <h3 className="font-medium text-white">MCP server</h3>
          <p className="mt-1 mb-4 flex-1 text-sm text-ink-muted">
            Add this URL as a remote MCP server. Hark asks for your approval here first.
          </p>
          <CopyLine label="MCP server URL" value={mcpUrl} />
        </div>
        <div className="hark-glass flex flex-col rounded-3xl p-5">
          <h3 className="font-medium text-white">Command line</h3>
          <p className="mt-1 mb-4 flex-1 text-sm text-ink-muted">
            Install <InlineCode>harkctl</InlineCode>, then sign in once from your terminal.
          </p>
          <div className="space-y-2">
            <CopyLine label="install command" value="npm install -g harkctl" />
            <CopyLine label="sign-in command" value="harkctl auth login" />
          </div>
        </div>
      </div>
    </section>
  );
}

function AgentTokens({
  tokens,
  onRevoked,
}: {
  tokens: ApiTokenDto[] | null;
  onRevoked: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const activeTokens = tokens?.filter((token) => token.revokedAt === null) ?? [];

  const revoke = async (token: ApiTokenDto) => {
    const confirmed = await confirm({
      title: "Revoke agent connection",
      message: `Revoke “${token.name}”? Its token stops working immediately and the agent must sign in again.`,
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(token.id);
    setError(null);
    try {
      await api.revokeApiToken(token.id);
      onRevoked(token.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke this connection");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="tokens-heading" className={SECTION}>
      <SectionHeading
        id="tokens-heading"
        title="Agent tokens"
        description={
          <>
            Created by <InlineCode>harkctl auth login</InlineCode>. Revoke one to sign that agent
            out.
          </>
        }
      />
      {tokens === null ? <p className="py-4 text-ink-faint">Loading tokens…</p> : null}
      {tokens !== null && activeTokens.length === 0 ? (
        <EmptyState title="No agent tokens">
          Run <InlineCode>harkctl auth login</InlineCode> and approve it to add one.
        </EmptyState>
      ) : null}
      {activeTokens.length > 0 ? (
        <ul className={LIST_PANEL}>
          {activeTokens.map((token) => (
            <li key={token.id} className="flex items-center gap-3 py-3.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-panel font-mono text-xs text-mint ring-1 ring-white/15">
                ❯_
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-white">{token.name}</p>
                <p className="truncate text-[13px] text-ink-faint" title={token.scopes.join(", ")}>
                  {token.prefix}… · {token.scopes.length}{" "}
                  {token.scopes.length === 1 ? "scope" : "scopes"} · last used{" "}
                  {token.lastUsedAt ? relativeTime(token.lastUsedAt) : "never"}
                  {token.expiresAt
                    ? ` · expires ${new Date(token.expiresAt).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                disabled={busyId === token.id}
                onClick={() => void revoke(token)}
                className={`${rowDangerButton} shrink-0`}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {dialog}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

function PlanSection({ billing }: { billing: BillingDto | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usage = notificationUsage(billing);

  const openPortal = async () => {
    setBusy(true);
    setError(null);
    try {
      window.location.assign((await api.openBillingPortal()).url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing");
      setBusy(false);
    }
  };

  if (!billing) {
    return (
      <section aria-labelledby="plan-heading" className={SECTION}>
        <SectionHeading id="plan-heading" title="Plan" />
        <p className="py-4 text-ink-faint">Loading plan…</p>
      </section>
    );
  }

  const { limits } = billing;
  const pro = billing.plan === "pro";
  const rows = [
    limits.devices === null
      ? "Unlimited active iPhones"
      : `${limits.devices} active iPhone${limits.devices === 1 ? "" : "s"}`,
    ...(billing.features.deviceRouting ? ["Route notifications to specific devices"] : []),
    `${numberFormat.format(limits.notificationsPerMonth)} notifications per month`,
    `${numberFormat.format(limits.servicePerMinute)} requests per minute per service`,
    `${numberFormat.format(limits.accountPerMinute)} requests per minute per account`,
  ];

  return (
    <section aria-labelledby="plan-heading" className={SECTION}>
      <SectionHeading
        id="plan-heading"
        title="Billing"
        description="Your personal plan. Teams are billed separately, per team."
      />
      <div className="hark-glass rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-ink-faint">Current plan</p>
            <p className="mt-0.5 flex items-center gap-2 text-[22px] leading-tight font-medium text-white">
              {pro ? "Hark Pro" : "Free"}
              {pro ? <Badge tone="outline">Legacy</Badge> : <Badge tone="ok">Personal use</Badge>}
            </p>
            <p className="mt-1 text-[15px] text-ink-muted">
              {pro
                ? "Hark Pro is no longer sold. Your plan keeps working as long as you stay subscribed."
                : "Free for personal use, no card needed."}
            </p>
          </div>
          {pro ? (
            <button
              type="button"
              disabled={busy || !billing.configured}
              onClick={() => void openPortal()}
              className={primaryButtonSmall}
            >
              {busy ? "Opening…" : billing.configured ? "Manage billing" : "Billing unavailable"}
            </button>
          ) : (
            <Link className={secondaryButton} to="/pricing">
              Compare plans
            </Link>
          )}
        </div>

        {usage ? (
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-2 text-sm text-ink-faint">Notifications this month</p>
            <UsageMeter {...usage} />
          </div>
        ) : null}

        <ul className="mt-6 grid gap-x-6 gap-y-2.5 border-t border-line pt-5 sm:grid-cols-2">
          {rows.map((row) => (
            <li className="flex gap-2 text-sm leading-snug text-ink" key={row}>
              <span
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-mint"
                aria-hidden="true"
              />
              <span>{row}</span>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function TeamBillingSection({ teams }: { teams: TeamDto[] }) {
  return (
    <section aria-labelledby="team-billing-heading" className={SECTION}>
      <SectionHeading
        id="team-billing-heading"
        title="Team billing"
        description={`The Team plan is $${TEAM_SEAT_PRICE_MONTHLY} per seat per month, every member including the owner. Manage it from each team's page.`}
      />
      {teams.length === 0 ? (
        <EmptyState title="You're not in any teams">
          <Link className="hark-link" to="/dashboard/teams">
            Create a team
          </Link>{" "}
          to share apps and page whoever's on call.
        </EmptyState>
      ) : (
        <ul className={LIST_PANEL}>
          {teams.map((team) => (
            <li key={team.id}>
              <Link
                className="group -mx-4 flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/4 sm:-mx-5 sm:px-5"
                to={`/dashboard/teams/${team.id}`}
              >
                <TeamMark name={team.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-white">{team.name}</span>
                    {team.plan === "team" ? (
                      <Badge tone="ok">Team plan</Badge>
                    ) : (
                      <Badge tone="outline">No plan</Badge>
                    )}
                  </span>
                  <span className="block truncate text-[13px] text-ink-faint">
                    {team.plan === "team"
                      ? `${team.seats.billable} billable ${team.seats.billable === 1 ? "seat" : "seats"} · $${numberFormat.format(team.seats.billable * TEAM_SEAT_PRICE_MONTHLY)}/month`
                      : teamSummary(team)}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WebhookReveal({
  deviceRouting,
  devices,
  reveal,
  onDismiss,
}: {
  deviceRouting: boolean;
  devices: DeviceDto[];
  reveal: ServiceCreatedResponse & { kind: "created" | "rotated" };
  onDismiss: () => void;
}) {
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);

  useEffect(() => {
    if (!agentPromptCopied) return;
    const timeout = window.setTimeout(() => setAgentPromptCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [agentPromptCopied]);

  const copyAgentPrompt = async () => {
    try {
      await navigator.clipboard.writeText(agentPrompt(reveal.webhookUrl, devices, deviceRouting));
      setAgentPromptCopied(true);
    } catch {
      // Clipboard access can be unavailable outside a secure context.
    }
  };

  return (
    <section className="hark-glass mb-8 rounded-3xl p-5">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h2 className="text-lg font-medium text-white">
          {reveal.kind === "created"
            ? `“${reveal.service.title}” is ready`
            : `New webhook URL for “${reveal.service.title}”`}
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[15px] text-ink-muted transition-colors hover:text-white"
        >
          Done
        </button>
      </div>
      <p className="mb-4 text-sm text-ink-muted">
        This URL is encrypted at rest and remains available from your service's copy button.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 rounded-2xl bg-panel py-1 pr-1 pl-4">
          <CopyField value={reveal.webhookUrl} />
        </div>
        <button
          type="button"
          onClick={copyAgentPrompt}
          className={`${primaryButtonSmall} shrink-0 self-start sm:self-auto`}
        >
          {agentPromptCopied ? "Agent prompt copied" : "Copy agent prompt"}
        </button>
      </div>
    </section>
  );
}

function ServiceModal({
  service,
  onCancel,
  onCreated,
  onUpdated,
}: {
  service?: ServiceDto;
  onCancel: () => void;
  onCreated?: (response: ServiceCreatedResponse) => void;
  onUpdated?: (service: ServiceDto) => void;
}) {
  const [title, setTitle] = useState(service?.title ?? "");
  const [imageUrl, setImageUrl] = useState(service?.imageUrl ?? "");
  const [url, setUrl] = useState(service?.url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(
    (afterClose: () => void = onCancel) => {
      if (closing) return;
      setClosing(true);
      window.setTimeout(afterClose, 120);
    },
    [closing, onCancel],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => titleInputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, close]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input = {
        title: title.trim(),
        imageUrl: imageUrl.trim() || null,
        url: url.trim() || null,
      };
      if (service) {
        const response = await api.updateService(service.id, input);
        close(() => onUpdated?.(response.service));
      } else {
        const response = await api.createService(input);
        close(() => onCreated?.(response));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Could not ${service ? "update" : "create"} service`,
      );
    } finally {
      setBusy(false);
    }
  };

  const inputClass = "hark-field px-3 py-2.5 text-base sm:text-[15px]";

  return (
    <div className={`hark-modal-backdrop ${closing ? "is-closing" : ""}`}>
      <button
        aria-label={`Close ${service ? "edit" : "new"} service dialog`}
        className="hark-modal-dismiss"
        disabled={busy}
        onClick={() => close()}
        type="button"
      />
      <form
        aria-labelledby="service-form-title"
        aria-modal="true"
        className="hark-modal-panel hark-glass hark-glass-strong"
        onSubmit={submit}
        role="dialog"
      >
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <h2 id="service-form-title" className="text-xl font-medium text-white">
              {service ? "Edit service" : "New service"}
            </h2>
            <p className="mt-1 text-[15px] text-ink-muted">
              {service ? "Update this webhook's defaults." : "Set the defaults for this webhook."}
            </p>
          </div>
          <button
            aria-label="Close"
            className={closeButton}
            disabled={busy}
            onClick={() => close()}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm text-ink-muted">Title (sender name)</span>
            <input
              className={inputClass}
              ref={titleInputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Acme CRM"
              maxLength={80}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-ink-muted">
              Avatar image URL <span className="font-normal">(optional)</span>
            </span>
            <input
              className={inputClass}
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm text-ink-muted">
              Destination URL <span className="font-normal">(optional, opened on tap)</span>
            </span>
            <input
              className={inputClass}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/dashboard"
            />
            <span className="mt-1.5 block text-[13px] text-ink-faint">
              Supports web URLs, app deep links, and shortcuts://run-shortcut URLs.
            </span>
          </label>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => close()} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || title.trim().length === 0}
            className={primaryButtonSmall}
          >
            {busy
              ? service
                ? "Saving…"
                : "Creating…"
              : service
                ? "Save changes"
                : "Create service"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Devices({
  devices,
  billing,
  onRemoved,
}: {
  devices: DeviceDto[] | null;
  billing: BillingDto | null;
  onRemoved: () => void;
}) {
  const activeDevices = devices?.filter((device) => device.active) ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const remove = async (device: DeviceDto) => {
    const confirmed = await confirm({
      title: "Remove iPhone",
      message: `Remove ${device.deviceName ?? "this iPhone"} from Hark? It stops receiving notifications until it signs in from the app again.`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(device.id);
    setError(null);
    try {
      await api.removeDevice(device.id);
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove this device");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className={SECTION} aria-labelledby="devices-heading">
      <SectionHeading
        id="devices-heading"
        title="Devices"
        description={
          billing?.features.deviceRouting ? (
            <>
              Omit <InlineCode>deviceIds</InlineCode> to notify all active devices, or pass IDs to
              route a webhook to specific ones.
            </>
          ) : (
            "Webhooks, prompts and Live Activities go to your active iPhone."
          )
        }
      />
      {devices === null ? <p className="py-4 text-ink-faint">Loading devices…</p> : null}
      {devices?.length === 0 ? (
        <EmptyState title="No iPhones registered yet">
          Install Hark from the App Store and sign in with this account.
        </EmptyState>
      ) : null}
      {devices && devices.length > 0 ? (
        <ul className={LIST_PANEL}>
          {devices.map((device) => (
            <li
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 py-3.5"
              key={device.id}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-white">
                  <span className="truncate">{device.deviceName ?? "iPhone"}</span>
                  {device.active ? (
                    <Badge tone="ok">Active</Badge>
                  ) : (
                    <Badge tone="outline">Inactive</Badge>
                  )}
                </p>
                <p className="truncate font-mono text-xs text-ink-faint">{device.id}</p>
                <p className="mt-0.5 text-[13px] text-ink-faint">
                  {device.liveActivitiesCapable
                    ? `Live Activities ready · ${device.liveActivityTokenEnvironment} · refreshed ${new Date(
                        device.liveActivityTokenUpdatedAt ?? device.lastSeenAt,
                      ).toLocaleString()}`
                    : "Live Activities token not registered"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(device.id)}
                  className={rowButton}
                >
                  Copy ID
                </button>
                <button
                  type="button"
                  disabled={busyId === device.id}
                  onClick={() => void remove(device)}
                  className={rowDangerButton}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {billing?.plan === "free" && activeDevices.length >= 1 ? (
        <p className="mt-3 text-sm text-ink-faint">
          Free includes one active iPhone. Remove this one before signing in on another. Joining a
          team doesn't change this limit.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {dialog}
    </section>
  );
}

function LiveActivities({ activities }: { activities: LiveActivityDto[] | null }) {
  if (activities === null || activities.length === 0) return null;
  return (
    <section className={SECTION} aria-labelledby="live-activities-heading">
      <SectionHeading id="live-activities-heading" title="Live Activities" />
      <ul className={LIST_PANEL}>
        {activities.map((activity) => (
          <li className="flex items-center justify-between gap-4 py-3.5" key={activity.id}>
            <div className="min-w-0">
              <p className="truncate font-medium text-white">{activity.props.title}</p>
              <p className="truncate text-sm text-ink-muted">{activity.props.status}</p>
            </div>
            <p className="shrink-0 font-mono text-xs text-ink-faint">
              seq {activity.sequence} · {activity.status}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityLog({
  events,
  onRefresh,
}: {
  events: EventDto[] | null;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className={SECTION} aria-labelledby="activity-heading">
      <SectionHeading
        id="activity-heading"
        title="Activity"
        description="Latest webhook delivery attempts."
        action={
          <button type="button" onClick={() => void onRefresh()} className={rowButton}>
            Refresh
          </button>
        }
      />
      {events === null ? <p className="py-4 text-ink-faint">Loading activity…</p> : null}
      {events?.length === 0 ? (
        <EmptyState title="No webhook activity yet">
          Deliveries show up here as soon as a service receives its first request.
        </EmptyState>
      ) : null}
      {events && events.length > 0 ? (
        <ol className={LIST_PANEL}>
          {events.map((activityEvent) => (
            <ActivityItem activityEvent={activityEvent} key={activityEvent.id} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function ServiceList({ services }: { services: ServiceDto[] | null }) {
  const { editService, revealRotated, refresh } = useDashboard();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  if (services === null) {
    return <p className="py-4 text-ink-faint">Loading services…</p>;
  }
  if (services.length === 0) {
    return (
      <EmptyState title="No services yet">
        Create your first service to get a secret webhook URL you can POST to from CI, cron jobs, or
        anything else.
      </EmptyState>
    );
  }

  const rotate = async (svc: ServiceDto) => {
    const confirmed = await confirm({
      title: "Rotate webhook token",
      message: `Rotate the webhook token for “${svc.title}”? The old URL stops working immediately.`,
      confirmLabel: "Rotate token",
    });
    if (!confirmed) return;
    setBusyId(svc.id);
    try {
      revealRotated(await api.rotateServiceToken(svc.id));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (svc: ServiceDto) => {
    const confirmed = await confirm({
      title: "Delete service",
      message: `Delete “${svc.title}”? Its webhook URL stops working immediately and its activity history is removed.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(svc.id);
    try {
      await api.deleteService(svc.id);
      void refresh();
    } finally {
      setBusyId(null);
    }
  };

  const copy = async (svc: ServiceDto) => {
    if (!svc.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(svc.webhookUrl);
      setCopiedId(svc.id);
      window.setTimeout(
        () => setCopiedId((current) => (current === svc.id ? null : current)),
        1600,
      );
    } catch {
      // Clipboard access can be unavailable outside a secure context.
    }
  };

  return (
    <>
      <ul className={LIST_PANEL}>
        {services.map((svc) => (
          <li key={svc.id} className="flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3.5">
            {svc.imageUrl ? (
              <img
                src={svc.imageUrl}
                alt=""
                className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/15"
              />
            ) : (
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-medium text-green">
                {svc.title.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-white">{svc.title}</p>
              <p className="truncate text-[13px] text-ink-faint">
                {svc.url ?? "No destination URL"} · created{" "}
                {new Date(svc.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex w-full flex-wrap gap-2 pl-12 sm:w-auto sm:shrink-0 sm:justify-end sm:pl-0">
              <button
                type="button"
                disabled={!svc.webhookUrl}
                title={
                  svc.webhookUrl
                    ? "Copy webhook URL"
                    : "Rotate this legacy token once to make its URL copyable"
                }
                onClick={() => void copy(svc)}
                className={rowButton}
              >
                {copiedId === svc.id ? "Copied" : "Copy webhook"}
              </button>
              <button
                type="button"
                disabled={busyId === svc.id}
                onClick={() => editService(svc)}
                className={rowButton}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busyId === svc.id}
                onClick={() => void rotate(svc)}
                className={rowButton}
              >
                Rotate token
              </button>
              <button
                type="button"
                disabled={busyId === svc.id}
                onClick={() => void remove(svc)}
                className={rowDangerButton}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {dialog}
    </>
  );
}
