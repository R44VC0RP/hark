import type {
  ApiTokenDto,
  AppDto,
  BillingDto,
  DeviceDto,
  EventDto,
  LiveActivityDto,
  ServiceCreatedResponse,
  ServiceDto,
  TeamDto,
} from "@hark/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AppDownloadBanner } from "../components/AppDownloadBanner";
import { AppsSection } from "../components/AppsSection";
import { useConfirm } from "../components/ConfirmDialog";
import { CopyField } from "../components/CopyField";
import {
  DashboardHeader,
  EmptyState,
  InlineCode,
  LIST_PANEL,
  relativeTime,
} from "../components/DashboardKit";
import { McpClientsSection } from "../components/McpClientsSection";
import { Brand, PAGE_COLUMN } from "../components/SiteChrome";
import { TeamsSection } from "../components/TeamsSection";
import {
  closeButton,
  primaryButton,
  primaryButtonSmall,
  rowButton,
  rowDangerButton,
  secondaryButton,
} from "../components/ui";
import { api, isMissingRoute } from "../lib/api";
import { useSession } from "../lib/auth";

const numberFormat = new Intl.NumberFormat("en-US");

function curlExample(webhookUrl: string): string {
  return [
    `curl -X POST ${webhookUrl} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Idempotency-Key: unique-event-id' \\`,
    `  -d '{ "body": "Deploy finished ✅" }'`,
  ].join("\n");
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

export function Dashboard() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  const [services, setServices] = useState<ServiceDto[] | null>(null);
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [liveActivities, setLiveActivities] = useState<LiveActivityDto[] | null>(null);
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [apiTokens, setApiTokens] = useState<ApiTokenDto[] | null>(null);
  const [apps, setApps] = useState<AppDto[] | null>(null);
  /** `"unsupported"` when the server predates teams; the section stays hidden. */
  const [teams, setTeams] = useState<TeamDto[] | "unsupported" | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingDto | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
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
  }, []);

  const refreshTeams = useCallback(async () => {
    try {
      setTeams((await api.listTeams()).teams);
      setTeamsError(null);
    } catch (err) {
      if (isMissingRoute(err)) setTeams("unsupported");
      else setTeamsError("Could not load your teams.");
    }
  }, []);

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

  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => void refreshActivity(), 10_000);
    return () => window.clearInterval(interval);
  }, [session, refreshActivity]);

  if (isPending || !session) {
    return (
      <div className="flex min-h-dvh flex-col">
        <header className={`${PAGE_COLUMN} flex h-16 items-center`}>
          <Brand />
        </header>
        <main className={`${PAGE_COLUMN} flex-1 pt-8`}>
          <p className="text-ink-faint" role="status">
            Loading your dashboard…
          </p>
        </main>
      </div>
    );
  }

  const activeDeviceCount = devices?.filter((device) => device.active).length ?? null;
  const deliveryDeviceCount =
    activeDeviceCount === null || billing?.limits.devices === null
      ? activeDeviceCount
      : Math.min(activeDeviceCount, billing?.limits.devices ?? activeDeviceCount);

  return (
    <div className="flex min-h-dvh flex-col">
      <DashboardHeader>
        {billing?.plan === "pro" ? (
          <button type="button" onClick={() => setPlanOpen(true)} className={primaryButtonSmall}>
            Pro
          </button>
        ) : null}
      </DashboardHeader>

      <main className={`${PAGE_COLUMN} flex-1 pt-6 pb-16`}>
        <AppDownloadBanner />

        <div className="mb-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] leading-[1.15] font-medium tracking-[-0.015em] text-white">
              Services
            </h1>
            <p className="mt-1.5 text-ink-muted">
              {deliveryDeviceCount === null
                ? "Each service gets a secret webhook URL."
                : deliveryDeviceCount === 0
                  ? "No iPhone registered yet — sign in inside the Hark app to receive notifications."
                  : `Delivering to ${deliveryDeviceCount} registered ${deliveryDeviceCount === 1 ? "iPhone" : "iPhones"}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={`${primaryButtonSmall} shrink-0`}
          >
            New service
          </button>
        </div>

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

        {planOpen && billing ? (
          <LegacyProModal billing={billing} onClose={() => setPlanOpen(false)} />
        ) : null}

        <ServiceList
          services={services}
          tokens={apiTokens}
          onEdit={setEditing}
          onRotated={(response) => {
            setReveal({ ...response, kind: "rotated" });
            void refresh();
          }}
          onDeleted={() => void refresh()}
          onTokenRevoked={(id) =>
            setApiTokens((current) => current?.filter((token) => token.id !== id) ?? current)
          }
        />

        <Devices devices={devices} billing={billing} onRemoved={() => void refresh()} />
        <McpClientsSection />

        {teams !== "unsupported" ? (
          <TeamsSection
            error={teamsError}
            onCreated={(team) =>
              setTeams((current) => [...(Array.isArray(current) ? current : []), team])
            }
            teams={teams}
          />
        ) : null}

        <AppsSection
          apps={apps}
          onChanged={(next) =>
            setApps((current) => current?.map((app) => (app.id === next.id ? next : app)) ?? null)
          }
          onRemoved={(id) => setApps((current) => current?.filter((app) => app.id !== id) ?? null)}
          teams={Array.isArray(teams) ? teams : null}
          viewerName={session.user.name}
        />

        <LiveActivities activities={liveActivities} />

        <ActivityLog events={events} onRefresh={refreshActivity} />
      </main>
    </div>
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

/** Hark Pro is no longer sold; existing subscribers keep it and its billing portal. */
function LegacyProModal({ billing, onClose }: { billing: BillingDto; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const close = useCallback(() => {
    if (closing || busy) return;
    setClosing(true);
    window.setTimeout(onClose, 120);
  }, [busy, closing, onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [close]);

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

  const { limits } = billing;
  const rows = [
    limits.devices === null
      ? "Unlimited active iPhones"
      : `${limits.devices} active iPhone${limits.devices === 1 ? "" : "s"}`,
    ...(billing.features.deviceRouting ? ["Route notifications to specific devices"] : []),
    limits.notificationsPerMonth === null
      ? "Unlimited notifications"
      : `${numberFormat.format(limits.notificationsPerMonth)} notifications per month`,
    `${numberFormat.format(limits.servicePerMinute)} requests per minute per service`,
    `${numberFormat.format(limits.accountPerMinute)} requests per minute per account`,
  ];

  return (
    <div className={`hark-modal-backdrop ${closing ? "is-closing" : ""}`}>
      <button
        aria-label="Close plan dialog"
        className="hark-modal-dismiss"
        disabled={busy}
        onClick={close}
        type="button"
      />
      <section
        aria-labelledby="plan-title"
        aria-modal="true"
        className="hark-modal-panel hark-glass hark-glass-strong"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 id="plan-title" className="text-[22px] leading-[1.2] font-medium text-white">
              You're on Hark Pro (legacy)
            </h2>
            <p className="mt-1.5 text-[15px] text-ink-muted">
              Hark Pro is no longer sold. Your plan keeps working as long as you stay subscribed.
            </p>
          </div>
          <button
            aria-label="Close"
            className={closeButton}
            disabled={busy}
            onClick={close}
            type="button"
          >
            ×
          </button>
        </div>

        <ul className="mt-5 space-y-2.5 rounded-2xl border border-line bg-panel p-4">
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

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            disabled={busy || !billing.configured}
            onClick={() => void openPortal()}
            className={primaryButton}
          >
            {busy ? "Opening…" : billing.configured ? "Manage billing" : "Billing unavailable"}
          </button>
        </div>
      </section>
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
    <section className="mt-10 border-t border-line pt-8" aria-labelledby="devices-heading">
      <div className="mb-5">
        <h2
          id="devices-heading"
          className="text-[22px] leading-[1.2] font-medium tracking-[-0.01em] text-white"
        >
          Devices
        </h2>
        <p className="mt-1.5 text-ink-muted">
          {billing?.features.deviceRouting ? (
            <>
              Omit <InlineCode>deviceIds</InlineCode> to notify all active devices, or pass IDs to
              route a webhook to specific ones.
            </>
          ) : (
            "Webhooks, prompts and Live Activities go to your active iPhone."
          )}
        </p>
      </div>
      {devices === null ? <p className="py-4 text-ink-faint">Loading devices…</p> : null}
      {devices?.length === 0 ? <EmptyState title="No iPhones registered yet." /> : null}
      {devices && devices.length > 0 ? (
        <ul className={LIST_PANEL}>
          {devices.map((device) => (
            <li className="flex items-center justify-between gap-4 py-3.5" key={device.id}>
              <div className="min-w-0">
                <p className="truncate font-medium text-white">
                  {device.deviceName ?? "iPhone"}
                  {!device.active ? (
                    <span className="ml-2 text-sm font-normal text-ink-faint">Inactive</span>
                  ) : null}
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

function LiveActivities({ activities }: { activities: LiveActivityDto[] | null }) {
  if (activities === null || activities.length === 0) return null;
  return (
    <section className="mt-10 border-t border-line pt-8" aria-labelledby="live-activities-heading">
      <h2
        id="live-activities-heading"
        className="text-[22px] leading-[1.2] font-medium tracking-[-0.01em] text-white"
      >
        Live Activities
      </h2>
      <ul className={`${LIST_PANEL} mt-5`}>
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
    <section className="mt-10 border-t border-line pt-8" aria-labelledby="activity-heading">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2
            id="activity-heading"
            className="text-[22px] leading-[1.2] font-medium tracking-[-0.01em] text-white"
          >
            Activity
          </h2>
          <p className="mt-1.5 text-ink-muted">Latest webhook delivery attempts.</p>
        </div>
        <button type="button" onClick={() => void onRefresh()} className={rowButton}>
          Refresh
        </button>
      </div>

      {events === null ? <p className="py-4 text-ink-faint">Loading activity…</p> : null}
      {events?.length === 0 ? <EmptyState title="No webhook activity yet." /> : null}
      {events && events.length > 0 ? (
        <ol className={LIST_PANEL}>
          {events.map((activityEvent) => (
            <li className="flex gap-3 py-3.5" key={activityEvent.id}>
              <ActivityAvatar activityEvent={activityEvent} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="truncate leading-5 font-medium text-white">
                    {activityEvent.serviceTitle} · {activityEvent.title}
                  </p>
                  <time
                    className="shrink-0 text-[13px] text-ink-faint"
                    dateTime={activityEvent.createdAt}
                    title={new Date(activityEvent.createdAt).toLocaleString()}
                  >
                    {new Date(activityEvent.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p className="mt-0.5 truncate text-sm leading-5 text-ink-muted">
                  {activityEvent.body}
                </p>
                <p className="mt-0.5 text-[13px] leading-5 text-ink-faint">
                  {activityLabel(activityEvent)}
                  {activityEvent.error ? ` · ${activityEvent.error}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "accepted" || status === "delivered"
      ? "bg-mint"
      : status === "withdrawn"
        ? "bg-info"
        : status === "failed"
          ? "bg-danger-strong"
          : status === "partial" || status === "withdraw_partial"
            ? "bg-warn"
            : status === "processing"
              ? "bg-info"
              : "bg-idle";
  return <span className={`${color} size-2 rounded-full`} aria-hidden="true" />;
}

function ActivityAvatar({ activityEvent }: { activityEvent: EventDto }) {
  return (
    <span className="relative size-9 shrink-0">
      {activityEvent.imageUrl ? (
        <img
          alt=""
          className="size-9 rounded-full object-cover ring-1 ring-white/15"
          src={activityEvent.imageUrl}
        />
      ) : (
        <span className="grid size-9 place-items-center rounded-full bg-white/12 text-sm font-medium text-white">
          {activityEvent.serviceTitle.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="absolute -right-0.5 -bottom-0.5 grid size-3.5 place-items-center rounded-full bg-paper">
        <StatusDot status={activityEvent.status} />
      </span>
    </span>
  );
}

function activityLabel(activityEvent: EventDto): string {
  if (activityEvent.status === "accepted" || activityEvent.status === "delivered") {
    return `Accepted for ${activityEvent.deliveredCount} ${activityEvent.deliveredCount === 1 ? "device" : "devices"}`;
  }
  if (activityEvent.status === "withdrawn") return "Withdrawal requested";
  if (activityEvent.status === "withdraw_partial") return "Withdrawal partially accepted";
  if (activityEvent.status === "partial") {
    return `Partially accepted for ${activityEvent.deliveredCount} devices`;
  }
  if (activityEvent.status === "no_devices") return "No active devices";
  if (activityEvent.status === "processing") return "Processing";
  return "Failed";
}

function ServiceList({
  services,
  tokens,
  onEdit,
  onRotated,
  onDeleted,
  onTokenRevoked,
}: {
  services: ServiceDto[] | null;
  tokens: ApiTokenDto[] | null;
  onEdit: (service: ServiceDto) => void;
  onRotated: (response: ServiceCreatedResponse) => void;
  onDeleted: () => void;
  onTokenRevoked: (id: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const activeTokens = tokens?.filter((token) => token.revokedAt === null) ?? [];

  if (services === null) {
    return <p className="py-4 text-ink-faint">Loading services…</p>;
  }
  if (services.length === 0 && activeTokens.length === 0) {
    return (
      <EmptyState title="No services yet">
        Create your first service to get a secret webhook URL you can POST to from CI, cron jobs, or
        anything else.
      </EmptyState>
    );
  }

  const revokeToken = async (token: ApiTokenDto) => {
    const confirmed = await confirm({
      title: "Revoke agent connection",
      message: `Revoke “${token.name}”? Its token stops working immediately and the agent must sign in again.`,
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(token.id);
    setTokenError(null);
    try {
      await api.revokeApiToken(token.id);
      onTokenRevoked(token.id);
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : "Could not revoke this connection");
    } finally {
      setBusyId(null);
    }
  };

  const rotate = async (svc: ServiceDto) => {
    const confirmed = await confirm({
      title: "Rotate webhook token",
      message: `Rotate the webhook token for “${svc.title}”? The old URL stops working immediately.`,
      confirmLabel: "Rotate token",
    });
    if (!confirmed) return;
    setBusyId(svc.id);
    try {
      onRotated(await api.rotateServiceToken(svc.id));
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
      onDeleted();
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
                onClick={() => onEdit(svc)}
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
        {activeTokens.map((token) => (
          <li key={token.id} className="flex items-center gap-3 py-3.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-panel font-mono text-xs text-mint ring-1 ring-white/15">
              ❯_
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium text-white">
                <span className="truncate">{token.name}</span>
                <span className="shrink-0 rounded-full bg-white/12 px-2 py-0.5 text-xs leading-4 font-normal text-ink">
                  Agent
                </span>
              </p>
              <p className="truncate text-[13px] text-ink-faint" title={token.scopes.join(", ")}>
                {token.prefix}… · {token.scopes.length}{" "}
                {token.scopes.length === 1 ? "scope" : "scopes"} · last used{" "}
                {token.lastUsedAt ? relativeTime(token.lastUsedAt) : "never"}
                {token.expiresAt
                  ? ` · expires ${new Date(token.expiresAt).toLocaleDateString()}`
                  : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busyId === token.id}
                onClick={() => void revokeToken(token)}
                className={rowDangerButton}
              >
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
      {tokenError ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {tokenError}
        </p>
      ) : null}
      {dialog}
    </>
  );
}
