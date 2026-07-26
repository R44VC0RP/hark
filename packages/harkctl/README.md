# harkctl

`harkctl` sends one-shot Hark notifications, creates approval/text-reply interactions, and controls
finite agent task Live Activities from Node.js 22 or newer.

Start a browser authorization flow and approve the requested scopes with your signed-in Hark account:

```sh
npx harkctl auth login
harkctl auth status
harkctl notify "Tests passed" --title "Mux" --url https://example.com/build/123
harkctl ask "Deploy production?" --approval --wait --timeout 15m --json
harkctl ask "What should the release note say?" --reply --device dev_... --wait
harkctl activity start --key release-main --title "Release" --status "Building" --progress 0.1 \
  --accent-color '#FF9F0A'
harkctl activity update release-main --status "Testing" --progress 0.7 \
  --accent-color '#64D2FF' --if-sequence 0
harkctl activity end release-main --status "Complete" --progress 1 --if-sequence 1
harkctl auth logout
```

Login prints a short code and verification URL to stderr, opens the system browser when interactive,
polls at the server-provided interval, and atomically writes credentials to a mode-`0600` file. The
default scopes support asks, Live Activities, and listing devices/services without requesting
`events:read`. Every requested scope is shown on the browser authorization page before approval.

Use repeatable `--scope`, `--client-name`, and `--expires-in` to narrow or label access. `--no-open`
suppresses browser launch; `--open` explicitly enables it in non-interactive environments. `--json`
keeps stdout to one machine-readable object while browser instructions remain on stderr.

As an advanced fallback, create a scoped token under **Dashboard > Agent access** and set
`HARK_TOKEN`, or put `{ "token": "hark_..." }` in the OS config file with mode `0600`:

- macOS: `~/Library/Application Support/hark/config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/hark/config.json`
- Windows: `%APPDATA%\hark\config.json`

Use `HARK_API_URL` for a self-hosted API. Tokens are never accepted on the command line or printed to
stdout. All successful command output is one stable JSON object; diagnostics use stderr.

Approval notifications always offer both Approve and Deny. Older scripts may use
`--approve --deny` together; either flag by itself is rejected as ambiguous.

`notify` sends a one-shot notification and exits immediately after Expo accepts or rejects the push
request. The message may be positional or supplied as `body` with `--stdin`; optional `--title`,
`--url`, `--image-url`, repeatable `--device`, and `--idempotency-key` values match the notification
API. A targeted device requires Hark Pro.

Activity commands accept flags or `--stdin` JSON. Use `activity get <id|key>` and `activity list` to
inspect state, `--idempotency-key` for retries, and `--if-sequence` to reject stale updates. Progress
is a number from 0 to 1. `--accent-color` accepts `#RRGGBB`. Activities default to an eight-hour
expiry and become stale after four hours without an update. Repeated `--device` targeting requires
Hark Pro, and Hark permits one active activity per device; pass `--replace` on `activity start` to
silently end whatever occupies the device and take the slot (the response reports the count as
`replaced`). A `--key` becomes reusable once its activity ends, so `activity start --key deploy
--replace` works as a fixed-key restart.

Exit codes: `0` success/approved/replied, `1` API error, `2` usage error, `3` authentication or
scope error, `4` timeout/canceled/expired, `5` denied, `6` network error, `7` no push accepted.
