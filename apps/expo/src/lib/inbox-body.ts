import { tapDestinationUrlSchema } from "@hark/contracts";
import { Alert, Linking } from "react-native";

/**
 * Plaintext body rendering for notification detail. The body is split into
 * text and link segments; nothing is ever interpreted as HTML and links are
 * revalidated at tap time, so stored content can never smuggle an executable
 * or local-content scheme past ingestion-time validation.
 */

export interface BodySegment {
  text: string;
  /** Present when the segment is a tappable link. */
  url?: string;
}

// Conservative URL matcher: an explicit scheme followed by `://`. Trailing
// punctuation that commonly ends a sentence is not treated as part of the URL.
const URL_PATTERN = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>]+$/;

/** Splits a plaintext body into text and validated link segments. */
export function linkifyBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const index = match.index ?? 0;
    const trimmed = raw.replace(TRAILING_PUNCTUATION, "");
    // Only linkify destinations that pass the shared tap-destination rules.
    if (!tapDestinationUrlSchema.safeParse(trimmed).success) continue;
    if (index > lastIndex) segments.push({ text: body.slice(lastIndex, index) });
    segments.push({ text: trimmed, url: trimmed });
    lastIndex = index + trimmed.length;
  }
  if (lastIndex < body.length) segments.push({ text: body.slice(lastIndex) });
  return segments.length > 0 ? segments : [{ text: body }];
}

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Schemes that re-enter Hark itself (or the Expo dev launcher). A tap URL or
 * web page must never drive the app's own routes or point a dev build at a
 * remote bundle, so these are dropped outright.
 */
const SELF_SCHEMES = new Set(["hark:", "ceo.ryan.hark:", "exp+hark:", "exp:", "exps:"]);
const DEV_LAUNCHER_HOST = "expo-development-client";

/** True for URLs that point back into Hark or at the Expo dev launcher. */
export function isSelfUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      SELF_SCHEMES.has(url.protocol.toLowerCase()) ||
      url.hostname.toLowerCase() === DEV_LAUNCHER_HOST
    );
  } catch {
    return false;
  }
}

/**
 * Short, human-readable destination: the host for http(s), otherwise the
 * scheme plus host (e.g. `shortcuts://run-shortcut`). Null when unparseable.
 */
export function linkDestinationLabel(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.host;
    return url.host ? `${url.protocol}//${url.host}` : url.protocol;
  } catch {
    return null;
  }
}

export interface OpenBodyLinkRuntime {
  openUrl: (url: string) => Promise<unknown>;
  /** Asks before leaving Hark; `label` is the destination host or scheme. */
  confirm: (url: string, label: string) => Promise<boolean>;
}

async function confirmWithAlert(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert("Open in another app?", url, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Open", onPress: () => resolve(true) },
    ]);
  });
}

const defaultRuntime: OpenBodyLinkRuntime = {
  openUrl: (url) => Linking.openURL(url),
  confirm: confirmWithAlert,
};

/**
 * The one policy for every link that leaves Hark (body links, push taps, the
 * "Open link" button and web-app navigations). The URL is revalidated at tap
 * time; dangerous schemes stay blocked, links back into Hark are dropped,
 * http(s) opens directly unless `confirmHttp` is set, and any other scheme
 * (custom app links) requires an explicit user confirmation.
 */
export async function openExternalLink(
  url: string,
  runtime: OpenBodyLinkRuntime = defaultRuntime,
  options: { confirmHttp?: boolean } = {},
): Promise<boolean> {
  const validated = tapDestinationUrlSchema.safeParse(url);
  if (!validated.success) return false;
  const label = linkDestinationLabel(validated.data);
  if (!label) return false;
  if (isSelfUrl(validated.data)) {
    console.warn(`Hark ignored a link back into the app (${label})`);
    return false;
  }
  if (options.confirmHttp || !isHttpUrl(validated.data)) {
    const approved = await runtime.confirm(validated.data, label);
    if (!approved) return false;
  }
  await runtime.openUrl(validated.data).catch(() => {});
  return true;
}

/** Opens a link found inside body text. */
export function openBodyLink(
  url: string,
  runtime: OpenBodyLinkRuntime = defaultRuntime,
): Promise<boolean> {
  return openExternalLink(url, runtime);
}

/**
 * Opens the notification's own top-level destination (push tap or the
 * "Open link" button) with the same rules as body links.
 */
export function openTopLevelDestination(
  url: string,
  runtime: OpenBodyLinkRuntime = defaultRuntime,
): Promise<boolean> {
  return openExternalLink(url, runtime);
}

/**
 * Maps a push `eventId` to the composite detail-route ID. Agent notification
 * IDs are prefixed `anot`; everything else originated as a webhook event.
 */
export function compositeIdForPushEvent(eventId: string): string {
  return eventId.startsWith("anot") ? `notification:${eventId}` : `event:${eventId}`;
}
