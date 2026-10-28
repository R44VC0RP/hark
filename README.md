# Hark

https://github.com/user-attachments/assets/74fd0670-2106-4af5-93c8-d31f99b33908

Hark turns webhooks into clean, source-branded iPhone notifications. Connect CI jobs, agents,
scripts, monitoring tools, or anything else that can send an HTTP request.

[Website](https://hark.fyi) | [Documentation](https://hark.fyi/docs)

## Quick Start

Requires [Node.js 22 or newer](https://nodejs.org/).

1. Install the Hark skill for your agent:

   ```sh
   npx skills add R44VC0RP/hark --skill hark --global
   ```

2. Install the CLI:

   ```sh
   npm install -g harkctl
   ```

3. Authenticate it with your Hark account:

   ```sh
   harkctl auth login
   ```

4. Ask your agent:

   ```text
   What can Hark do?
   ```

Your agent can now notify your iPhone, request approvals or text replies, show task progress with
Live Activities, and create webhook services for external systems.

MCP clients can skip the CLI: add `https://hark.fyi/mcp` and sign in with OAuth. Agents can read
everything at [hark.fyi/agents.md](https://hark.fyi/agents.md), and the token API is described at
[hark.fyi/api/agent/openapi.json](https://hark.fyi/api/agent/openapi.json). Report problems in
[GitHub issues](https://github.com/R44VC0RP/hark/issues).

## What Hark Does

- Sends rich iOS notifications from a simple webhook.
- Gives each service its own name, avatar, destination URL, and secret endpoint.
- Tracks delivery attempts and registered devices in a web dashboard.
- Supports approvals and text replies for agent workflows.
- Shows stateful task progress with Live Activities on the Lock Screen and Dynamic Island.
- Shares web apps and on-call paging with your team.

Hark is free for personal use: one iPhone and 10,000 notifications a month, with approvals, Live
Activities, and web apps included. Teams pay $5 per seat per month (every member, the owner
included) to add people, share apps, and page. See [pricing](https://hark.fyi/pricing).

## Webhook Setup

1. Sign in at [hark.fyi](https://hark.fyi).
2. Register your iPhone with [Hark for iPhone](https://apps.apple.com/us/app/hark-developer-notifications/id6794121509).
3. Create a service and copy its secret webhook URL.
4. Send it a JSON request.

## Send a Notification

```sh
curl -X POST 'https://hark.fyi/hooks/whk_your_token' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "GitHub",
    "body": "Production deployed successfully.",
    "url": "https://github.com/acme/app/actions"
  }'
```

Only `body` is required.

| Field | Description |
| --- | --- |
| `body` | Notification text, up to 8,000 characters (16 KiB of UTF-8). |
| `title` | Optional sender-name override. |
| `imageUrl` | Optional public HTTPS avatar URL. |
| `url` | Optional web URL, app deep link, or Shortcuts URL opened when tapped. |
| `deviceIds` | Optional routing to specific devices; legacy Hark Pro accounts only (otherwise `402`). |
| `project` | Optional project name that groups the notification in the app inbox. |
| `summary` | Optional short digest used for the push banner and list previews. |
| `bodyFormat` | Optional `text` or `markdown` metadata for the stored body. |

Successful requests return an event ID and the number of push requests accepted for delivery:

```json
{
  "ok": true,
  "eventId": "evt_...",
  "delivered": 1
}
```

Use an `Idempotency-Key` header when retrying requests to prevent duplicate notifications.

### Withdraw a Delivered Notification

Use the returned event ID to request removal of a notification from registered iPhones:

```sh
curl -X POST \
  'https://hark.fyi/hooks/whk_your_token/events/evt_your_event/withdraw'
```

Hark sends a silent background command to each active device and cancels any pending interactive
response for the event. iOS treats background delivery as best effort, so a withdrawal can be
delayed or skipped by the system.

Tap destinations support HTTPS universal links, custom app schemes such as
`your-app://incidents/INC-42`, and Apple Shortcuts:

```text
shortcuts://run-shortcut?name=Deployment%20Follow-up&input=text&text=production%20deployed
```

Names and input must be URL-encoded. iOS opens the destination only after the recipient taps the
notification; delivery alone does not launch an app or run a shortcut.

## Live Activities

Start a stateful Live Activity using the same service webhook token:

```sh
curl -X POST 'https://hark.fyi/hooks/whk_your_token/live-activities' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Deploy #184",
    "status": "Building",
    "progress": 0.25,
    "symbol": "build",
    "accentColor": "#FF9F0A"
  }'
```

The response includes an `activityId`. Use it to update or end the activity:

```text
PATCH /hooks/:token/live-activities/:activityId
POST  /hooks/:token/live-activities/:activityId/end
```

Updates accept partial state such as `status`, `detail`, `progress`, `symbol`, and `accentColor`.
Hark allows one active task Live Activity per device; pass `replace: true` on start to silently end
whatever task occupies the device and take the slot. Interactive approval activities may coexist
with that task. Starting an activity may alert the user, but progress updates are silent by default.
High-priority updates control delivery speed, not sound or haptics.

To contribute a genuinely new Live Activity layout, including no-simulator testing and every public
API, widget, CLI, and docs touchpoint, see
[Contributing a Live Activity template](./CONTRIBUTING_LIVE_ACTIVITY_TEMPLATES.md).

## Web Apps

Open any HTTPS site you control full-screen in the Hark iPhone app. Hark hands the page a
short-lived signed **Hark pass**, so the site can identify the viewer without its own login.

```sh
harkctl apps create --name "Ops dashboard" --url https://app.example.com
harkctl notify "Nightly report is ready" --app app_... --url https://app.example.com/reports
```

Registering the same URL again updates the app. The app appears in Hark on your iPhone; the first
time it opens, you approve sign-in and choose whether your name (shared by default) and email (not
shared by default) are included. Notifications sent with `--app` (or `appId` in a webhook payload)
open the app when tapped; `url`, when given, must be on the app's origin.

Inside Hark, the page calls `await window.hark.getToken()` to get a pass (`window.hark` exists only
in the Hark app; `window.hark.close()` returns to Hark), sends it to its server, and verifies it:

```js
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://hark.fyi/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks, {
  issuer: "https://hark.ryan.ceo", // the pass issuer stays on the original domain
  audience: "https://app.example.com",
  typ: "hark-pass+jwt",
  algorithms: ["ES256"],
});
// payload.sub is the stable per-app user ID; payload.name / payload.email only if the owner shares them
```

Passes expire after two minutes, so verify once and then store your own session. `sub` is pairwise:
stable for your origin and different for every other app. Optionally reject a reused `jti` to block
replay.

## Teams and On-Call

Create a team to share web apps and page whoever is on call. Roles are owner, admin, and member.
Every member is a $5/month seat on the Team plan, the owner included. Until the owner starts the
Team plan from the team page on hark.fyi, invites, sharing apps into the team, on-call groups, and
pages return `402`.

```sh
harkctl teams create "Acme"
harkctl teams invite team_... --email teammate@example.com   # returns a 7-day join link
harkctl apps share app_... --team team_...
harkctl oncall create --team team_... --name Primary --members user_a,user_b --period weekly
harkctl page ocg_... "API error rate above 20%" --dedup-key api-5xx
```

Every member approves sign-in to a team app for themselves; the Hark pass then includes `team_id`
and `team_role`, and removing someone from the team stops their passes immediately. A page goes to
the person on call (rotations hand off at a local time and follow DST), then escalates to the next
person and the whole group until someone acknowledges from the lock screen or the website. Webhooks
page by adding `"oncall": "ocg_..."` to the payload; add `"urgency": "low"` for a single quiet alert
with no ringing or escalation (the default, `high`, rings until acknowledged). Acknowledging is
human-only; agents can raise
and resolve pages. See the [Teams](https://hark.fyi/docs#teams) and
[On-call](https://hark.fyi/docs#oncall) docs.

## Agent Workflows

The [`harkctl`](./packages/harkctl) CLI can send one-shot notifications, ask for approvals or short
replies, and manage Live Activities from scripts or AI agents.

```sh
harkctl auth login
harkctl notify "Deploy finished ✅" --title "Deploy bot"
harkctl notify ask "Deploy production?" --approval --wait
harkctl notify ask "Send the email?" --approval --live-activity \
  --primary-label Send --secondary-label Deny --wait
harkctl activity start --title "Release" --status "Building" --progress 0.1
```

The installable [`hark` agent skill](./skills/hark/SKILL.md) follows the open Agent Skills format
used by [skills.sh](https://skills.sh/r44vc0rp/hark/hark) and supports OpenCode, Claude Code, Codex,
Cursor, and other compatible agents.

`harkctl` can route permission requests from Claude Code, Codex, OpenCode V1, and OpenCode V2 to
Hark with one setup command:

```sh
npm install --global harkctl
harkctl auth login --client-name "Coding agent permissions"
harkctl permissions setup all
```

See the [coding-agent permission setup guide](https://hark.fyi/docs#cli-permissions) for
Claude Code, Codex, OpenCode V1, and OpenCode V2 details.

Only an explicit phone approval allows a request. Other outcomes deny it, and raw commands, patches,
prompts, file contents, and absolute paths are not sent to Hark.

## MCP

Hark runs a remote [MCP](https://modelcontextprotocol.io) server at `https://hark.fyi/mcp`
(Streamable HTTP). Add the URL to your client; it signs in with OAuth, so there is no token to
paste.

OpenCode (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "hark": { "type": "remote", "url": "https://hark.fyi/mcp" }
  }
}
```

Claude Code:

```sh
claude mcp add --transport http hark https://hark.fyi/mcp
```

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "hark": { "url": "https://hark.fyi/mcp" }
  }
}
```

The first tool call opens a browser: sign in to Hark, review the permissions the client asks for
(untick any you do not want), and approve. Under the hood this is OAuth 2.1 per the MCP
authorization spec: protected resource metadata at `/.well-known/oauth-protected-resource/mcp`,
authorization server metadata at `/.well-known/oauth-authorization-server`, dynamic client
registration for public clients, PKCE (S256) required, tokens bound to the `/mcp` resource,
one-hour access tokens, and refresh tokens when you allow "Stay connected". Hark remembers your
consent per client and permission set. Connected clients are listed on the dashboard, where
**Disconnect** revokes their access and refresh tokens immediately; agents with `tokens:manage` see
them as `kind: "oauth"` entries in `GET /api/agent/tokens`.

OAuth scopes are the [agent API](#agent-api) scopes one to one (`notifications:send`,
`interactions:create`, `interactions:read`, `activities:read`/`write`, `services:read`/`write`,
`devices:read`/`write`, `events:read`, `apps:read`/`write`, `inbox:read`/`write`,
`billing:read`, `tokens:manage`, `teams:read`/`write`, `oncall:read`/`write`) plus
`offline_access`. A client that requests no scope gets everything except `tokens:manage`.

There is one tool per agent API operation (65 in all), from `notify`, `ask` (sends a prompt and
waits up to ten minutes for your answer, with progress updates), and `activities_*` to services,
the inbox, web apps, teams, on-call, and pages. Each tool runs through the same handler, validation,
and scope check as its `/api/agent` route. Human-only actions are never tools: answering prompts,
acknowledging or escalating pages, accepting team invites, approving app sign-in, changing app
sharing or issuing Hark passes, creating tokens, and billing checkout or the billing portal.

## Agent API

Everything you can do in the dashboard or the phone inbox is also available to a scoped agent token
(`Authorization: Bearer hark_…`) under `/api/agent`, and through `harkctl`: services (get, update,
rotate, remove), devices, the project inbox (list, read, unread, read-all), the activity feed,
pending prompts, notification withdrawal, web app metadata and sign-out, billing, token
list/revoke, teams, on-call groups, and pages.

```sh
harkctl inbox list --unread
harkctl interaction list
harkctl notify withdraw anot_...
harkctl services rotate svc_...
```

A few actions stay human-only on purpose: answering prompts, creating API tokens, approving app
sign-in or changing what an app may see, registering devices, billing checkout, accepting team
invites, and acknowledging or escalating pages. Every route,
its scopes, and its request and response schemas are described by the public OpenAPI document at
[`/api/agent/openapi.json`](https://hark.fyi/api/agent/openapi.json); see the
[Agent API docs](https://hark.fyi/docs#agent-api).

## License

Hark is source-available under the
[PolyForm Noncommercial License 1.0.0](./LICENSE). Commercial use is not permitted without a
separate license from the licensor.
