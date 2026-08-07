/**
 * Single source of truth for the docs sidebar *and* the in-page headings.
 *
 * Content components render their heading text from this list by id, so a
 * sidebar label and the section it points at can never drift apart, and a typo
 * in an anchor id is a type error rather than a dead link.
 */
export const DOC_NAV = [
  {
    id: "quickstart",
    label: "Quickstart",
    items: [
      { id: "what-hark-is", label: "What Hark is" },
      { id: "create-a-service", label: "Create a service" },
      { id: "webhook-url", label: "Copy the webhook URL" },
      { id: "first-notification", label: "Send a notification" },
      { id: "quickstart-response", label: "Read the response" },
    ],
  },
  {
    id: "notification-api",
    label: "Notification API",
    items: [
      { id: "notification-endpoint", label: "Endpoint" },
      { id: "notification-payload", label: "Request payload" },
      { id: "tap-destinations", label: "Deep links and Shortcuts" },
      { id: "notification-idempotency", label: "Idempotency" },
      { id: "device-routing", label: "Device routing" },
      { id: "rate-limits", label: "Rate limits" },
      { id: "notification-response", label: "Response shape" },
      { id: "interactive-responses", label: "Interactive responses" },
      { id: "response-status", label: "Read and cancel" },
      { id: "response-callbacks", label: "Callbacks" },
    ],
  },
  {
    id: "activity-api",
    label: "Activity API",
    items: [
      { id: "activity-start", label: "Start an activity" },
      { id: "activity-update", label: "Update an activity" },
      { id: "activity-end", label: "End an activity" },
      { id: "activity-fields", label: "Fields and appearance" },
      { id: "activity-lifetime", label: "Expiry and staleness" },
      { id: "activity-conflicts", label: "One per device" },
      { id: "activity-alerts", label: "Alerts and priority" },
    ],
  },
  {
    id: "cli",
    label: "harkctl CLI",
    items: [
      { id: "cli-install", label: "Install and sign in" },
      { id: "cli-permissions", label: "Route agent permissions" },
      { id: "cli-service", label: "Create a webhook service" },
      { id: "cli-notify", label: "Send a notification" },
      { id: "cli-ask", label: "Ask a question" },
      { id: "cli-activity", label: "Drive a Live Activity" },
      { id: "cli-scripting", label: "Scripting and exit codes" },
    ],
  },
] as const;

type DocNavSection = (typeof DOC_NAV)[number];

/** Ids of the three top-level sections. */
export type DocSectionId = DocNavSection["id"];
/** Ids of every nested anchor. */
export type DocItemId = DocNavSection["items"][number]["id"];
export type DocAnchorId = DocSectionId | DocItemId;

/** Every anchor in document order, used by the scrollspy. */
export const DOC_ANCHOR_IDS: DocAnchorId[] = DOC_NAV.flatMap((section) => [
  section.id,
  ...section.items.map((item) => item.id),
]);

const LABELS = new Map<string, string>(
  DOC_NAV.flatMap((section) => [
    [section.id, section.label] as const,
    ...section.items.map((item) => [item.id, item.label] as const),
  ]),
);

export function docLabel(id: DocAnchorId): string {
  return LABELS.get(id) ?? id;
}
