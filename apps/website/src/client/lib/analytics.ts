import type { ClientAnalyticsEventInput, ClientAnalyticsEventName } from "@hark/contracts";

const ANONYMOUS_ID_KEY = "hark.analytics.anonymousId";
const SESSION_ID_KEY = "hark.analytics.sessionId";
const ATTRIBUTION_KEY = "hark.analytics.firstTouch";
export const AUTH_PENDING_KEY = "hark.analytics.authPending";

type Properties = NonNullable<ClientAnalyticsEventInput["properties"]>;

function id(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function storedId(key: string, session = false): string {
  try {
    const storage = session ? window.sessionStorage : window.localStorage;
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = id();
    storage.setItem(key, created);
    return created;
  } catch {
    return id();
  }
}

/** Dynamic routes whose segments identify a person, a team or an invite code. */
const DYNAMIC_ROUTES: Array<[RegExp, string]> = [
  [/^\/join(\/|$)/, "/join/:code"],
  [/^\/dashboard\/teams(\/|$)/, "/dashboard/teams/:teamId"],
  [/^\/web(\/|$)/, "/web/:id"],
];
const STATIC_ROUTES = new Set([
  "/",
  "/dashboard",
  "/cli/authorize",
  "/docs",
  "/pricing",
  "/a/launched",
  "/privacy",
  "/terms",
  "/oauth/consent",
]);

/**
 * The route pattern for a path, so analytics never store invite codes or ids.
 * Paths that match no route are recorded as `/*`.
 */
export function routePattern(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (STATIC_ROUTES.has(path)) return path;
  for (const [pattern, route] of DYNAMIC_ROUTES) {
    if (pattern.test(path)) return route;
  }
  return "/*";
}

export function markAuthPending(provider: "apple" | "google"): void {
  try {
    sessionStorage.setItem(AUTH_PENDING_KEY, provider);
  } catch {
    // Authentication must still work when browser storage is unavailable.
  }
}

export function consumeAuthPending(): "apple" | "google" | undefined {
  try {
    const provider = sessionStorage.getItem(AUTH_PENDING_KEY);
    if (provider !== "apple" && provider !== "google") return undefined;
    sessionStorage.removeItem(AUTH_PENDING_KEY);
    return provider;
  } catch {
    return undefined;
  }
}

function label(value: string | null): string | undefined {
  const normalized = value?.trim().slice(0, 64);
  return normalized || undefined;
}

function firstTouch(): Properties {
  try {
    const existing = localStorage.getItem(ATTRIBUTION_KEY);
    if (existing) {
      const parsed = JSON.parse(existing) as Record<string, unknown>;
      return {
        source: typeof parsed.source === "string" ? label(parsed.source) : "direct",
        medium: typeof parsed.medium === "string" ? label(parsed.medium) : undefined,
        campaign: typeof parsed.campaign === "string" ? label(parsed.campaign) : undefined,
        content: typeof parsed.content === "string" ? label(parsed.content) : undefined,
        term: typeof parsed.term === "string" ? label(parsed.term) : undefined,
        referrerHost:
          typeof parsed.referrerHost === "string" ? label(parsed.referrerHost) : undefined,
      };
    }

    const query = new URLSearchParams(window.location.search);
    let referrerHost: string | undefined;
    if (document.referrer) {
      const referrer = new URL(document.referrer);
      if (referrer.origin !== window.location.origin) referrerHost = label(referrer.hostname);
    }
    const attribution: Properties = {
      source: label(query.get("utm_source")) ?? referrerHost ?? "direct",
      medium: label(query.get("utm_medium")),
      campaign: label(query.get("utm_campaign")),
      content: label(query.get("utm_content")),
      term: label(query.get("utm_term")),
      referrerHost,
    };
    localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution));
    return attribution;
  } catch {
    return { source: "direct" };
  }
}

export function trackWebEvent(
  name: ClientAnalyticsEventName,
  input: Pick<ClientAnalyticsEventInput, "path" | "outcome"> & { properties?: Properties } = {},
): void {
  const payload: ClientAnalyticsEventInput = {
    eventId: id(),
    anonymousId: storedId(ANONYMOUS_ID_KEY),
    sessionId: storedId(SESSION_ID_KEY, true),
    surface: "web",
    name,
    ...input,
    ...(input.path ? { path: routePattern(input.path) } : {}),
    properties: { ...firstTouch(), ...input.properties },
  };
  void fetch("/api/analytics/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}
