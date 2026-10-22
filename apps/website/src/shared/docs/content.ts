/**
 * The docs prose, as data.
 *
 * This module is the single source of truth for everything on `/docs`. Two
 * consumers read it and neither owns any prose of its own:
 *
 * - `src/client/pages/docs/blocks.tsx` renders it as React (browser + the
 *   build-time prerender that puts the same HTML in the initial response).
 * - `src/shared/docs/markdown.ts` serialises it for `/docs.md` and `/agents.md`.
 *
 * Inline formatting inside every string is a tiny markdown subset — `` `code` ``
 * and `[text](href)` — parsed by `./inline.ts` for the React renderer and passed
 * through verbatim by the markdown serialiser. Keeping the source markdown-ish
 * means the two outputs cannot drift, and adding a section is a data edit.
 *
 * Headings are *not* stored here: they come from `./nav.ts` by id, so the
 * sidebar, the in-page headings, and the markdown outline always agree.
 */
import type { DocItemId, DocSectionId } from "./nav";

/** Placeholder webhook URL used throughout the docs samples. */
export const EXAMPLE_ENDPOINT = "https://hark.ryan.ceo/hooks/whk_your_token";

export interface DocFieldRow {
  name: string;
  type: string;
  detail: string;
}

export interface DocRouteRow {
  method: string;
  path: string;
  detail: string;
}

export interface DocPlanRow {
  limit: string;
  free: string;
  pro: string;
}

export type DocTableBlock =
  | { kind: "table"; variant: "field"; caption: string; rows: DocFieldRow[] }
  /** Same shape as `field`, headed "Flag" for CLI options. */
  | { kind: "table"; variant: "flag"; caption: string; rows: DocFieldRow[] }
  | { kind: "table"; variant: "route"; caption: string; rows: DocRouteRow[] }
  | { kind: "table"; variant: "plan"; caption: string; rows: DocPlanRow[] };

export type DocBlock =
  | { kind: "p"; text: string }
  /** Callout for a caveat that would get lost in a paragraph. */
  | { kind: "note"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "code"; language: "bash" | "json"; code: string }
  /** A copyable single-line value, rendered as a code block in markdown. */
  | { kind: "copy"; label: string; value: string }
  /** Illustrated gallery of the Live Activity layout styles. */
  | { kind: "stylePreviews"; styles: DocStylePreview[] }
  | DocTableBlock;

export interface DocStylePreview {
  name: string;
  description: string;
  /** Maintainers remove this fallback after adding the native simulator capture. */
  nativeScreenshot?: false;
}

export interface DocSubsection {
  id: DocItemId;
  /** Marks a capability that requires a paid Hark Pro plan. */
  pro?: true;
  blocks: DocBlock[];
}

export interface DocSection {
  id: DocSectionId;
  pro?: true;
  /** Intro paragraph shown above the first subsection. */
  lead: string;
  subsections: DocSubsection[];
}

/** Page title, reused by the HTML `<h1>`, the prerendered `<title>`, and the markdown. */
export const DOCS_TITLE = "Webhooks to iPhone notifications";
export const DOCS_URL = "https://hark.ryan.ceo/docs";
export const DOCS_MARKDOWN_URL = "https://hark.ryan.ceo/docs.md";
export const AGENT_OPENAPI_URL = "https://hark.ryan.ceo/api/agent/openapi.json";

/** The remote MCP server. */
export const MCP_SERVER_URL = "https://hark.ryan.ceo/mcp";

