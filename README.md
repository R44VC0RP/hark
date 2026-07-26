# Hark

https://github.com/user-attachments/assets/74fd0670-2106-4af5-93c8-d31f99b33908

Hark turns webhooks into clean, source-branded iPhone notifications. Connect CI jobs, agents,
scripts, monitoring tools, or anything else that can send an HTTP request.

[Website](https://hark.ryan.ceo) | [Documentation](https://hark.ryan.ceo/docs)

## What Hark Does

- Sends rich iOS notifications from a simple webhook.
- Gives each service its own name, avatar, destination URL, and secret endpoint.
- Tracks delivery attempts and registered devices in a web dashboard.
- Supports approvals and text replies for agent workflows.
- Shows stateful task progress with Live Activities on the Lock Screen and Dynamic Island.
- Supports multiple devices and targeted delivery with Hark Pro.

## Get Started

1. Sign in at [hark.ryan.ceo](https://hark.ryan.ceo).
2. Register your iPhone with the Hark app.
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
| `url` | Optional destination opened when tapped. |
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
Hark allows one active Hark Live Activity per device; pass `replace: true` on start to silently end
whatever occupies the device and take the slot. Starting an activity may alert the user, but
progress updates are silent by default. High-priority updates control delivery speed, not sound or
haptics.

## Agent Workflows

The [`harkctl`](./packages/harkctl) CLI can send one-shot notifications, approval prompts, collect
short replies, and manage Live Activities from scripts or AI agents.

```sh
harkctl auth login
harkctl notify "Tests passed" --title "Mux"
harkctl ask "Deploy production?" --approval --wait
harkctl activity start --title "Release" --status "Building" --progress 0.1
```

## License

Hark is source-available under the
[PolyForm Noncommercial License 1.0.0](./LICENSE). Commercial use is not permitted without a
separate license from the licensor.
