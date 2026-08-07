# harkctl

`harkctl` sends Hark push notifications, asks approval/text questions, and controls finite agent
task Live Activities from Node.js 22 or newer.

```
harkctl
├─ auth         login · logout · status
├─ notify       <body>                          one-shot push
│  └─ ask       <prompt> (--approval | --yes-no | --text)  push that elicits an answer
├─ interaction  get <id> · wait <id>
├─ activity     start · update · end · get · list
├─ permissions  setup · doctor · uninstall
├─ devices      list
└─ services     create · list
```

Start a browser authorization flow and approve the requested scopes with your signed-in Hark account:

```sh
npx harkctl auth login
harkctl auth status
harkctl notify "Deploy finished ✅" --title "Deploy bot" --image https://example.com/bot.png \
  --url https://example.com/runs/1
harkctl notify ask "Deploy production?" --approval --wait --timeout 15m --json
harkctl notify ask "What should the release note say?" --text --device dev_... --poll
harkctl services create --title "Release bot" --image https://example.com/bot.png
harkctl activity start --key release-main --title "Release" --status "Building" --progress 0.1 \
  --accent-color '#FF9F0A'
harkctl activity update release-main --status "Testing" --progress 0.7 \
  --accent-color '#64D2FF' --if-sequence 0
harkctl activity end release-main --status "Complete" --progress 1 --if-sequence 1
harkctl auth logout
```

Login prints a short code and verification URL to stderr, opens the system browser when interactive,
polls at the server-provided interval, and atomically writes credentials to a mode-`0600` file. The
default scopes support notifications, asks, Live Activities, listing devices/services, and creating
webhook services without requesting `events:read`. Every requested scope is shown on the browser authorization page before
approval. Connected tokens appear under **Dashboard > Agent connections**, where they can be revoked.

Use repeatable `--scope`, `--client-name`, and `--expires-in` to narrow or label access. `--no-open`
suppresses browser launch; `--open` explicitly enables it in non-interactive environments. `--json`
keeps stdout to one machine-readable object while browser instructions remain on stderr.

## notify

`harkctl notify <body>` sends a one-shot push to your registered iPhones. `--title` sets the sender
name (defaults to “Hark”), `--image` sets the avatar shown with the notification, `--url` is opened
when the notification is tapped, and repeatable `--device` routes to specific device IDs (Hark Pro).
Use `--idempotency-key` for safe retries and `--stdin` to merge a JSON payload from stdin under any
explicit flags. The command exits `7` when no push was accepted.

`--url` accepts HTTPS universal links, app deep links, and Apple Shortcuts URLs. Quote destinations
that contain `&` in a shell:

```bash
harkctl notify "Production deployed" \
  --url 'shortcuts://run-shortcut?name=Deployment%20Follow-up&input=text&text=production'
```

The shortcut name and text must be URL-encoded. The destination opens only after the recipient taps
the notification, and iOS can require an unlock or shortcut-specific permission.

`harkctl notify ask <prompt>` sends a push that elicits an answer. Pass exactly one of `--approval`
(Approve/Deny buttons), `--yes-no` (Yes/No buttons), or `--text` (a short free-form reply). It
shares the appearance flags above
plus `--expires-in` (default `15m`). Without a waiting flag it returns the pending interaction
immediately; read the answer later with `interaction get` or `interaction wait`. With `--wait
[--timeout <duration>]` it blocks until the answer arrives or the timeout passes. With `--poll` it
waits at most 20 seconds to catch an instant answer and then returns. A timed-out poll or wait
does not end the prompt — it stays answerable on the phone until it expires, and
`harkctl interaction wait <id>` resumes waiting at any time; `--poll` cannot be combined with
`--wait` or `--timeout`.

Use `--live-activity` with `--approval` or `--yes-no` to put the decision directly on the Lock
Screen and expanded Dynamic Island. Optional `--primary-label` and `--secondary-label` customize
the visible verbs without changing the canonical approve/deny or yes/no result:

```bash
harkctl notify ask "Send the prepared release email?" \
  --approval --live-activity \
  --primary-label Send --secondary-label Deny \
  --wait --timeout 15m
```

Interactive Live Activity prompts require iOS 17 or later, are limited to 240 characters, expire
within eight hours, and don't support `--text`, `--image`, or `--url`. Custom action labels are 1 to
24 characters. If no capable device accepts the activity, the command exits `7` just like an
undeliverable notification.

Inside `notify`, a first positional of exactly `ask` selects the subcommand. Everything after a bare
`--` separator is treated as positional, so `harkctl notify -- ask` sends the literal body “ask”.

## interaction