export const DOC_CONTENT: DocSection[] = [
  {
    id: "quickstart",
    lead: "Hark turns an HTTP request into a source-branded iPhone notification. Create a service, then POST JSON to its secret webhook URL.",
    subsections: [
      {
        id: "what-hark-is",
        blocks: [
          {
            kind: "p",
            text: "Anything that can send an HTTP request can notify your phone: CI jobs, coding agents, cron scripts, monitors. Each service carries its own name, avatar, and tap destination, and Hark fills in any field you omit from those service defaults.",
          },
          {
            kind: "p",
            text: "There are two APIs, both authenticated by the same webhook token. The Notification API sends one-shot pushes and optional approval prompts. The Activity API drives a stateful Live Activity on the Lock Screen and in the Dynamic Island.",
          },
        ],
      },
      {
        id: "create-a-service",
        blocks: [
          {
            kind: "steps",
            items: [
              "Sign in at [hark.ryan.ceo](https://hark.ryan.ceo).",
              "Register your iPhone with [Hark for iPhone](https://apps.apple.com/us/app/hark-developer-notifications/id6794121509).",
              "Create a service in the dashboard and give it a title, avatar, and tap URL.",
              "Copy the secret webhook URL it returns.",
            ],
          },
        ],
      },
      {
        id: "webhook-url",
        blocks: [
          {
            kind: "p",
            text: "The plaintext token is shown when the service is created and whenever you rotate it. Treat it as a credential: anyone holding it can notify your devices.",
          },
          { kind: "copy", label: "Webhook URL", value: EXAMPLE_ENDPOINT },
          {
            kind: "p",
            text: 'An unknown or rotated token returns `404` with `{ "ok": false, "error": "Unknown webhook" }`.',
          },
        ],
      },
      {
        id: "first-notification",
        blocks: [
          {
            kind: "p",
            text: "Only `body` is required. Everything else falls back to the service defaults.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST ${EXAMPLE_ENDPOINT} \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: deploy-184-production' \\
  -d '{
    "body": "Production deployed successfully.",
    "title": "GitHub",
    "imageUrl": "https://github.com/github.png",
    "url": "https://github.com/acme/app/actions"
  }'`,
          },
        ],
      },
      {
        id: "quickstart-response",
        blocks: [
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1
}`,
          },
          {
            kind: "p",
            text: "`eventId` identifies the event in the dashboard activity log and, for interactive notifications, is the handle used to read or cancel the pending response. `delivered` is the number of push requests accepted by Expo.",
          },
          {
            kind: "note",
            text: "A request with no registered device still succeeds with `delivered: 0` and a `message` field, so an unpaired phone never fails your build.",
          },
        ],
      },
    ],
  },
  {
    id: "notification-api",
    lead: "One-shot pushes, delivered to every registered iPhone or to the devices you name. The webhook token in the URL is the only credential.",
    subsections: [
      {
        id: "notification-endpoint",
        blocks: [
          {
            kind: "table",
            variant: "route",
            caption: "Notification API routes",
            rows: [
              { method: "POST", path: "/hooks/:token", detail: "Send a notification." },
              {
                method: "GET",
                path: "/hooks/:token/events/:eventId",
                detail: "Read the state of an interactive response.",
              },
              {
                method: "POST",
                path: "/hooks/:token/events/:eventId/cancel",
                detail: "Withdraw a pending interactive response.",
              },
              {
                method: "POST",
                path: "/hooks/:token/events/:eventId/withdraw",
                detail: "Request removal of a delivered notification.",
              },
            ],
          },
          {
            kind: "p",
            text: "Send `Content-Type: application/json`. An unrecognised token returns `404`; a payload that fails validation returns `400` with an `issues` array describing each field.",
          },
        ],
      },
      {
        id: "notification-payload",
        blocks: [
          {
            kind: "table",
            variant: "field",
            caption: "Notification request fields",
            rows: [
              {
                name: "body",
                type: "string, required",
                detail:
                  "Notification message, 1 to 8,000 characters (at most 16 KiB of UTF-8) after trimming. Interactive requests with `response` keep the 2,000-character limit.",
              },
              {
                name: "title",
                type: "string",
                detail: "Sender-name override, up to 80 characters. Defaults to the service title.",
              },
              {
                name: "imageUrl",
                type: "string",
                detail:
                  "Public HTTPS avatar URL, up to 2,048 characters. localhost, .local, loopback, link-local and private IP ranges are rejected.",
              },
              {
                name: "url",
                type: "string",
                detail:
                  "Web URL, universal link, app deep link, or Shortcuts URL opened when the notification is tapped. Up to 2,048 characters.",
              },
              {
                name: "deviceIds",
                type: "string[], Pro",
                detail:
                  "1 to 50 device IDs from the dashboard. Omit to notify every active device.",
              },
              {
                name: "response",
                type: "object",
                detail: "Turns the notification into an approval, yes/no, or text prompt.",
              },
              {
                name: "project",
                type: "string",
                detail:
                  "Project display name, up to 80 characters. Files the notification into that project in the Hark app inbox, creating it on first use.",
              },
              {
                name: "summary",
                type: "string",
                detail:
                  "Short digest, up to 500 characters. Replaces the body in the push banner and list previews; the full body stays readable in the app.",
              },
              {
                name: "bodyFormat",
                type: "enum",
                detail:
                  "`text` or `markdown`. Stored metadata describing the body; omitted means `text`.",
              },
              {
                name: "appId",
                type: "string",
                detail:
                  "A [web app](https://hark.ryan.ceo/docs#web-apps) ID (`app_…`) on your account. Tapping opens that app in Hark, at `url` when given; `url` must then share the app's origin. Not combinable with `response`.",
              },
            ],
          },
        ],
      },
      {
        id: "notification-projects",
        blocks: [
          {
            kind: "p",
            text: "Send an optional `project` display name to group notifications in the Hark app inbox. Project identity is case-insensitive and Unicode-normalized within your account, so `Acme App` and `acme app` are the same project; the first spelling you send becomes the display name. Notifications without a project land in a shared Other bucket.",
          },
          {
            kind: "p",
            text: "Long bodies stay intact in storage and in the app's notification detail, while the push banner and list rows show the `summary` when you provide one, or a bounded preview otherwise. Bodies render as plain text with tappable links; `bodyFormat` is recorded for future rendering and does not change V1 display.",
          },
          {
            kind: "note",
            text: "Accounts hold up to 500 projects. Once the cap is reached, a request naming a new project still delivers — the notification is stored without a project and the response carries an explanatory `message`. Existing project names keep resolving normally.",
          },
        ],
      },
      {
        id: "notification-withdrawal",
        blocks: [
          {
            kind: "p",
            text: "Keep the `eventId` returned when you send a notification, then use it to request removal of that notification from the account's registered iPhones.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST \\
  '${EXAMPLE_ENDPOINT}/events/evt_Cxns2IdbF4H0TJYq/withdraw'`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "status": "withdrawn",
  "accepted": 1
}`,
          },
          {
            kind: "note",
            text: "`accepted` means Expo accepted the silent removal command; it does not guarantee that iOS ran it. Background delivery is best effort and may be delayed or skipped, particularly after the user force-quits Hark. The same webhook token must own the event. Repeating a completed withdrawal is idempotent and does not send another command.",
          },
        ],
      },
      {
        id: "tap-destinations",
        blocks: [
          {
            kind: "p",
            text: "Set `url` per notification or as the service default. Hark opens it only after the recipient explicitly taps the notification; receiving a push does not launch an app or run background automation.",
          },
          {
            kind: "bullets",
            items: [
              "Use an `https://` universal link when the destination app supports one. iOS opens the installed app and otherwise falls back to its website.",
              "Use the destination app's documented custom scheme for app-only routes, such as `your-app://incidents/INC-42`. If no installed app handles the scheme, Hark remains open.",
              "Percent-encode names, paths, and query values that contain spaces or reserved characters.",
            ],
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "body": "Incident INC-42 needs attention.",
  "url": "your-app://incidents/INC-42"
}`,
          },
          {
            kind: "p",
            text: "To run a shortcut saved on the recipient's iPhone, use Apple's [Shortcuts URL scheme](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios). The shortcut name must match exactly. Set `input=text` and provide URL-encoded `text`, or set `input=clipboard` to pass the current clipboard.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "body": "Production deployed. Tap to run the follow-up.",
  "url": "shortcuts://run-shortcut?name=Deployment%20Follow-up&input=text&text=production%20deployed"
}`,
          },
          {
            kind: "note",
            text: "iOS may require the device to be unlocked, and the shortcut can still show its own permission or confirmation prompts. Hark cannot run a shortcut merely because a notification arrived. Unsafe local or executable schemes such as `javascript:`, `data:`, `file:`, `blob:`, and `about:` are rejected.",
          },
        ],
      },
      {
        id: "notification-idempotency",
        blocks: [
          {
            kind: "p",
            text: "Send an optional `Idempotency-Key` header of 1 to 200 characters. Keys are scoped to a single service.",
          },
          {
            kind: "bullets",
            items: [
              "Same key and payload: the original event is returned with `idempotent: true`.",
              "Same key while the first request is still in flight: `202 Accepted`.",
              "Same key with a different payload: `409 Conflict`.",
              "Blank or over-length key: `400`.",
            ],
          },
        ],
      },
      {
        id: "device-routing",
        pro: true,
        blocks: [
          {
            kind: "p",
            text: "By default a request fans out to every active iOS device on the account, most recently seen first. Free accounts are capped at one device, so extra phones are ignored until you upgrade.",
          },
          {
            kind: "p",
            text: "Hark Pro can pass a non-empty `deviceIds` array to target specific iPhones. Copy the stable device IDs from the dashboard. IDs that do not belong to the account return `400 Invalid device selection`; owned but inactive or non-iOS devices in the list are skipped silently.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "body": "The production deploy needs attention.",
  "deviceIds": ["dev_your_iphone_id"]
}`,
          },
          {
            kind: "p",
            text: "Sending `deviceIds` without device routing on your plan returns `402`.",
          },
        ],
      },
      {
        id: "rate-limits",
        blocks: [
          {
            kind: "table",
            variant: "plan",
            caption: "Plan limits",
            rows: [
              { limit: "Requests per minute, per service", free: "60", pro: "300" },
              { limit: "Requests per minute, per account", free: "300", pro: "1,500" },
              { limit: "Notifications per month", free: "10,000", pro: "100,000" },
              { limit: "Active devices", free: "1", pro: "Unlimited" },
            ],
          },
          {
            kind: "p",
            text: "The per-minute counters use a rolling 60-second window and are shared across notifications, interactive responses, and Live Activity operations. A limited request returns `429` with a `Retry-After: 60` header and `retryAfterSeconds` in the body. Exhausting the monthly allowance also returns `429`, without a retry hint.",
          },
        ],
      },
      {
        id: "notification-response",
        blocks: [
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1
}`,
          },
          {
            kind: "table",
            variant: "field",
            caption: "Notification status codes",
            rows: [
              { name: "200", type: "ok", detail: "Accepted, or an idempotent replay." },
              { name: "202", type: "ok", detail: "An identical request is still processing." },
              { name: "400", type: "error", detail: "Invalid payload, key, or device selection." },
              { name: "402", type: "error", detail: "`deviceIds` routing requires Hark Pro." },
              { name: "404", type: "error", detail: "Unknown webhook token." },
              { name: "409", type: "error", detail: "Idempotency key reused with a new payload." },
              { name: "429", type: "error", detail: "Rate limit or monthly allowance exhausted." },
              { name: "502", type: "error", detail: "Every push target was rejected by Expo." },
            ],
          },
          {
            kind: "p",
            text: "Provider errors can embed a device push token, so they are recorded in the dashboard activity log rather than returned to the caller. Use that log to find devices that are no longer registered.",
          },
        ],
      },
      {
        id: "interactive-responses",
        blocks: [
          {
            kind: "p",
            text: "Any notification can carry a fixed response type, on every plan. Supported types are `approval` (Approve or Deny), `yes_no` (Yes or No), and `text` (a short free-form reply).",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "title": "Production deploy",
  "body": "Deploy commit 8e7fc2a?",
  "response": {
    "type": "approval",
    "expiresInSeconds": 900,
    "correlationId": "deploy-184",
    "callback": {
      "url": "https://ci.example.com/hark-response",
      "token": "private-callback-token"
    }
  }
}`,
          },
          {
            kind: "table",
            variant: "field",
            caption: "Interactive response fields",
            rows: [
              {
                name: "type",
                type: "string, required",
                detail: "`approval`, `yes_no`, or `text`.",
              },
              {
                name: "expiresInSeconds",
                type: "integer",
                detail: "30 to 86,400. Defaults to 900.",
              },
              {
                name: "correlationId",
                type: "string",
                detail: "Your own identifier, up to 100 characters. Echoed back on the callback.",
              },
              {
                name: "callback.url",
                type: "string",
                detail: "Public HTTPS URL that receives the answer.",
              },
              {
                name: "callback.token",
                type: "string",
                detail: "16 to 512 characters, sent back as a bearer token so you can verify Hark.",
              },
            ],
          },
          {
            kind: "p",
            text: "The response body gains a `response` object alongside the usual fields:",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1,
  "response": { "status": "pending", "expiresAt": "2026-07-25T18:19:04.000Z" }
}`,
          },
        ],
      },
      {
        id: "response-status",
        blocks: [
          {
            kind: "p",
            text: "Poll the event with the `eventId` from the send response, or withdraw it while it is still pending.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl ${EXAMPLE_ENDPOINT}/events/evt_Cxns2IdbF4H0TJYq

curl -X POST ${EXAMPLE_ENDPOINT}/events/evt_Cxns2IdbF4H0TJYq/cancel`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "event": {
    "id": "evt_Cxns2IdbF4H0TJYq",
    "response": {
      "status": "approved",
      "action": "approve",
      "text": null,
      "correlationId": "deploy-184",
      "respondedAt": "2026-07-25T18:06:52.000Z",
      "expiresAt": "2026-07-25T18:19:04.000Z"
    }
  }
}`,
          },
          {
            kind: "bullets",
            items: [
              "`status` is one of `pending`, `approved`, `denied`, `yes`, `no`, `replied`, `expired`, or `canceled`.",
              "For `text` prompts, `action` becomes `reply` and `text` holds the answer. For the other types `action` holds the chosen option and `text` is `null`.",
              "Reading a pending request after `expiresAt` settles it as `expired`.",
              "Cancel returns `404` if the response is not pending, and events belonging to another service are never visible.",
            ],
          },
        ],
      },
      {
        id: "response-callbacks",
        blocks: [
          {
            kind: "p",
            text: "When a callback is configured, Hark POSTs the answer to your URL with `Authorization: Bearer <callback.token>`, `Content-Type: application/json`, and a `Hark-Callbacks/1` user agent. Redirects are not followed and the request times out after 10 seconds.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "type": "notification.response",
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "correlationId": "deploy-184",
  "kind": "approval",
  "status": "approved",
  "action": "approve",
  "text": null,
  "respondedAt": "2026-07-25T18:06:52.000Z"
}`,
          },
          {
            kind: "p",
            text: "`kind` is `approval`, `yes_no`, or `reply` — a `text` request arrives as `reply`.",
          },
          {
            kind: "p",
            text: "Any response outside the 2xx range is a failure. Hark makes up to five attempts: once immediately, then after 30 seconds, 2 minutes, 10 minutes, and 1 hour. After the last attempt the callback is marked failed and is not retried, so treat the callback as at-least-once and key your handler on `eventId`.",
          },
          {
            kind: "note",
            text: "Callbacks fire only when someone actually answers. Prompts that expire or are canceled never call back — poll the event route if you need to observe those outcomes.",
          },
        ],
      },
    ],
  },
  {
    id: "activity-api",
    lead: "A Live Activity is a stateful card on the Lock Screen and in the Dynamic Island. Start one, push partial updates as work progresses, then end it. Same webhook token, nested routes.",
    subsections: [
      {
        id: "activity-start",
        blocks: [
          {
            kind: "table",
            variant: "route",
            caption: "Activity API routes",
            rows: [
              {
                method: "POST",
                path: "/hooks/:token/live-activities",
                detail: "Start an activity. Returns 201.",
              },
              {
                method: "GET",
                path: "/hooks/:token/live-activities/:id",
                detail: "Read the current state.",
              },
              {
                method: "PATCH",
                path: "/hooks/:token/live-activities/:id",
                detail: "Apply a partial update.",
              },
              {
                method: "POST",
                path: "/hooks/:token/live-activities/:id/end",
                detail: "Settle and dismiss the activity.",
              },
            ],
          },
          { kind: "p", text: "Only `title` and `status` are required." },
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST ${EXAMPLE_ENDPOINT}/live-activities \\
  -H 'Content-Type: application/json' \\
  -H 'Idempotency-Key: deploy-184-start' \\
  -d '{
    "title": "Deploy #184",
    "status": "Building",
    "progress": 0,
    "symbol": "build",
    "accentColor": "#FF9F0A"
  }'`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": true,
  "activityId": "act_9Rk2wQpLm4Tz",
  "sequence": 0,
  "status": "active",
  "accepted": 1,
  "failed": 0,
  "state": { "title": "Deploy #184", "status": "Building", "progress": 0, "symbol": "build" },
  "expiresAt": "2026-07-26T02:04:11.000Z",
  "staleAt": "2026-07-25T22:04:11.000Z",
  "endedAt": null
}`,
          },
          {
            kind: "p",
            text: "Use `activityId` in the update and end routes. If you pass your own `key` when starting, that value works in the URL too, so a script can address its activity without storing the generated ID. `Idempotency-Key` works on all three write routes and is scoped to the service: a replay returns `idempotent: true`, and reusing a key with a different payload returns `409`.",
          },
          {
            kind: "note",
            text: "Live Activities need a device running a Hark build that has registered a push-to-start token. If no device qualifies, the start still returns `201` with `accepted: 0` and an explanatory `message`.",
          },
        ],
      },
      {
        id: "activity-update",
        blocks: [
          {
            kind: "p",
            text: "`PATCH` merges into the current state, so send only what changed. At least one field other than `ifSequence` is required. Each accepted update increments `sequence`.",
          },
          {
            kind: "code",
            language: "bash",
            code: `curl -X PATCH ${EXAMPLE_ENDPOINT}/live-activities/act_9Rk2wQpLm4Tz \\
  -H 'Content-Type: application/json' \\
  -d '{ "status": "Testing", "progress": 0.6, "accentColor": "#64D2FF" }'`,
          },
          {
            kind: "bullets",
            items: [
              "Pass `null` for `detail` or `progress` to clear the field.",
              "Pass `ifSequence` to make the write conditional. A mismatch returns `409 Sequence conflict` along with the current state so you can reconcile.",
              "Updating an activity that has already ended or expired returns `409 Live Activity is already terminal`.",
            ],
          },
        ],
      },
      {
        id: "activity-end",
        blocks: [
          {
            kind: "code",
            language: "bash",
            code: `curl -X POST ${EXAMPLE_ENDPOINT}/live-activities/act_9Rk2wQpLm4Tz/end \\
  -H 'Content-Type: application/json' \\
  -d '{ "status": "Deployed", "progress": 1, "symbol": "success" }'`,
          },
          {
            kind: "p",
            text: "The body is optional. `dismissAfterSeconds` (0 to 14,400, default 0) controls how long the finished card lingers on the Lock Screen before iOS removes it.",
          },
          {
            kind: "note",
            text: '`status` and `symbol` have defaults on this route, so omitting them overwrites the live values with `"Complete"` and `success`. Send them explicitly if you want the final card to read differently.',
          },
        ],
      },
      {
        id: "activity-fields",
        blocks: [
          {
            kind: "table",
            variant: "field",
            caption: "Live Activity fields",
            rows: [
              {
                name: "title",
                type: "string, required",
                detail: "Up to 80 characters. Required on start, optional on updates.",
              },
              { name: "status", type: "string, required", detail: "Short state line, up to 60." },
              { name: "detail", type: "string", detail: "Secondary line, up to 240. Nullable." },
              { name: "progress", type: "number", detail: "0 to 1 inclusive. Nullable." },
              {
                name: "symbol",
                type: "enum",
                detail:
                  "`terminal`, `code`, `build`, `success`, or `warning`. Defaults to `terminal`.",
              },
              {
                name: "accentColor",
                type: "string",
                detail: "Six-digit hex, `#RRGGBB`. Defaults to `#5ED8B7`.",
              },
              {
                name: "style",
                type: "enum",
                detail:
                  "`standard`, `ring`, `hero`, `terminal`, or `steps`. Defaults to `standard` and selects the widget layout. Updates can switch it mid-flight. App builds that predate a style fall back to the standard layout.",
              },
              {
                name: "privacyMode",
                type: "enum",
                detail:
                  "`standard` or `private`. Private replaces the start alert text with a generic line so the title and status stay off a locked screen.",
              },
              {
                name: "key",
                type: "string, start only",
                detail:
                  "Your own alias, up to 100 characters, usable in place of the activity ID. A key becomes reusable once its activity ends.",
              },
              {
                name: "replace",
                type: "boolean, start only",
                detail:
                  "End any Live Activity occupying a target device, and any of your own still holding the same `key`, before starting. Defaults to `false`. The response reports the displaced count as `replaced`.",
              },
              {
                name: "deviceIds",
                type: "string[], Pro",
                detail: "1 to 50 device IDs. Omit to target every capable device.",
              },
            ],
          },
          {
            kind: "p",
            text: "The five progress layouts and four interactive approval layouts, captured from the iOS simulator with the same state:",
          },
          {
            kind: "stylePreviews",
            styles: [
              {
                name: "standard",
                description:
                  "Icon, title over status, trailing percent, linear progress bar. The default.",
              },
              {
                name: "ring",
                description:
                  "A determinate capacity gauge with the percent centered; no linear bar.",
              },
              {
                name: "hero",
                description:
                  "Status becomes the headline and the bar runs edge to edge along the bottom of the card.",
                nativeScreenshot: false,
              },
              {
                name: "terminal",
                description:
                  "Monospaced prompt treatment: the status lowercased behind a prompt glyph, the detail as a comment line.",
              },
              {
                name: "steps",
                description: "Progress quantized into five stage pips — phases, not percent.",
              },
              {
                name: "approval",
                description:
                  "The default interactive layout with a clear prompt and balanced approve/deny actions.",
              },
              {
                name: "shell",
                description:
                  "A terminal-native approval prompt with command-line copy and compact green actions.",
              },
              {
                name: "verdict",
                description:
                  "A centered system-dialog treatment with a divider and high-contrast blue primary action.",
              },
              {
                name: "signal",
                description:
                  "A guarded-action card with restrained security framing and green/red decisions.",
              },
            ],
          },
        ],
      },
      {
        id: "activity-lifetime",
        blocks: [
          {
            kind: "p",
            text: "`expiresInSeconds` accepts 60 to 28,800 and defaults to 28,800 — eight hours. Once an activity passes its expiry it is marked `expired` and stops accepting updates.",
          },
          {
            kind: "p",
            text: "`staleAfterSeconds` accepts 0 to 28,800 and defaults to 14,400 — four hours. Past that deadline iOS treats the content as possibly out of date, but the card stays visible and updateable. Every update rolls the deadline forward from now, clamped to the expiry. An update that omits `staleAfterSeconds` reuses the previous window.",
          },
        ],
      },
      {
        id: "activity-conflicts",
        blocks: [
          {
            kind: "p",
            text: "A device can host one Hark Live Activity at a time. Starting another while one is still live on a target device returns `409`:",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "ok": false,
  "error": "A Live Activity is already active on a target device",
  "code": "ACTIVE_ACTIVITY_CONFLICT",
  "activityId": "act_9Rk2wQpLm4Tz"
}`,
          },
          {
            kind: "p",
            text: "The `activityId` is included only when the blocking activity belongs to the same service, so you can update it instead of starting over. Branch on `code` rather than the message text.",
          },
          {
            kind: "p",
            text: "To take the slot instead, pass `replace: true` in the start payload. Hark silently ends whatever occupies each target device — the old card is dismissed immediately, showing its last state — and then starts your activity. The success response reports how many activities were displaced as `replaced`; with nothing to displace the start behaves normally and `replaced` is `0`.",
          },
          {
            kind: "p",
            text: "`replace` also displaces activities started by your other services or API tokens, so a stale card from another integration cannot deadlock a device, though a foreign `activityId` is never disclosed. When the start carries a `key`, your live activity holding that key is ended everywhere — even on devices the start does not target — so the key always transfers to the new run. The implicit ends are not billed against your notification allowance. Combined with reusable keys this makes `key` plus `replace: true` a fixed-key restart you can send on every run.",
          },
        ],
      },
      {
        id: "activity-alerts",
        blocks: [
          {
            kind: "p",
            text: "A start carries an alert, so it may notify the user like a normal notification. Updates and ends carry no alert and are silent. Hark sends every Live Activity push at high APNs priority, which affects delivery speed only, not sound or haptics.",
          },
          {
            kind: "p",
            text: "Live Activity operations count against the same per-minute and monthly limits as notifications, so a chatty progress loop consumes the same budget. Throttle to meaningful state changes.",
          },
          {
            kind: "note",
            text: "iOS also budgets push-to-start deliveries per app. Rapid successive starts to the same device can be silently suppressed: the start still reports `accepted`, but the device never registers an update token, so every later update and end fails with `MissingUpdateToken`. Space fresh starts out by a minute or so — or keep one activity alive and update it, which is cheaper and never hits the budget.",
          },
        ],
      },
    ],
  },
  {
    id: "cli",
    lead: "`harkctl` wraps the agent API for terminals, scripts, and coding agents: one-shot notifications, questions with answers you can wait on, and Live Activities — no webhook URL required. It needs Node.js 22 or newer.",
    subsections: [
      {
        id: "cli-install",
        blocks: [
          {
            kind: "p",
            text: "Run it straight from npm with `npx harkctl`, or install it globally with `npm install -g harkctl`. Signing in uses a browser device-authorization flow — no tokens on the command line, ever.",
          },
          {
            kind: "code",
            language: "bash",
            code: "npx harkctl auth login",
          },
          {
            kind: "steps",
            items: [
              "The CLI prints a short code and opens [hark.ryan.ceo](https://hark.ryan.ceo) in your browser.",
              "Sign in and approve the requested scopes; every scope is shown before you approve.",
              "Credentials are written to an OS config file with mode `0600`, and the CLI polls until the approval lands.",
            ],
          },
          {
            kind: "p",
            text: "Each login appears under your dashboard's Services list as an agent connection, with its scopes, creation date, and last use. Revoking it there signs that agent out immediately. `harkctl auth status` shows the active connection; `harkctl auth logout` revokes and removes local credentials.",
          },
          {
            kind: "p",
            text: "Use repeatable `--scope` flags to narrow access, `--client-name` to label the connection, and `--expires-in` (default `90d`) to bound its lifetime. For CI or self-hosted setups, `HARK_TOKEN` and `HARK_API_URL` environment variables override the config file.",
          },
        ],
      },
      {
        id: "cli-permissions",
        blocks: [
          {
            kind: "p",
            text: "Route permission requests from Claude Code, Codex, OpenCode V1, and OpenCode V2 to Hark with one setup command. Only an explicit phone approval grants a request, and it grants it once. Denial, timeout, malformed input, authentication failure, network failure, and no-device delivery deny.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl permissions setup all
harkctl permissions doctor`,
          },
          {
            kind: "p",
            text: "The default harkctl login includes the required `notifications:send`, `interactions:create`, and `interactions:read` scopes. A narrowed login must retain all three; setup and `doctor` report missing scopes before hooks are installed.",
          },
          {
            kind: "p",
            text: "Use `permissions setup claude`, `permissions setup codex`, or `permissions setup opencode` for one integration. After Codex setup, review and trust the hook through `/hooks`. OpenCode setup installs both a V1 plugin connector and the V2 background connector on macOS. `harkctl permissions uninstall all` removes only Hark-owned hooks and services.",
          },
          {
            kind: "p",
            text: "Phone prompts contain only the agent name, permission or tool name, project directory basename, and resource count. Raw commands, patches, prompts, file contents, URLs, environment variables, transcript paths, and absolute paths are not sent to Hark.",
          },
        ],
      },
      {
        id: "cli-service",
        blocks: [
          {
            kind: "p",
            text: "`harkctl services create` creates a persistent webhook endpoint for another tool or workflow. Its title, image, and tap URL become defaults, so the sender only needs to POST a `body`. The command prints the credential-bearing `webhookUrl` in its JSON response.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl services create \\
  --title "Release bot" \\
  --image https://example.com/bot.png \\
  --url https://ci.example.com/releases`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "service": {
    "id": "svc_...",
    "title": "Release bot",
    "imageUrl": "https://example.com/bot.png"
  },
  "webhookUrl": "https://hark.ryan.ceo/hooks/hook_..."
}`,
          },
          {
            kind: "p",
            text: "Use `--stdin` to provide the same fields as JSON. `services list` lists existing services without emitting their webhook credentials. Creation requires `services:write`; if your CLI login predates that scope, sign in again and approve the updated permissions.",
          },
          {
            kind: "note",
            text: "Treat `webhookUrl` as a secret. Anyone who has it can send notifications through that service.",
          },
        ],
      },
      {
        id: "cli-notify",
        blocks: [
          {
            kind: "p",
            text: "`harkctl notify <body>` sends a one-shot push to every active iPhone on your account. Appearance is per call — the title acts as the sender name, and messages with the same title thread together like a service.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl notify "Build 48 passed" \\
  --title "CI" \\
  --image https://github.com/github.png \\
  --url https://ci.example.com/builds/48`,
          },
          {
            kind: "table",
            variant: "flag",
            caption: "notify flags",
            rows: [
              { name: "--title", type: "string", detail: "Sender name. Defaults to `Hark`." },
              {
                name: "--image",
                type: "url",
                detail: "Public HTTPS avatar, same rules as the webhook `imageUrl`.",
              },
              {
                name: "--url",
                type: "url",
                detail: "Web URL, app deep link, or Shortcuts URL opened when tapped.",
              },
              {
                name: "--device",
                type: "id, repeatable",
                detail: "Target specific iPhones. Requires Hark Pro.",
              },
              {
                name: "--project",
                type: "string",
                detail: "File the notification into a named project in the Hark app inbox.",
              },
              {
                name: "--summary",
                type: "string",
                detail:
                  "Short push/preview text for a long body. Bodies can hold up to 8,000 characters.",
              },
              {
                name: "--markdown",
                type: "boolean",
                detail:
                  "Record the body as Markdown (same as `--body-format markdown`); V1 renders plain text.",
              },
              {
                name: "--app",
                type: "app id",
                detail:
                  "Open this [web app](https://hark.ryan.ceo/docs#web-apps) in Hark when tapped; `--url` must stay on its origin.",
              },
              {
                name: "--idempotency-key",
                type: "string",
                detail: "Safe retries: replays return the original result without a second push.",
              },
              {
                name: "--stdin",
                type: "boolean",
                detail: "Merge a JSON object from stdin under the explicit flags.",
              },
            ],
          },
          {
            kind: "note",
            text: "Sends from one connection share the webhook per-minute budgets — the requester counts like a service, the account window spans everything — and the same monthly notification allowance.",
          },
        ],
      },
      {
        id: "cli-ask",
        blocks: [
          {
            kind: "p",
            text: "`harkctl notify ask <prompt>` sends a push that elicits an answer. Pass exactly one response type: `--approval` (Approve/Deny), `--yes-no` (Yes/No), or `--text` (a short typed reply). The appearance flags from `notify` all apply.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl notify ask "Deploy 8e7fc2a to production?" \\
  --approval --title "Deploybot" --wait --timeout 15m`,
          },
          {
            kind: "p",
            text: "Add `--live-activity` to an approval or yes/no request to put its buttons on the Lock Screen and expanded Dynamic Island. `--style` selects `approval`, `shell`, `verdict`, or `signal`. `--primary-label` and `--secondary-label` customize visible verbs such as Send/Deny or Push/Cancel while the returned action remains canonical. Interactive Live Activity prompts are limited to 240 characters, action labels are 1 to 24 characters, requests require iOS 17+, expire within eight hours, and don't support text replies, images, or URLs.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl notify ask "Send the prepared release email?" \\
  --approval --live-activity --style signal \\
  --primary-label Send --secondary-label Deny \\
  --wait --timeout 15m`,
          },
          {
            kind: "p",
            text: "`--wait` blocks until the answer arrives or the timeout passes. `--poll` waits at most 20 seconds to catch an instant answer, for the case where someone is already looking at their phone. A timed-out poll or wait does not end the prompt — it stays answerable until it expires (default 15 minutes, `--expires-in` to change), and `harkctl interaction wait <id>` resumes waiting any time.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "interaction": {
    "id": "int_7MFuml-SqoUmpPLo",
    "kind": "reply",
    "status": "replied",
    "response": "ship it",
    "respondedAt": "2026-07-26T11:54:17.927Z"
  },
  "accepted": 1,
  "timedOut": false
}`,
          },
        ],
      },
      {
        id: "cli-activity",
        blocks: [
          {
            kind: "p",
            text: "The `activity` commands drive the Activity API end to end. Address an activity by the returned ID or by your own `--key`, and pick a layout with `--style`.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl activity start --key deploy --replace --style ring \\
  --title "Deploy #184" --status "Building" --progress 0.1

harkctl activity update deploy --status "Testing" --progress 0.6 --if-sequence 0

harkctl activity end deploy --status "Shipped" --progress 1 --dismiss-after 45s`,
          },
          {
            kind: "bullets",
            items: [
              "`--replace` takes the device slot and the key, ending whatever blocks them, so a fixed-key start works on every run.",
              "`--if-sequence` rejects stale writes: the update only applies if the activity is still at that sequence.",
              "`--style` selects `standard`, `ring`, `hero`, `terminal`, or `steps`, and can change mid-flight on `update`.",
              "`activity get <id|key>` reads current state; `activity list` shows recent activities.",
            ],
          },
        ],
      },
      {
        id: "cli-scripting",
        blocks: [
          {
            kind: "p",
            text: "Every successful command prints exactly one JSON object to stdout (`apps` commands print readable lines unless you pass `--json`); diagnostics go to stderr. Exit codes make answers branchable without parsing:",
          },
          {
            kind: "bullets",
            items: [
              "`0` — success, approved, yes, or replied",
              "`4` — timed out, canceled, or expired",
              "`5` — denied or no",
              "`7` — no device accepted the push",
              "`1` API error · `2` usage error · `3` authentication or scope error · `6` network error",
            ],
          },
          {
            kind: "code",
            language: "bash",
            code: `if harkctl notify ask "Deploy to production?" --approval --wait --timeout 10m; then
  ./deploy.sh && harkctl notify "Deployed" --title "Deploybot"
else
  echo "Not approved" >&2
fi`,
          },
        ],
      },
    ],
  },
  {
    id: "web-apps",
    lead: "Open any HTTPS site you control full-screen in the Hark iPhone app. Hark hands the page a short-lived signed Hark pass, so your site can identify the viewer without building its own login.",
    subsections: [
      {
        id: "apps-register",
        blocks: [
          {
            kind: "p",
            text: "Register an app with `harkctl apps create`. Registering the same URL again updates its name, icon, or project. Apps appear in the Hark iPhone app, which asks you to approve sign-in the first time one opens; you can revoke that approval or choose whether your name and email are shared at any time.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl apps create --name "Ops dashboard" \
  --url https://ops.example.com --icon https://ops.example.com/icon.png

harkctl apps list
harkctl apps remove app_...`,
          },
          {
            kind: "p",
            text: "Launch URLs must use HTTPS; plain HTTP is accepted only for `localhost` development servers. Accounts hold up to 100 apps. Agent tokens need the `apps:read` and `apps:write` scopes; sign in again if your login predates them.",
          },
        ],
      },
      {
        id: "apps-verify",
        blocks: [
          {
            kind: "steps",
            items: [
              "Inside the Hark app, your page calls `await window.hark.getToken()`, which resolves to a pass string. `window.hark` exists only in Hark; `window.hark.close()` returns to the app.",
              "The page sends the pass to your server, which verifies it as an ES256 JWT against [the Hark JWKS](https://hark.ryan.ceo/.well-known/jwks.json) — for example with `jwtVerify` from `jose`.",
              "Require issuer `https://hark.ryan.ceo`, audience equal to your app's origin, `typ` `hark-pass+jwt`, and algorithm `ES256`, then start your own session.",
            ],
          },
          {
            kind: "table",
            variant: "field",
            caption: "Hark pass claims",
            rows: [
              {
                name: "sub",
                type: "string",
                detail:
                  "Stable user ID for your origin (`hk_…`). It differs for every other origin, so apps cannot correlate users.",
              },
              {
                name: "aud",
                type: "string",
                detail: "Your app's origin, e.g. `https://app.example.com`.",
              },
              {
                name: "iat / exp",
                type: "number",
                detail: "Passes expire two minutes after issue.",
              },
              {
                name: "jti",
                type: "string",
                detail: "Unique per pass; reject reused values to block replay.",
              },
              {
                name: "app_id",
                type: "string",
                detail: "The Hark app ID the pass was issued for.",
              },
              {
                name: "name / email",
                type: "string",
                detail:
                  "Present only when the owner shares them. Name is shared by default; email is not.",
              },
              {
                name: "team_id / team_role",
                type: "string",
                detail:
                  "Present for [team apps](#teams-apps): the viewer's team and their current role (`owner`, `admin`, or `member`).",
              },
            ],
          },
          {
            kind: "note",
            text: "Never trust a pass you have not verified, and never treat it as a long-lived credential: verify once, then rely on your own session.",
          },
        ],
      },
      {
        id: "apps-notify",
        blocks: [
          {
            kind: "p",
            text: "Pass `appId` on a webhook (or `--app` to `harkctl notify`) to open the app when the notification is tapped. Add `url` to deep-link within it; it must share the app's origin.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "body": "Nightly report is ready",
  "appId": "app_...",
  "url": "https://ops.example.com/reports/latest"
}`,
          },
        ],
      },
    ],
  },
  {
    id: "teams",
    lead: "A team shares web apps and on-call groups between Hark accounts. Everyone keeps their own phone, inbox, and sign-in decisions; the team only decides what is shared.",
    subsections: [
      {
        id: "teams-roles",
        blocks: [
          {
            kind: "p",
            text: "Create a team in the dashboard or with `harkctl teams create`. You become its owner. Each member has one role:",
          },
          {
            kind: "table",
            variant: "field",
            caption: "Team roles",
            rows: [
              {
                name: "owner",
                type: "one per team",
                detail:
                  "Everything an admin can do, plus deleting the team, managing billing, and transferring ownership. The owner must transfer ownership before leaving.",
              },
              {
                name: "admin",
                type: "role",
                detail:
                  "Renames the team, invites and removes members, changes roles, removes any team app, and creates and edits on-call groups.",
              },
              {
                name: "member",
                type: "role",
                detail:
                  "Uses and adds team apps, raises and acknowledges pages, and schedules overrides for themselves.",
              },
            ],
          },
          {
            kind: "p",
            text: "Transferring ownership (setting someone's role to `owner`) makes the previous owner an admin. Removing a member takes effect immediately: they stop receiving Hark passes for the team's apps and leave every rotation.",
          },
        ],
      },
      {
        id: "teams-seats",
        blocks: [
          {
            kind: "p",
            text: "Every member uses a seat. The first seat is free, so a team of one costs nothing. Each additional member needs the team plan at $5 per seat per month, billed to the team (not to anyone's personal plan) and prorated as people join and leave.",
          },
          {
            kind: "p",
            text: "Without the team plan, creating or accepting an invite for a second member returns `402` with code `seat_limit`. The team owner starts checkout or opens the billing portal from the team page in the dashboard.",
          },
          {
            kind: "note",
            text: "Pages count against the notification allowance of whoever raised them (the agent's or service's owner), like any other notification. Team notices such as invites and shared apps are free.",
          },
        ],
      },
      {
        id: "teams-invites",
        blocks: [
          {
            kind: "p",
            text: "Owners and admins create invite links. Each link joins one person, expires after seven days, and can be revoked. Add an email to also push the invite to an existing Hark user with that address.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl teams invite team_... --email teammate@example.com --role member
# { "invite": { ... }, "code": "…", "url": "https://hark.ryan.ceo/join/…" }`,
          },
          {
            kind: "p",
            text: "Opening the link shows the team, who invited you, and the role. Joining requires signing in: agents can create invites but never accept them.",
          },
        ],
      },
      {
        id: "teams-apps",
        blocks: [
          {
            kind: "p",
            text: "Any member can add a [web app](#web-apps) to a team, or move one of their own apps into it with `harkctl apps share app_... --team team_...` (`--personal` moves it back). The other members are notified and see the app next to their own.",
          },
          {
            kind: "bullets",
            items: [
              "Every member approves sign-in and chooses whether their name and email are shared for themselves; nobody approves on someone else's behalf.",
              "Passes for team apps carry the usual pairwise `sub` plus `team_id` and `team_role`, checked at issue time, so your site can authorize by team.",
              "The person who added an app, and team admins, can rename or remove it. Deleting a team returns its apps to the people who added them.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "oncall",
    lead: "On-call groups page whoever is on call right now, then escalate until someone takes it. Pages arrive as time-sensitive notifications with Acknowledge and Escalate actions on the Lock Screen.",
    subsections: [
      {
        id: "oncall-rotations",
        blocks: [
          {
            kind: "p",
            text: "Team owners and admins create on-call groups. A rotation is an ordered list of team members who hand off daily or weekly at a local time in an IANA time zone. Handoffs follow the local clock across daylight-saving changes, so a 09:00 handoff stays at 09:00.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl oncall create --team team_... --name Primary \\
  --members user_a,user_b,user_c --period weekly \\
  --handoff 09:00 --timezone America/New_York`,
          },
          {
            kind: "p",
            text: "Without `startsAt`, the first member is on call from the latest handoff. Overrides put someone on call for a window (covering a shift, a holiday) and replace the rotation while they last; any member can schedule one for themselves. Each group lists its current shift and the next few.",
          },
        ],
      },
      {
        id: "oncall-paging",
        blocks: [
          {
            kind: "p",
            text: "A page goes first to the person on call. If nobody is on call, the whole group is paged. Escalation steps then run until someone acknowledges:",
          },
          {
            kind: "table",
            variant: "field",
            caption: "Escalation steps",
            rows: [
              {
                name: "afterMinutes",
                type: "integer",
                detail: "Minutes after the previous step (or the page) without an acknowledgement.",
              },
              {
                name: "target",
                type: "next | group",
                detail:
                  "`next` pages the next person in the rotation; `group` pages everyone in it who has not been paged yet.",
              },
            ],
          },
          {
            kind: "p",
            text: "The default is the next person after 5 minutes, then the whole group 10 minutes later. Pages with the same `dedupKey` merge into the open page (its `repeatCount` grows) instead of paging again.",
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl page ocg_... "API error rate above 20%" \\
  --body "5xx since 14:02" --dedup-key api-5xx`,
          },
        ],
      },
      {
        id: "oncall-webhook",
        blocks: [
          {
            kind: "p",
            text: "Add `oncall` to a webhook payload to page a group instead of notifying your own devices. The service owner must belong to the group's team, and `oncall` cannot be combined with `deviceIds` or `response`. The `Idempotency-Key` header becomes the page's dedup key, so retries merge into the open page.",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "title": "Checkout API",
  "body": "Error rate above 20% for 5 minutes",
  "oncall": "ocg_..."
}`,
          },
          {
            kind: "p",
            text: "The response carries `pageId` and `delivered`. Page bodies are limited to 2,000 characters. Agents page with `harkctl page` or `harkctl notify --oncall`.",
          },
        ],
      },
      {
        id: "oncall-acknowledge",
        blocks: [
          {
            kind: "p",
            text: "Anyone on the team can acknowledge a page from the Lock Screen, the app, or the website. The first acknowledgement wins: escalation stops, the page clears from everyone else's phone, and later acknowledgements are refused. Escalate pages the next step right away.",
          },
          {
            kind: "note",
            text: "Acknowledging and escalating are human-only. An acknowledgement tells the team a person is on it, so agents can raise, read, and resolve pages but have no route to acknowledge or escalate them.",
          },
          {
            kind: "p",
            text: 'Resolve a page when the incident is over, from the website or with `harkctl pages resolve page_... --note "Rolled back"`. Resolving an unacknowledged page also stops its escalation.',
          },
        ],
      },
    ],
  },
  {
    id: "agent-api",
    lead: "Everything you can do in the dashboard or the phone inbox is also available to a scoped agent token, except the few decisions only you should make. `harkctl` wraps every route.",
    subsections: [
      {
        id: "agent-api-auth",
        blocks: [
          {
            kind: "p",
            text: "Send `Authorization: Bearer hark_…` with a token from `harkctl auth login` or the dashboard's Agent connections. Each route requires the scopes listed below; a missing scope returns `403` with `required` naming them. Every resource is scoped to the token's account, and other accounts' IDs return `404`.",
          },
          {
            kind: "bullets",
            items: [
              "Default `harkctl` logins request every scope except `events:read` and `tokens:manage`; add those with `--scope`.",
              "`devices:write`, `inbox:read`, `inbox:write`, `billing:read`, and `tokens:manage` were added with this API, and `teams:read`, `teams:write`, `oncall:read`, and `oncall:write` with teams; older logins must sign in again to use them.",
              "Agent reads of services never include webhook URLs. Only create and rotate return a URL, once.",
            ],
          },
        ],
      },
      {
        id: "agent-api-routes",
        blocks: [
          {
            kind: "table",
            variant: "route",
            caption: "Agent API routes",
            rows: [
              {
                method: "GET",
                path: "/api/agent/auth/status",
                detail: "Describe the calling token. Any scope.",
              },
              {
                method: "POST",
                path: "/api/agent/auth/revoke",
                detail: "Revoke the calling token. Any scope.",
              },
              {
                method: "POST",
                path: "/api/agent/notifications",
                detail: "Send a push. `notifications:send`.",
              },
              {
                method: "POST",
                path: "/api/agent/notifications/:id/withdraw",
                detail:
                  "Remove a sent agent push from Notification Center and mark it read. `notifications:send`.",
              },
              {
                method: "GET",
                path: "/api/agent/interactions",
                detail: "Pending prompts from every source on the account. `interactions:read`.",
              },
              {
                method: "POST",
                path: "/api/agent/interactions",
                detail: "Ask a question. `interactions:create` and `notifications:send`.",
              },
              {
                method: "GET",
                path: "/api/agent/interactions/:id",
                detail:
                  "Read a prompt this token created; `/wait` long-polls it. `interactions:read`.",
              },
              {
                method: "POST",
                path: "/api/agent/interactions/:id/cancel",
                detail: "Cancel a prompt this token created. `interactions:create`.",
              },
              {
                method: "GET",
                path: "/api/agent/inbox/projects",
                detail: "Inbox projects with unread counts. `inbox:read`.",
              },
              {
                method: "GET",
                path: "/api/agent/inbox/notifications",
                detail: "Inbox page: `limit`, `project`, `unread`, `cursor`. `inbox:read`.",
              },
              {
                method: "GET",
                path: "/api/agent/inbox/notifications/:id",
                detail: "One notification with its full body. `inbox:read`.",
              },
              {
                method: "POST",
                path: "/api/agent/inbox/notifications/:id/read",
                detail: "Mark read; `/unread` reverses it. `inbox:write`.",
              },
              {
                method: "POST",
                path: "/api/agent/inbox/notifications/read-all",
                detail: "Mark read up to a list response's `readThroughToken`. `inbox:write`.",
              },
              {
                method: "GET",
                path: "/api/agent/activity-feed",
                detail: "Account activity history: `filter`, `page`. `events:read`.",
              },
              {
                method: "GET",
                path: "/api/agent/events",
                detail: "Recent webhook deliveries. `events:read`.",
              },
              {
                method: "GET",
                path: "/api/agent/services",
                detail: "List services, or `/:id` for one, without webhook URLs. `services:read`.",
              },
              {
                method: "POST",
                path: "/api/agent/services",
                detail: "Create a service; the webhook URL is returned once. `services:write`.",
              },
              {
                method: "PATCH",
                path: "/api/agent/services/:id",
                detail: "Change title, avatar, or tap URL; `DELETE` removes it. `services:write`.",
              },
              {
                method: "POST",
                path: "/api/agent/services/:id/rotate",
                detail:
                  "Replace the webhook token; the new URL is returned once. `services:write`.",
              },
              {
                method: "GET",
                path: "/api/agent/devices",
                detail: "Registered devices. `devices:read`.",
              },
              {
                method: "DELETE",
                path: "/api/agent/devices/:id",
                detail: "Remove a device until Hark next opens on it. `devices:write`.",
              },
              {
                method: "GET",
                path: "/api/agent/apps",
                detail: "List apps, or `/:id` for one. `apps:read`.",
              },
              {
                method: "POST",
                path: "/api/agent/apps",
                detail: "Register an app; an existing URL is updated. `apps:write`.",
              },
              {
                method: "PATCH",
                path: "/api/agent/apps/:id",
                detail: "Change name, URL, icon, or project; `DELETE` removes it. `apps:write`.",
              },
              {
                method: "POST",
                path: "/api/agent/apps/:id/revoke",
                detail: "Sign the app out until the owner approves it again. `apps:write`.",
              },
              {
                method: "POST",
                path: "/api/agent/apps/:id/share",
                detail: "Move an app you added into a team, or back. `apps:write`.",
              },
              {
                method: "GET",
                path: "/api/agent/teams",
                detail:
                  "Your teams, or `/:id` for one with its members. `teams:read`; `POST`, `PATCH`, and `DELETE` need `teams:write`.",
              },
              {
                method: "POST",
                path: "/api/agent/teams/:id/invites",
                detail: "Create a join link; `GET` lists them. `teams:write` / `teams:read`.",
              },
              {
                method: "PATCH",
                path: "/api/agent/teams/:id/members/:userId",
                detail: "Change a role; `DELETE` removes the member. `teams:write`.",
              },
              {
                method: "GET",
                path: "/api/agent/teams/:id/oncall",
                detail:
                  "The team's on-call groups; `POST` creates one. `oncall:read` / `oncall:write`.",
              },
              {
                method: "PATCH",
                path: "/api/agent/oncall/:groupId",
                detail: "Edit a group, its `/overrides`, or raise `/pages`. `oncall:write`.",
              },
              {
                method: "GET",
                path: "/api/agent/teams/:id/pages",
                detail: "The team's pages: `status`, `cursor`, `limit`. `oncall:read`.",
              },
              {
                method: "POST",
                path: "/api/agent/pages/:id/resolve",
                detail: "Resolve a page; `GET /api/agent/pages/:id` reads one. `oncall:write`.",
              },
              {
                method: "GET",
                path: "/api/agent/activities",
                detail:
                  "Live Activities this token started; full CRUD under `/:identifier`. `activities:read` / `activities:write`.",
              },
              {
                method: "GET",
                path: "/api/agent/billing",
                detail: "Plan, limits, and remaining usage. `billing:read`.",
              },
              {
                method: "GET",
                path: "/api/agent/tokens",
                detail: "The account's tokens, never their secrets. `tokens:manage`.",
              },
              {
                method: "DELETE",
                path: "/api/agent/tokens/:id",
                detail: "Revoke another token of the account. `tokens:manage`.",
              },
            ],
          },
          {
            kind: "code",
            language: "bash",
            code: `harkctl inbox list --unread --limit 20
harkctl inbox read-all --project unfiled
harkctl interaction list
harkctl notify withdraw anot_...
harkctl services rotate svc_...
harkctl apps update app_... --name "Ops board"
harkctl billing
harkctl tokens list   # needs --scope tokens:manage at login`,
          },
        ],
      },
      {
        id: "agent-api-human-only",
        blocks: [
          {
            kind: "p",
            text: "Some actions have no agent route on purpose. An agent may reduce access, but only a person on their phone or signed in to the dashboard can grant it.",
          },
          {
            kind: "bullets",
            items: [
              "Answering prompts: an approval means a human approved, so agents can list and cancel prompts but never respond to them.",
              "Creating API tokens: a token that could mint tokens could grant itself any scope and outlive its own revocation. Agents can list and revoke tokens with `tokens:manage`.",
              "App sign-in: approving sign-in, issuing Hark passes, and choosing whether your name and email are shared stay on the phone. Moving an app's URL to a new origin clears its approval.",
              "Registering devices, which needs the iPhone's push token.",
              "Starting checkout or opening the billing portal, for you or a team.",
              "Accepting a team invite: joining a team is your decision.",
              "Acknowledging or escalating a page: an acknowledgement tells the team a person is on it.",
            ],
          },
        ],
      },
      {
        id: "agent-api-openapi",
        blocks: [
          {
            kind: "p",
            text: "A public OpenAPI 3.1 document describes every agent route, its scopes (`x-hark-scopes`), request schema, and response shape. Request schemas are generated from the same validators the server uses.",
          },
          { kind: "copy", label: "OpenAPI document", value: AGENT_OPENAPI_URL },
        ],
      },
    ],
  },
  {
    id: "mcp",
    lead: "Hark is also a remote MCP server, so Claude, OpenCode, Cursor, and other MCP clients can use every agent API operation as a tool. It signs in with OAuth: there is no token to paste.",
    subsections: [
      {
        id: "mcp-connect",
        blocks: [
          {
            kind: "p",
            text: "Add the server URL to your MCP client. It uses the Streamable HTTP transport.",
          },
          { kind: "copy", label: "MCP server URL", value: MCP_SERVER_URL },
          {
            kind: "p",
            text: "OpenCode reads remote servers from `opencode.json`:",
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "hark": { "type": "remote", "url": "${MCP_SERVER_URL}" }
  }
}`,
          },
          {
            kind: "p",
            text: "Claude Code adds it from the terminal, and Cursor reads `~/.cursor/mcp.json`:",
          },
          {
            kind: "code",
            language: "bash",
            code: `claude mcp add --transport http hark ${MCP_SERVER_URL}`,
          },
          {
            kind: "code",
            language: "json",
            code: `{
  "mcpServers": {
    "hark": { "url": "${MCP_SERVER_URL}" }
  }
}`,
          },
        ],
      },
      {
        id: "mcp-oauth",
        blocks: [
          {
            kind: "steps",
            items: [
              "Your client calls the server, gets `401` with a `resource_metadata` pointer, and registers itself with Hark (dynamic client registration).",
              "Your browser opens Hark's consent page. Sign in with Apple or Google if needed.",
              "Review what the client asks for, untick anything you do not want, and approve. Hark remembers your answer for that client and set of permissions.",
              "The client receives a one-hour access token for `/mcp`, plus a refresh token if you left Stay connected ticked.",
            ],
          },
          {
            kind: "p",
            text: "OAuth scopes are the agent API scopes one to one, plus `offline_access` for Stay connected. A client that asks for no scope requests everything except `tokens:manage`. PKCE (S256) is required, and tokens are only valid for the `/mcp` resource.",
          },
          {
            kind: "p",
            text: 'Connected clients are listed on the dashboard; Disconnect revokes their access and refresh tokens at once. With `tokens:manage`, agents see them as `kind: "oauth"` entries from `GET /api/agent/tokens` and can revoke them too.',
          },
          {
            kind: "table",
            variant: "route",
            caption: "Discovery documents",
            rows: [
              {
                method: "GET",
                path: "/.well-known/oauth-protected-resource/mcp",
                detail: "Protected resource metadata (RFC 9728) for the MCP server.",
              },
              {
                method: "GET",
                path: "/.well-known/oauth-authorization-server",
                detail:
                  "Authorization server metadata (RFC 8414): authorize, token, and registration endpoints.",
              },
            ],
          },
        ],
      },
      {
        id: "mcp-tools",
        blocks: [
          {
            kind: "p",
            text: "There is one tool per agent API route, and each runs through that route's handler, so validation, scopes, and limits are identical. A tool the connection was not granted a scope for returns an error naming the missing scope.",
          },
          {
            kind: "bullets",
            items: [
              "`notify` sends a push; `notification_withdraw` removes it.",
              "`ask` sends an approval, yes/no, or reply prompt and waits up to ten minutes for your answer, sending progress updates while it waits. `interactions_create`, `interactions_wait`, `interactions_get`, `interactions_list`, and `interactions_cancel` split that up.",
              "`activities_start`, `activities_update`, `activities_end`, `activities_get`, and `activities_list` drive Live Activities.",
              "`services_*`, `devices_*`, `events_list`, `activity_feed`, `inbox_*`, `apps_*`, `billing_get`, and `tokens_*` manage the account.",
              "`teams_*`, `oncall_*`, and `pages_*` manage teams, rotations, and pages.",
              "`auth_status` shows the connection's scopes; `auth_revoke` disconnects the client.",
            ],
          },
          {
            kind: "note",
            text: "The human-only actions above are never tools: answering prompts, acknowledging or escalating pages, accepting invites, approving app sign-in, changing sharing or issuing passes, creating tokens, and billing checkout. Webhook URLs and join links in tool results are shown once and flagged as secrets.",
          },
        ],
      },
    ],
  },
];
