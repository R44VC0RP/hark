import type {
  ApiTokenDto,
  BillingDto,
  DeviceDto,
  EventDto,
  LiveActivityDto,
  ServiceCreatedResponse,
  ServiceDto,
} from "@hark/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AppDownloadBanner } from "../components/AppDownloadBanner";
import { useConfirm } from "../components/ConfirmDialog";
import { CopyField } from "../components/CopyField";
import { api } from "../lib/api";
import { signOut, useSession } from "../lib/auth";

function curlExample(webhookUrl: string): string {
  return [
    `curl -X POST ${webhookUrl} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Idempotency-Key: unique-event-id' \\`,
    `  -d '{ "body": "Deploy finished ✅" }'`,
  ].join("\n");
}

function agentPrompt(webhookUrl: string, devices: DeviceDto[]): string {
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
          "Optional Hark Pro routing targets. Omit to notify every active registered device.",
      },
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
    "Omit deviceIds to deliver to all devices. Include one or more IDs to route only to those devices.",
    ...(devices.length > 0
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
  const [billing, setBilling] = useState<BillingDto | null>(null);
  const [billingActivating, setBillingActivating] = useState(
    () => new URLSearchParams(window.location.search).get("billing") === "success",
  );
  const [planOpen, setPlanOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServiceDto | null>(null);
  const [reveal, setReveal] = useState<
    (ServiceCreatedResponse & { kind: "created" | "rotated" }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [svc, dev, tokenState, activity, liveActivityState, billingState] = await Promise.all([
        api.listServices(),
        api.listDevices(),
        api.listApiTokens(),
        api.listEvents(),
        api.listLiveActivities(),
        api.getBilling(),
      ]);
      setServices(svc.services);
      setDevices(dev.devices);
      setApiTokens(tokenState.tokens);
      setEvents(activity.events);
      setLiveActivities(liveActivityState.activities);
      setBilling(billingState);
    } catch {
      setError("Could not load your dashboard data. Please refresh and try again.");
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

  useEffect(() => {
    if (!isPending && !session) {
      navigate("/", { replace: true });
      return;
    }
    if (session) void refresh();
  }, [session, isPending, navigate, refresh]);

  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => void refreshActivity(), 10_000);
    return () => window.clearInterval(interval);
  }, [session, refreshActivity]);

  useEffect(() => {
    if (!session || !billingActivating) return;
    let cancelled = false;
    let attempts = 0;
    let timeout: number | undefined;

    const poll = async () => {
      attempts += 1;
      try {
        const next = await api.getBilling();
        if (cancelled) return;
        setBilling(next);
        if (next.plan === "pro") {
          setBillingActivating(false);
          window.history.replaceState(null, "", "/dashboard");
          return;
        }
      } catch {
        // Autumn can take a moment to receive Stripe's checkout webhook.
      }
      if (!cancelled && attempts < 8) timeout = window.setTimeout(() => void poll(), 2_000);
      else if (!cancelled) setBillingActivating(false);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [session, billingActivating]);

  if (isPending || !session) {
    return <div className="flex min-h-dvh items-center justify-center text-ink-faint">…</div>;
  }

  const activeDeviceCount = devices?.filter((device) => device.active).length ?? null;
  const deliveryDeviceCount =
    activeDeviceCount === null || billing?.limits.devices === null
      ? activeDeviceCount
      : Math.min(activeDeviceCount, billing?.limits.devices ?? activeDeviceCount);

  return (
    <div className="min-h-dvh">
      <header>
        <div className="mx-auto flex h-20 w-full max-w-3xl items-center justify-between px-6">
          <Link to="/" className="text-lg font-semibold">
            Hark
          </Link>
          <div className="flex items-center gap-3">
            <Link className="text-ink-subtle hover:text-ink text-sm transition" to="/docs">
              Docs
            </Link>
            {session.user.image ? (
              <img
                src={session.user.image}
                alt=""
                className="border-media-line size-7 rounded-full border"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <span className="hidden text-sm text-ink-subtle sm:block">{session.user.email}</span>
            <div className="relative">
              <button
                type="button"
                onClick={() => void signOut().then(() => navigate("/"))}
                className="min-h-10 rounded-full border border-line bg-surface pr-3.5 pl-[5.75rem] text-xs font-medium text-ink-muted shadow-xs transition-colors hover:bg-surface-hover"
              >
                Sign out
              </button>
              <button
                type="button"
                disabled={billing === null}
                onClick={() => setPlanOpen(true)}
                className="bg-accent hover:bg-accent-hover absolute inset-y-0 left-0 z-10 min-h-10 rounded-full px-4 text-xs font-semibold text-on-accent shadow-md transition-transform active:scale-[0.96] disabled:opacity-50"
              >
                {billingActivating ? "Activating…" : billing?.plan === "pro" ? "Pro" : "Upgrade"}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <AppDownloadBanner />

        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Services</h1>
            <p className="mt-1 text-sm text-ink-subtle">
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
            className="bg-accent hover:bg-accent-hover rounded-full px-4 py-2 text-sm font-medium text-on-accent transition"
          >
            New service
          </button>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {reveal ? (
          <WebhookReveal
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

        {planOpen ? (
          <PlanModal
            activating={billingActivating}
            billing={billing}
            onClose={() => setPlanOpen(false)}
          />
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

        <LiveActivities activities={liveActivities} />

        <ActivityLog events={events} onRefresh={refreshActivity} />
      </main>
    </div>
  );
}

function WebhookReveal({
  devices,
  reveal,
  onDismiss,
}: {
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
      await navigator.clipboard.writeText(agentPrompt(reveal.webhookUrl, devices));
      setAgentPromptCopied(true);
    } catch {
      // Clipboard access can be unavailable outside a secure context.
    }
  };

  return (
    <section className="mb-10">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-accent-text text-sm font-semibold">
          {reveal.kind === "created"
            ? `“${reveal.service.title}” is ready`
            : `New webhook URL for “${reveal.service.title}”`}
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          className="text-accent-text text-xs font-medium underline-offset-2 hover:underline"
        >
          Done
        </button>
      </div>
      <p className="text-accent-text mb-4 text-xs">
        This URL is encrypted at rest and remains available from your service's copy button.
      </p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <CopyField label="Webhook URL" value={reveal.webhookUrl} />
        </div>
        <button
          type="button"
          onClick={copyAgentPrompt}
          className="bg-accent hover:bg-accent-hover shrink-0 self-start rounded-full px-4 py-2 text-sm font-medium text-on-accent transition sm:self-auto"
        >
          {agentPromptCopied ? "Agent prompt copied" : "Copy agent prompt"}
        </button>
      </div>
    </section>
  );
}

function PlanModal({
  billing,
  activating,
  onClose,
}: {
  billing: BillingDto | null;
  activating: boolean;
  onClose: () => void;
}) {
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

  const redirectToBilling = async (kind: "checkout" | "portal") => {
    setBusy(true);
    setError(null);
    try {
      const response =
        kind === "checkout" ? await api.startCheckout() : await api.openBillingPortal();
      window.location.assign(response.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing");
      setBusy(false);
    }
  };

  return (
    <div className={`hark-modal-backdrop ${closing ? "is-closing" : ""}`}>
      <button
        aria-label="Close plans dialog"
        className="hark-modal-dismiss"
        disabled={busy}
        onClick={close}
        type="button"
      />
      <section
        aria-labelledby="plans-title"
        aria-modal="true"
        className="hark-modal-panel hark-plan-panel"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-accent-text text-xs font-medium uppercase">Plans</p>
            <h2 id="plans-title" className="mt-1 text-xl font-semibold">
              Choose how far Hark can reach.
            </h2>
            <p className="mt-1 text-sm text-ink-subtle">
              Start free, then upgrade when you need more devices or volume.
            </p>
          </div>
          <button
            aria-label="Close"
            className="grid size-10 shrink-0 place-items-center rounded-full text-xl leading-none text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink-muted active:scale-[0.96]"
            disabled={busy}
            onClick={close}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <PlanTier
            current={billing?.plan === "free"}
            description="Everything a personal webhook setup needs."
            features={[
              "1 active iPhone",
              "10,000 notifications per month",
              "60 requests per minute per service",
              "300 requests per minute per account",
            ]}
            name="Free"
            price="$0"
          />
          <PlanTier
            current={billing?.plan === "pro"}
            description="For more devices and busier automations."
            featured
            features={[
              "Unlimited active iPhones",
              "Route notifications to specific devices",
              "100,000 notifications per month",
              "300 requests per minute per service",
              "1,500 requests per minute per account",
            ]}
            name="Pro"
            price="$8"
            priceSuffix="/ month"
          />
        </div>

        {activating ? (
          <p className="bg-accent-soft text-accent-text mt-4 rounded-xl px-4 py-3 text-sm font-medium">
            Payment received. Activating your Pro entitlements…
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-faint">Cancel anytime.</p>
          <button
            type="button"
            disabled={busy || billing === null || !billing.configured || activating}
            onClick={() => void redirectToBilling(billing?.plan === "pro" ? "portal" : "checkout")}
            className="bg-accent hover:bg-accent-hover min-h-11 rounded-full px-5 text-sm font-semibold text-on-accent transition-transform active:scale-[0.96] disabled:opacity-50"
          >
            {busy
              ? "Opening…"
              : activating
                ? "Activating…"
                : billing?.configured === false
                  ? "Billing unavailable"
                  : billing?.plan === "pro"
                    ? "Manage billing"
                    : "Upgrade to Pro · $8/month"}
          </button>
        </div>
      </section>
    </div>
  );
}

function PlanTier({
  name,
  price,
  priceSuffix,
  description,
  features,
  current,
  featured,
}: {
  name: string;
  price: string;
  priceSuffix?: string;
  description: string;
  features: string[];
  current: boolean;
  featured?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border p-4 ${
        featured ? "border-accent bg-accent-wash" : "border-line bg-surface-muted"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className={`text-sm font-semibold ${featured ? "text-accent-text" : ""}`}>{name}</h3>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {price}
            {priceSuffix ? (
              <span className="ml-1 text-xs font-normal text-ink-faint">{priceSuffix}</span>
            ) : null}
          </p>
        </div>
        {current ? (
          <span className="bg-accent-soft text-accent-text rounded-full px-2 py-1 text-[11px] font-semibold">
            Current
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-5 text-ink-subtle">{description}</p>
      <ul className="mt-4 space-y-2.5">
        {features.map((feature) => (
          <li className="flex gap-2 text-xs leading-4 text-ink-muted" key={feature}>
            <span className="bg-accent mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
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
    <section className="mt-16" aria-labelledby="devices-heading">
      <div className="mb-4">
        <h2 id="devices-heading" className="text-lg font-semibold">
          Devices
        </h2>
        <p className="mt-1 text-sm text-ink-subtle">
          Omit <code className="font-mono text-xs text-ink-muted">deviceIds</code> to notify all
          active devices. Pro can route a webhook to specific IDs.
        </p>
      </div>
      {devices === null ? <p className="py-6 text-sm text-ink-faint">Loading devices…</p> : null}
      {devices?.length === 0 ? (
        <p className="border-y border-line py-8 text-sm text-ink-faint">
          No iPhones registered yet.
        </p>
      ) : null}
      {devices && devices.length > 0 ? (
        <ul className="divide-y divide-line border-y border-line">
          {devices.map((device) => (
            <li className="flex items-center justify-between gap-4 py-3" key={device.id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {device.deviceName ?? "iPhone"}
                  {!device.active ? (
                    <span className="ml-2 text-xs text-ink-faint">Inactive</span>
                  ) : null}
                </p>
                <p className="truncate font-mono text-[11px] text-ink-faint">{device.id}</p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
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
                  className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-hover"
                >
                  Copy ID
                </button>
                <button
                  type="button"
                  disabled={busyId === device.id}
                  onClick={() => void remove(device)}
                  className="rounded-full border border-danger-line px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {billing?.plan === "free" && activeDevices.length >= 1 ? (
        <p className="mt-3 text-xs text-ink-faint">
          Free includes one active iPhone. Upgrade to Pro before registering another.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
      {dialog}
    </section>
  );
}

function relativeTime(iso: string): string {
  const deltaMinutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes} minute${deltaMinutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(deltaMinutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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

  const inputClass =
    "focus:border-accent w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-base text-ink placeholder:text-ink-faint focus:outline-none sm:text-sm";

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
        className="hark-modal-panel"
        onSubmit={submit}
        role="dialog"
      >
        <div className="mb-6 flex items-start justify-between gap-6">
          <div>
            <h2 id="service-form-title" className="text-lg font-semibold">
              {service ? "Edit service" : "New service"}
            </h2>
            <p className="mt-1 text-sm text-ink-subtle">
              {service ? "Update this webhook's defaults." : "Set the defaults for this webhook."}
            </p>
          </div>
          <button
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-full text-xl leading-none text-ink-faint transition hover:bg-surface-hover hover:text-ink-muted"
            disabled={busy}
            onClick={() => close()}
            type="button"
          >
            ×
          </button>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-subtle">
              Title (sender name)
            </span>
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
            <span className="mb-1.5 block text-xs font-medium text-ink-subtle">
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
            <span className="mb-1.5 block text-xs font-medium text-ink-subtle">
              Destination URL <span className="font-normal">(optional, opened on tap)</span>
            </span>
            <input
              className={inputClass}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/dashboard"
            />
            <span className="mt-1.5 block text-xs text-ink-faint">
              Supports web URLs, app deep links, and shortcuts://run-shortcut URLs.
            </span>
          </label>
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => close()}
            className="rounded-full px-4 py-2 text-sm font-medium text-ink-subtle transition hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || title.trim().length === 0}
            className="bg-accent hover:bg-accent-hover rounded-full px-4 py-2 text-sm font-medium text-on-accent transition disabled:opacity-50"
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
    <section className="mt-16" aria-labelledby="live-activities-heading">
      <h2 id="live-activities-heading" className="text-lg font-semibold">
        Live Activities
      </h2>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {activities.map((activity) => (
          <li className="flex items-center justify-between gap-4 py-3" key={activity.id}>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{activity.props.title}</p>
              <p className="truncate text-xs text-ink-subtle">{activity.props.status}</p>
            </div>
            <p className="shrink-0 font-mono text-[11px] text-ink-faint">
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
    <section className="mt-16" aria-labelledby="activity-heading">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 id="activity-heading" className="text-lg font-semibold">
            Activity
          </h2>
          <p className="mt-1 text-sm text-ink-subtle">Latest webhook delivery attempts.</p>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-ink-subtle transition hover:bg-surface-hover hover:text-ink"
        >
          Refresh
        </button>
      </div>

      {events === null ? <p className="py-6 text-sm text-ink-faint">Loading activity…</p> : null}
      {events?.length === 0 ? (
        <p className="border-t border-line py-8 text-sm text-ink-faint">No webhook activity yet.</p>
      ) : null}
      {events && events.length > 0 ? (
        <ol className="divide-y divide-line border-y border-line">
          {events.map((activityEvent) => (
            <li className="flex gap-2.5 py-3" key={activityEvent.id}>
              <ActivityAvatar activityEvent={activityEvent} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="truncate text-sm leading-5 font-medium">
                    {activityEvent.serviceTitle} · {activityEvent.title}
                  </p>
                  <time
                    className="shrink-0 text-xs text-ink-faint"
                    dateTime={activityEvent.createdAt}
                    title={new Date(activityEvent.createdAt).toLocaleString()}
                  >
                    {new Date(activityEvent.createdAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p className="mt-0.5 truncate text-xs leading-4 text-ink-subtle">
                  {activityEvent.body}
                </p>
                <p className="mt-0.5 text-[11px] leading-4 text-ink-faint">
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
      ? "bg-accent"
      : status === "failed"
        ? "bg-danger-strong"
        : status === "partial"
          ? "bg-warn"
          : status === "processing"
            ? "bg-info"
            : "bg-idle";
  return <span className={`${color} size-2 rounded-full`} aria-hidden="true" />;
}

function ActivityAvatar({ activityEvent }: { activityEvent: EventDto }) {
  return (
    <span className="relative size-8 shrink-0">
      {activityEvent.imageUrl ? (
        <img
          alt=""
          className="border-media-line size-8 rounded-full border object-cover"
          src={activityEvent.imageUrl}
        />
      ) : (
        <span className="bg-accent-soft text-accent-text grid size-8 place-items-center rounded-full text-xs font-medium">
          {activityEvent.serviceTitle.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="absolute -right-0.5 -bottom-0.5 grid size-3 place-items-center rounded-full bg-surface">
        <StatusDot status={activityEvent.status} />
      </span>
    </span>
  );
}

function activityLabel(activityEvent: EventDto): string {
  if (activityEvent.status === "accepted" || activityEvent.status === "delivered") {
    return `Accepted for ${activityEvent.deliveredCount} ${activityEvent.deliveredCount === 1 ? "device" : "devices"}`;
  }
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
    return <div className="py-12 text-center text-sm text-ink-faint">Loading…</div>;
  }
  if (services.length === 0 && activeTokens.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong py-14 text-center">
        <p className="text-sm font-medium text-ink-muted">No services yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-faint">
          Create your first service to get a secret webhook URL you can POST to from CI, cron jobs,
          or anything else.
        </p>
      </div>
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
      <ul className="divide-y divide-line border-y border-line">
        {services.map((svc) => (
          <li key={svc.id} className="flex items-center gap-3 py-3">
            {svc.imageUrl ? (
              <img
                src={svc.imageUrl}
                alt=""
                className="border-media-line size-8 shrink-0 rounded-full border object-cover"
              />
            ) : (
              <div className="bg-accent flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-on-accent">
                {svc.title.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{svc.title}</p>
              <p className="truncate text-xs text-ink-faint">
                {svc.url ?? "No destination URL"} · created{" "}
                {new Date(svc.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={!svc.webhookUrl}
                title={
                  svc.webhookUrl
                    ? "Copy webhook URL"
                    : "Rotate this legacy token once to make its URL copyable"
                }
                onClick={() => void copy(svc)}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-disabled"
              >
                {copiedId === svc.id ? "Copied" : "Copy webhook"}
              </button>
              <button
                type="button"
                disabled={busyId === svc.id}
                onClick={() => onEdit(svc)}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busyId === svc.id}
                onClick={() => void rotate(svc)}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-surface-hover disabled:opacity-50"
              >
                Rotate token
              </button>
              <button
                type="button"
                disabled={busyId === svc.id}
                onClick={() => void remove(svc)}
                className="rounded-full border border-danger-line px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {activeTokens.map((token) => (
          <li key={token.id} className="flex items-center gap-3 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted font-mono text-[11px] font-semibold text-accent-text">
              ❯_
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <span className="truncate">{token.name}</span>
                <span className="shrink-0 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] font-medium leading-4 text-ink-muted">
                  Agent
                </span>
              </p>
              <p className="truncate text-xs text-ink-faint" title={token.scopes.join(", ")}>
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
                className="rounded-full border border-danger-line px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
              >
                Revoke
              </button>
            </div>
          </li>
        ))}
      </ul>
      {tokenError ? <p className="mt-3 text-xs text-danger">{tokenError}</p> : null}
      {dialog}
    </>
  );
}