`interaction get <id>` prints the current state and maps terminal states to exit codes.
`interaction wait <id> [--timeout <duration>]` long-polls until the interaction is answered,
canceled, or expired, or the timeout passes (default `60s`).

## services

`services create --title <title> [--image <url>] [--url <url>]` creates a persistent webhook
service and prints its full `webhookUrl` in the JSON response. The title and image become defaults
for notifications sent through that URL, while `--url` sets the default tap destination. Pass
`--stdin` to supply the service object as JSON. `services list` shows existing services without
printing their webhook credentials. Creating services requires `services:write`; existing CLI
logins created before this scope was added need to sign in again.

## activity

Activity commands accept flags or `--stdin` JSON. Use `activity get <id|key>` and `activity list` to
inspect state, `--idempotency-key` for retries, and `--if-sequence` to reject stale updates. Progress
is a number from 0 to 1. `--accent-color` accepts `#RRGGBB`. `--style` on `activity start` and
`activity update` picks the widget layout: `standard` (default), `ring`, `hero`, `terminal`, or
`steps`; app builds that predate a style render the standard layout until updated. Activities default to an eight-hour
expiry and become stale after four hours without an update. Repeated `--device` targeting requires
Hark Pro, and Hark permits one active task activity per device; pass `--replace` on `activity start`
to silently end whatever task occupies the device and take the slot (the response reports the count
as `replaced`). Interactive approval activities may coexist with that task. A `--key` becomes
reusable once its activity ends, so `activity start --key deploy --replace` works as a fixed-key
restart.

Activity flag inventory:

- Start: `--title`, `--status`, `--key`, `--detail`, `--progress`, `--symbol`, `--privacy`,
  `--style`, `--accent-color`, repeatable `--device`, `--expires-in`, `--stale-after`, `--replace`,
  `--idempotency-key`, and `--stdin`.
- Update: `--title`, `--status`, `--detail`, `--progress`, `--symbol`, `--privacy`, `--style`,
  `--accent-color`, `--stale-after`, `--if-sequence`, `--idempotency-key`, and `--stdin`.
- End: `--status`, `--detail`, `--progress`, `--symbol`, `--accent-color`, `--dismiss-after`,
  `--if-sequence`, `--idempotency-key`, and `--stdin`.

## permissions

Route permission requests from Claude Code, Codex, OpenCode V1, and OpenCode V2 to Hark:

```sh
harkctl permissions setup all
```

Install or remove one integration at a time:

```sh
harkctl permissions setup claude
harkctl permissions setup codex
harkctl permissions setup opencode
harkctl permissions doctor
harkctl permissions uninstall all
```

The default login includes the required `notifications:send`, `interactions:create`, and
`interactions:read` scopes. A narrowed login must retain all three; setup and `doctor` identify any
missing scopes. See the [agent permission setup guide](https://hark.ryan.ceo/docs#cli-permissions)
for privacy, trust, and platform details.

Claude Code and Codex use synchronous `PermissionRequest` hooks. After Codex setup, open `/hooks`
and trust the Hark hook. OpenCode setup installs both connectors: a V1 plugin shim for current V1
servers (`1.0.204` or newer) and a per-user macOS LaunchAgent for the shared V2 service.

Only an explicit Hark approval grants a request, and it grants it once. Denial, timeout,
authentication failure, network failure, malformed input, and no-device delivery all deny. Phone
prompts contain only the agent name, permission/tool name, project directory basename, and resource
count. Raw commands, patches, prompts, file contents, URLs, environment variables, transcript paths,
and absolute paths are not sent to Hark.

Setup merges existing Claude and Codex JSON atomically. Uninstall removes only Hark-owned hooks,
the V1 shim, and the V2 LaunchAgent; it never removes shared Hark credentials or unrelated agent
configuration. The OpenCode background connector currently requires macOS. Permission hooks use the
user-owned harkctl credential file and intentionally do not inherit `HARK_TOKEN` or `HARK_API_URL`.

## Configuration

As an advanced fallback, set `HARK_TOKEN` to a scoped token secret (for example one minted by
`harkctl auth login` on another machine), or put `{ "token": "hark_..." }` in the OS config file
with mode `0600`:

- macOS: `~/Library/Application Support/hark/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/hark/config.json`
- Windows: `%APPDATA%\hark\config.json`

Use `HARK_API_URL` for a self-hosted API. Tokens are never accepted on the command line or printed to
stdout. All successful command output is one stable JSON object; diagnostics use stderr.

Exit codes: `0` success/approved/yes/replied, `1` API error, `2` usage error, `3` authentication or
scope error, `4` timeout/canceled/expired, `5` denied/no, `6` network error, `7` no push accepted.
