import { env } from "../env";

/** Inbox project the operator's alerts are filed under. */
const OPS_PROJECT = "Hark ops";
/** At most one error alert per this window; later errors are counted into the next one. */
const ERROR_ALERT_INTERVAL_MS = 10 * 60 * 1000;
const OPS_TIMEOUT_MS = 5000;

interface OpsMessage {
  title: string;
  body: string;
  summary?: string;
}

/**
 * Sends a notification to the operator through OPS_WEBHOOK_URL, a Hark
 * webhook on their own account. Never throws: alerting must not break the
 * request that triggered it.
 */
export async function notifyOps(message: OpsMessage): Promise<boolean> {
  if (!env.OPS_WEBHOOK_URL || env.NODE_ENV === "test") return false;
  try {
    const response = await fetch(env.OPS_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: message.title.slice(0, 80),
        body: message.body.slice(0, 8000),
        ...(message.summary ? { summary: message.summary.slice(0, 200) } : {}),
        project: OPS_PROJECT,
      }),
      signal: AbortSignal.timeout(OPS_TIMEOUT_MS),
    });
    if (!response.ok) console.error(`[ops] Alert webhook returned ${response.status}`);
    return response.ok;
  } catch (error) {
    console.error("[ops] Alert webhook failed", error);
    return false;
  }
}

let lastErrorAlertAt = 0;
let unreportedErrors = 0;

/** Test hook: forget the throttle window. */
export function resetOpsThrottle(): void {
  lastErrorAlertAt = 0;
  unreportedErrors = 0;
}

/**
 * Tells the operator about an unexpected server error: the first one at once,
 * then at most one alert per ten minutes that also counts the errors since
 * the last alert. `where` must already be safe to show (a redacted path or a
 * job name), never a URL with a credential in it.
 */
export function reportServerError(where: string, error: unknown): void {
  const now = Date.now();
  if (now - lastErrorAlertAt < ERROR_ALERT_INTERVAL_MS) {
    unreportedErrors += 1;
    return;
  }
  const earlier = unreportedErrors;
  lastErrorAlertAt = now;
  unreportedErrors = 0;
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const more = earlier > 0 ? `\n\nPlus ${earlier} more since the last alert.` : "";
  void notifyOps({
    title: "Hark server error",
    body: `${where}\n${text.slice(0, 1000)}${more}\n\nLogs: journalctl CONTAINER_NAME=hark-hark-1 on the host.`,
    summary: `${where}: ${text.slice(0, 120)}`,
  });
}
