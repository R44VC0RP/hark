# Hark

https://github.com/user-attachments/assets/74fd0670-2106-4af5-93c8-d31f99b33908

Hark turns webhooks into clean, source-branded iPhone notifications. Connect CI jobs, agents,
scripts, monitoring tools, or anything else that can send an HTTP request.

[Website](https://hark.ryan.ceo) | [Documentation](https://hark.ryan.ceo/docs)

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

## What Hark Does

- Sends rich iOS notifications from a simple webhook.
- Gives each service its own name, avatar, destination URL, and secret endpoint.
- Tracks delivery attempts and registered devices in a web dashboard.
- Supports approvals and text replies for agent workflows.
- Shows stateful task progress with Live Activities on the Lock Screen and Dynamic Island.
- Supports multiple devices and targeted delivery with Hark Pro.

## Webhook Setup

1. Sign in at [hark.ryan.ceo](https://hark.ryan.ceo).
2. Register your iPhone with [Hark for iPhone](https://apps.apple.com/us/app/hark-developer-notifications/id6794121509).
3. Create a service and copy its secret webhook URL.
4. Send it a JSON request.

## Send a Notification

```sh
curl -X POST 'https://hark.ryan.ceo/hooks/whk_your_token' \
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
| `body` | Notification text. |
| `title` | Optional sender-name override. |
| `imageUrl` | Optional public HTTPS avatar URL. |
| `url` | Optional web URL, app deep link, or Shortcuts URL opened when tapped. |
| `deviceIds` | Optional Pro routing to specific devices. |

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
  'https://hark.ryan.ceo/hooks/whk_your_token/events/evt_your_event/withdraw'
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
curl -X POST 'https://hark.ryan.ceo/hooks/whk_your_token/live-activities' \
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

See the [coding-agent permission setup guide](https://hark.ryan.ceo/docs#cli-permissions) for
Claude Code, Codex, OpenCode V1, and OpenCode V2 details.

Only an explicit phone approval allows a request. Other outcomes deny it, and raw commands, patches,
prompts, file contents, and absolute paths are not sent to Hark.

## License

Hark is source-available under the
[PolyForm Noncommercial License 1.0.0](./LICENSE). Commercial use is not permitted without a
separate license from the licensor.
