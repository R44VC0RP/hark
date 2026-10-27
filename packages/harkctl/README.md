# harkctl

`harkctl` sends Hark push notifications, asks approval/text questions, and controls finite agent
task Live Activities from Node.js 22 or newer.

```
harkctl
├─ auth         login · logout · status
├─ notify       <body>                          one-shot push
│  ├─ ask       <prompt> (--approval | --yes-no | --text)  push that elicits an answer
│  └─ withdraw  <notification_id>               remove a sent push from your phones
├─ interaction  list · get <id> · wait <id>
├─ activity     start · update · end · get · list · feed
├─ inbox        projects · list · get · read · unread · read-all
├─ permissions  setup · doctor · uninstall
├─ devices      list · remove
├─ services     create · list · get · update · rotate · remove
├─ apps         create · list · get · update · share · revoke · remove
├─ teams        list · create · get · rename · delete · leave · members · role
│               remove-member · invite · invites · revoke-invite
├─ oncall       list · me · get · create · update · override · remove-override
│               settings · settings set
├─ page         <group_id> <title>                page whoever is on call
├─ pages        list · get · resolve
├─ billing
└─ tokens       list · revoke
```

Prefer MCP? The same operations are available as tools from Hark's remote MCP server at
`https://hark.ryan.ceo/mcp`, which signs in with OAuth instead of a token
([setup](https://hark.ryan.ceo/docs#mcp)).

Start a browser authorization flow and approve the requested scopes with your signed-in Hark account:

```sh
npx harkctl@0.8.0 auth login
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
default scopes support notifications, asks, Live Activities, devices, webhook services, web apps,
the inbox, billing, teams, and on-call. They exclude `events:read` (needed by `activity feed`) and `tokens:manage`
(needed by `tokens`); add them with `--scope`. Every requested scope is shown on the browser
authorization page before approval. Connected tokens appear under **Dashboard > Agent connections**, where they can be revoked.

Use repeatable `--scope`, `--client-name`, and `--expires-in` to narrow or label access. `--no-open`
suppresses browser launch; `--open` explicitly enables it in non-interactive environments. `--json`
keeps stdout to one machine-readable object while browser instructions remain on stderr.

## notify

`harkctl notify <body>` sends a one-shot push to your registered iPhones. `--title` sets the sender
name (defaults to “Hark”), `--image` sets the avatar shown with the notification, `--url` is opened
when the notification is tapped, and repeatable `--device` routes to specific device IDs (Hark Pro).
Use `--idempotency-key` for safe retries and `--stdin` to merge a JSON payload from stdin under any
explicit flags. The command exits `7` when no push was accepted. `--stdin` accepts only `body`,
`title`, `summary`, `project`, `bodyFormat`, `imageUrl`, and `url` (routing such as devices, `--app`,
and `--oncall` stays flag-only) and exits `2` on any other key; a stdin `url` must be `https://`
unless `--allow-custom-scheme` is passed.

Bodies hold up to 8,000 characters (16 KiB of UTF-8); the CLI rejects anything larger before
sending. `--project <name>` files the notification into a named project in the Hark app inbox —
project names are case-insensitive per account and created on first use. `--summary <text>` sets
the short text shown in the push banner and list previews while the full body stays readable in
the app; provide one whenever the body is long. `--markdown` (or `--body-format markdown`) records
the body as Markdown for future rendering; the app displays plain text with tappable links in V1.
`--app <app_id>` opens that web app in Hark when the notification is tapped; `--url`, if given,
must be on the app's origin.

```bash
long_report="$(./release-report.sh)"
jq -n --arg body "$long_report" '{ body: $body }' | harkctl notify --stdin \
  --title "Deploy bot" --project "Acme App" --summary "Deploy finished: 3 services updated"
```

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

`harkctl notify withdraw <notification_id>` removes an agent notification from your phones with a
silent background command and marks its inbox copy read. It accepts the `anot_…` ID from the
`notify` response or the `notification:anot_…` inbox ID. `harkctl notify -- withdraw` sends the
literal body “withdraw”.

## interaction

`interaction list` shows every pending prompt on the account, from any token or webhook. Agents can
read prompts but never answer them: only a human on the phone or a signed-in session approves.

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

`services get <id>` shows one service (without its webhook URL). `services update <id>` changes
`--title`, `--image`, or `--url` (or `--stdin` JSON). `services rotate <id>` replaces the webhook
token and prints the new `webhookUrl` once; the old URL stops working immediately.
`services remove <id>` deletes the service.

## devices

`devices list` shows registered iPhones. `devices remove <id>` (scope `devices:write`) removes one;
it registers again the next time Hark opens on that phone. Registration itself is phone-only.

## inbox

The inbox commands mirror the Hark app inbox (scopes `inbox:read` and `inbox:write`):
`inbox projects` lists projects with unread counts, `inbox list` pages notifications newest first
(`--project <id|unfiled>`, `--unread`, `--limit`, and `--cursor <nextCursor>`), `inbox get <id>`
returns one notification with its full body, and `inbox read <id>` / `inbox unread <id>` toggle
its read state. IDs look like `event:evt_…` or `notification:anot_…`. `inbox read-all
[--project <id|unfiled>]` marks everything read up to the moment it runs; notifications arriving
meanwhile stay unread.

`activity feed [--filter all|notification|live_activity|response] [--page <n>]` returns the
dashboard's activity history, 20 entries per page (scope `events:read`).

## billing and tokens

`billing` prints the plan, limits, and remaining monthly notifications (scope `billing:read`).
Checkout and the billing portal stay in the dashboard.

`tokens list` shows the account's agent tokens (never their secrets) and `tokens revoke <id>`
revokes one; both need the opt-in `tokens:manage` scope. There is no command that creates a token:
a token that could mint tokens could grant itself any scope, so new tokens always need a signed-in
human (`harkctl auth login`).

## apps

`apps create --name <name> --url <url> [--icon <url>] [--project <name>]` registers a web app that
opens full-screen in the Hark iPhone app with a signed Hark pass (see the
[Web Apps docs](https://hark.ryan.ceo/docs#web-apps)). Creating an app with an existing URL updates
it and prints `(updated existing)`. `apps list`, `apps get <app_id>`, and `apps remove <app_id>`
manage registered apps. `apps update <app_id>` changes `--name`, `--url`, `--icon` (or
`--no-icon`), and `--project` (or `--no-project`); moving the URL to a different origin clears
sign-in approval, so the owner approves the new site on the phone. `apps revoke <app_id>` signs the
app out until the owner approves it again. Sharing preferences and sign-in approval are never
changed by the CLI.
These commands print readable lines; pass `--json` for the API response. They require the
`apps:read` and `apps:write` scopes; logins created before those scopes existed need to sign in
again (`harkctl auth login`).

`apps create --team <team_id>` adds the app to a team instead, and `apps share <app_id>
(--team <team_id> | --personal) [--no-notify]` moves an app you added into a team or back to your
own apps. Other members are notified (unless `--no-notify`) and each approves sign-in on their own
phone; their Hark pass then carries `team_id` and `team_role`.

## teams

Teams share web apps and on-call groups (scopes `teams:read` and `teams:write`). `teams create
<name>` makes you the owner; `teams list`, `teams get <team_id>`, and `teams members <team_id>`
read; `teams rename`, `teams delete` (owner), and `teams leave` manage it. `teams role <team_id>
<user_id> <owner|admin|member>` changes a role (`owner` transfers ownership; the previous owner
becomes an admin), and `teams remove-member <team_id> <user_id>` removes someone, which also stops
their sign-in to the team's apps and drops them from rotations. `teams invite <team_id> [--email
<email>] [--role member|admin]` returns a 7-day join link (`code` and `url`); a Hark user with that
email also gets a push. Accepting is human-only, in the app or on the website. `teams invites` and
`teams revoke-invite <team_id> <invite_id>` manage links. The first seat is free; inviting more
people needs the $5/seat/month team plan (the API answers `402` with code `seat_limit`).

## oncall and page

On-call groups belong to a team (scopes `oncall:read` and `oncall:write`; creating and editing
needs a team admin). `oncall create --team <team_id> --name <name> --members <user_id,...>
[--period daily|weekly] [--handoff HH:MM] [--timezone <zone>] [--starts-at <iso>]` sets up a
rotation (defaults: daily, 09:00, your local zone; the first member is on call now) with the
default escalation (next person after 5 minutes, the whole group 10 minutes later); pass
`--stdin` JSON for a custom `escalation`. `oncall update <group_id>` changes any of those fields,
keeping the rest. `oncall override <group_id> --user <user_id> --starts-at <iso> --ends-at <iso>`
puts someone on call for a window and `oncall remove-override <group_id> <override_id>` removes it.
`oncall list --team <team_id>`, `oncall get <group_id>`, and `oncall me` show current and upcoming
shifts.

Pages ring until someone acknowledges: whoever is being paged gets the alert again every
`--ring-interval <seconds>` (30–300, default 60) up to `--ring-repeats <n>` times (0–30, default
10; `0` alerts once). Both work on `oncall create` and `oncall update` (or `ringIntervalSeconds`
and `ringMaxRepeats` in `--stdin` JSON). Repeats replace the alert on the phone instead of stacking
and are not billed as extra notifications. `oncall settings` shows your own paging preferences and
each iPhone's Critical Alerts status; `oncall settings set [--ring-until-ack on|off]
[--ring-interval <seconds|group>]` turns ringing off for you or sets a personal interval
(`group` goes back to each group's interval). These apply to you in every group.

`page <group_id> <title> [--body <text>] [--url <url>] [--app <app_id>] [--dedup-key <key>]`
pages whoever is on call (or the whole group when nobody is) and escalates until someone
acknowledges. A repeat with the same `--dedup-key` merges into the open page. `notify <body>
--oncall <group_id>` does the same from `notify`, using `--idempotency-key` as the dedup key. Both
exit `7` when the page reached no device. `pages list --team <team_id> [--all] [--limit <n>]
[--cursor <c>]`, `pages get <page_id>`, and `pages resolve <page_id> [--note <text>]` follow up.
Acknowledging and escalating are deliberately human-only: an acknowledgement tells the team a
person is on it.

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

Use `HARK_API_URL` for a self-hosted API: set it for `harkctl auth login`, which stores it with the
token, or together with `HARK_TOKEN`. A stored token is only sent to the API it was minted for; if
`HARK_API_URL` names a different one, commands exit `3` instead of using it. API URLs must use
`https://` (plain `http://` only for localhost). Tokens are never accepted on the command line or printed to
stdout. All successful command output is one stable JSON object; diagnostics use stderr.

Exit codes: `0` success/approved/yes/replied, `1` API error, `2` usage error, `3` authentication or
scope error, `4` timeout/canceled/expired, `5` denied/no, `6` network error, `7` no push accepted.
