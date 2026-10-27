import { env } from "../env";

/** APP_URL's origin: where Hark's website and dashboard live. */
export function canonicalOrigin(): string {
  return new URL(env.APP_URL).origin;
}

/** Earlier public origins that keep serving the API (see LEGACY_APP_URLS). */
export function legacyOrigins(): string[] {
  return (env.LEGACY_APP_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    })
    .filter((origin) => origin !== canonicalOrigin());
}

/** Every origin Hark answers on as itself. */
export function publicOrigins(): string[] {
  return [canonicalOrigin(), ...legacyOrigins()];
}

export function isPublicOrigin(origin: string | null | undefined): boolean {
  return Boolean(origin) && publicOrigins().includes(origin as string);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The public origin a request arrived on, or the canonical one. Matched by
 * host: behind the tunnel the app sees plain http, while clients use https.
 */
export function requestOrigin(url: string): string {
  const host = hostOf(url);
  return publicOrigins().find((origin) => new URL(origin).host === host) ?? canonicalOrigin();
}

/** True when the request arrived on an earlier public origin. */
export function isLegacyRequest(url: string): boolean {
  const host = hostOf(url);
  return legacyOrigins().some((origin) => new URL(origin).host === host);
}
