# On-call paging: how pages ring

A page should keep ringing until a person acknowledges it, like PagerDuty. This note covers how
Hark does that, the flags involved, and why it doesn't use AlarmKit.

## What happens when a page is raised

1. The server sends the paged person a page push (`buildPagePushMessages` in
   `apps/website/src/server/lib/push.ts`):
   - the bundled alarm sound `hark-page.caf` (28 s, generated, royalty-free; in
     `apps/expo/assets/sounds/`). Builds without the file fall back to the default sound.
   - `interruptionLevel: "time-sensitive"`, which breaks through Focus but not the silent switch.
   - `collapseId: hark-page-<pageId>` (APNs `apns-collapse-id`), so repeats replace the alert on
     screen instead of stacking. The notification service extension also removes any earlier alert
     for the same page.
2. While the page is `triggered`, the on-call worker (every 5 s, in `lib/oncall.ts`) sends the
   same alert again every `ringIntervalSeconds` (group setting, 30–300 s, default 60), up to
   `ringMaxRepeats` times (0–30, default 10). Each repeat plays the sound again.
3. Ringing stops at once on acknowledge or resolve. If a repeat was already in flight, the server
   sends another silent `page.claimed` to clear it.
4. Each escalation level rings the people it pages. With `escalationMode: "fan_out"` (default)
   earlier levels keep ringing; with `"hand_off"` a new level silences them. See below.

The state lives in `oncall_page_recipient.next_ring_at` / `ring_count`. Each repeat is claimed by
ring count and due time, so repeats are idempotent and survive restarts. Repeats are not billed as
extra notifications. They are bounded by the 30 s interval floor and the 30-repeat cap, and the
page-creation rate limits still apply.

Each person can turn off "Ring until acknowledged" (pages then alert once) or set their own
interval (`GET/PATCH /api/oncall/settings`, MCP `oncall_settings_get` / `oncall_settings_update`,
the app's On call screen, and the dashboard).

## Escalation policy

A group's policy is level 0 plus up to 5 levels in `escalation` (contracts:
`oncallEscalationStepSchema`; runtime: `plannedStep` and `escalatePage` in `lib/oncall.ts`).

- **Level 0** is whoever is on call, or the whole group when nobody is.
- **Levels 1..n** are `{ afterMinutes, target, userIds?, groupId? }`. `afterMinutes` (1–1440) is
  the previous level's acknowledgement timeout. `target` is `next` (next in the rotation),
  `oncall` (whoever is on call here, or in `groupId`, another group in the same team), `people`
  (`userIds`, 1–20 team members, all at once), `group`, or `team`. Create and update reject IDs
  outside the team.
- **`escalationMode`**: `fan_out` (default) keeps earlier levels ringing; `hand_off` silences them
  when a new level starts. Older groups that only had `next` steps used to hand off; they now fan
  out unless set to `hand_off`.
- **`escalationLoops`** (0–3): after the last level, run the policy again from level 0. The last
  level waits as long as the first (`escalation[0].afterMinutes`) before a loop starts.
- **`escalationFinal`** (`none` / `group` / `team`): paged once after the last level and loops,
  after the same wait.
- **Claim = acknowledge.** The status compare-and-set lets only the first acknowledgement win.
  Everyone else's ringing stops and their alert is replaced (same collapse ID) by a passive,
  silent "Claimed by <name>" notice carrying `page.claimed`.
- **Manual Escalate** jumps to the next level now and records who escalated; past the end it pages
  the group (or the team when `escalationFinal` is `team`). Acknowledge and escalate stay
  human-only: no agent route or MCP tool.
- **Timeline.** `oncall_page_event` rows become `OncallPageDto.timeline`: `paged` (with `level`,
  `loop`, the people, and `escalatedBy` for manual escalation), `acknowledged`, and `resolved`.
  Pages from before the table fall back to their recipients.

Escalation runs off `oncall_page.escalationStep` and `nextEscalationAt`, claimed by
compare-and-set on the step number, so timers are idempotent and survive restarts. Re-paging
someone already notified (a loop, or a later level naming them) sends a fresh alert and restarts
their repeats. Each escalation step that pushes counts once against rate limits and billing.

## Critical Alerts (waiting on Apple)

A critical alert plays at full volume through the silent switch and every Focus. It needs the
`com.apple.developer.usernotifications.critical-alerts` entitlement, which Apple grants on request.

It is wired up already, behind a build flag:

- **`HARK_CRITICAL_ALERTS=1`** (build-time env, read in `apps/expo/app.config.ts`) adds the
  entitlement and sets `extra.criticalAlerts`. Leave it unset until Apple approves: with it set,
  signing fails because the provisioning profile lacks the entitlement.
- With the flag on, the app's On call screen shows a Critical Alerts row that opens an
  explanation screen (`app/critical-alerts.tsx`). That screen asks iOS for `allowCriticalAlerts`.
  With the flag off, the app never asks and reports `unavailable`.
- The app reports the permission (`authorized`, `denied`, `notDetermined`, `unavailable`) when
  it registers and whenever the On call screen loads (`POST /api/devices/alert-settings`).
- The server sends `interruptionLevel: "critical"` and
  `sound: { critical: true, name: "hark-page.caf", volume: 1 }` only to devices that reported
  `authorized`. Every other device gets time-sensitive plus the alarm sound. No server flag is
  needed.

### Turning it on once Apple approves

1. In the Apple Developer portal, confirm that the `ceo.ryan.hark` App ID shows the Critical
   Alerts capability, then regenerate the provisioning profiles (or let EAS do it).
2. Add `HARK_CRITICAL_ALERTS=1` to the `env` of the EAS build profiles in `apps/expo/eas.json`,
   or set it as an EAS environment variable.
3. Build, install, open On call › Critical Alerts › Allow, and send a test page with the phone on
   silent.

## Why not AlarmKit

AlarmKit (iOS 26+) alarms do break through silent mode and Focus without a special entitlement.
They only need `NSAlarmKitUsageDescription` and the user's permission. But AlarmKit can't be
triggered reliably from a push, so Hark doesn't use it:

- There is no push type or push-to-start token for alarms. `AlarmManager.schedule` can only be
  called from the app's own process.
  ([AlarmManager](https://developer.apple.com/documentation/alarmkit/alarmmanager))
- A Notification Service Extension only rewrites content, and AlarmKit isn't documented as usable
  from extensions. A Live Activity push runs no app code. Silent background pushes are throttled,
  are never guaranteed to arrive (Apple DTS), and stop entirely after the user force-quits the app.
  ([forum thread 835645](https://developer.apple.com/forums/thread/835645),
  [background updates](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app))
- Apple positions alarms for countdowns and scheduled alerts, "not a replacement for … critical
  alerts or time-sensitive notifications."
  ([WWDC25 "Wake up to the AlarmKit API"](https://developer.apple.com/videos/play/wwdc2025/230/))
  A pager built on it is a review risk.
- Developers report alarms firing late or not at all on locked devices on iOS 26, and more
  issues in the iOS 27 betas.

An alarm that only rings when iOS happens to wake the app would be worse than a dependable
time-sensitive alert, so Critical Alerts is the path for ringing through silent mode. PushKit and
CallKit "fake calls" are not used either: App Review rejects them for anything other than VoIP.
