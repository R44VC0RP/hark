/**
 * Every date and time Hark shows, in a few named formats modelled on Apple's
 * own apps (DESIGN.md 3.13). Times of day follow the device's locale and its
 * 12/24-hour setting everywhere; the words ("now", "min ago", "Yesterday")
 * are English like the rest of Hark's copy.
 *
 * - `formatListDate`: the trailing time of a past item in a list, like Mail:
 *   "9:41 AM" today, "Yesterday", "Tuesday" this week, "11/12/25" before.
 * - `formatAgo`: how long ago something still live happened (a request
 *   waiting on you, a page): "now", "4 min ago", "2 hr ago"; from a day on,
 *   the list date.
 * - `formatTimeLeft`, `formatTimeUntil`: countdowns in the same units,
 *   "13 min left", "in 4 min".
 * - `formatDateTime`: one date and time in details and timelines:
 *   "Today at 9:41 AM", "Yesterday at 9:41 AM", "Nov 12 at 9:41 AM".
 * - `formatUpcoming`: a coming time inside a phrase ("Until …", "Next: …",
 *   "Expires …"): "9:41 AM" today, "Sat at 9:41 AM" this week, "Nov 26 at
 *   9:41 AM" later.
 * - `formatHandoffClock`: a rotation's handoff ("09:00" in its time zone) on
 *   this device's clock.
 * - `spokenTime`: VoiceOver words for any of them ("4 minutes ago").
 *
 * Pure (no React Native imports), so it stays unit-testable.
 */

type DateInput = string | number | Date;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

let hourCycle: "h12" | "h23" | undefined;

/**
 * The device's 12/24-hour switch, when it overrides the locale's default
 * (read once at launch in `app/_layout.tsx`). `undefined` keeps the locale's.
 */
export function setHourCycle(value: "h12" | "h23" | undefined): void {
  hourCycle = value;
}

function toTime(value: DateInput): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === "number" ? value : Date.parse(value);
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Calendar days from `now`'s day to `time`'s day: 0 today, −1 yesterday, 1 tomorrow. */
function dayOffset(time: number, now: number): number {
  return Math.round((startOfDay(time) - startOfDay(now)) / DAY_MS);
}

/** "Nov 12" this year, "Nov 12, 2025" in another. */
function monthDay(time: number, now: number, locale?: string): string {
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return new Date(time).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** A time of day on this device's clock: "9:41 AM" or "09:41". */
export function formatClock(value: DateInput, locale?: string): string {
  return new Date(toTime(value)).toLocaleTimeString(
    locale,
    hourCycle ? { hour: "numeric", minute: "2-digit", hourCycle } : { timeStyle: "short" },
  );
}

/** Mail's list timestamp: "9:41 AM" today, "Yesterday", "Tuesday" this week, "11/12/25" before. */
export function formatListDate(value: DateInput, now = Date.now(), locale?: string): string {
  const time = toTime(value);
  const days = dayOffset(time, now);
  if (days === 0) return formatClock(time, locale);
  if (days === -1) return "Yesterday";
  if (days < -1 && days > -7) return new Date(time).toLocaleDateString(locale, { weekday: "long" });
  return new Date(time).toLocaleDateString(locale, { dateStyle: "short" });
}

/** "now", "4 min ago", "2 hr ago"; a day or more ago, the list date ("Yesterday"). */
export function formatAgo(value: DateInput, now = Date.now(), locale?: string): string {
  const elapsed = Math.max(0, now - toTime(value));
  if (elapsed < MINUTE_MS) return "now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} hr ago`;
  return formatListDate(value, now, locale);
}

/** "13 min left", "5 hr left", and from two days "3 days left". */
export function formatTimeLeft(value: DateInput, now = Date.now()): string {
  const minutes = Math.max(0, Math.ceil((toTime(value) - now) / MINUTE_MS));
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} hr left`;
  return `${Math.ceil(hours / 24)} days left`;
}

/** "now", "in 4 min", "in 2 hr": when something scheduled happens next. */
export function formatTimeUntil(value: DateInput, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((toTime(value) - now) / MINUTE_MS));
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${Math.round(minutes / 60)} hr`;
}

/** "Today at 9:41 AM", "Yesterday at …", "Tomorrow at …", "Nov 12 at …", "Nov 12, 2025 at …". */
export function formatDateTime(value: DateInput, now = Date.now(), locale?: string): string {
  const time = toTime(value);
  const days = dayOffset(time, now);
  const day =
    days === 0
      ? "Today"
      : days === -1
        ? "Yesterday"
        : days === 1
          ? "Tomorrow"
          : monthDay(time, now, locale);
  return `${day} at ${formatClock(time, locale)}`;
}

/** Inside a phrase: "9:41 AM" today, "Sat at 9:41 AM" this week, "Nov 26 at 9:41 AM" later. */
export function formatUpcoming(value: DateInput, now = Date.now(), locale?: string): string {
  const time = toTime(value);
  const clock = formatClock(time, locale);
  const days = dayOffset(time, now);
  if (days === 0) return clock;
  if (days > 0 && days < 7) {
    return `${new Date(time).toLocaleDateString(locale, { weekday: "short" })} at ${clock}`;
  }
  return `${monthDay(time, now, locale)} at ${clock}`;
}

/**
 * The wall clock in `timeZone` at `instant`, as a local timestamp of this
 * device (so it compares with `Date#setHours`). Parses a fixed en-US string:
 * Hermes on iOS has no real `formatToParts`.
 */
function wallClockIn(instant: number, timeZone: string): number {
  const text = new Date(instant).toLocaleString("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  const [month, day, year, hour, minute] = (text.match(/\d+/g) ?? []).map(Number);
  if (month === undefined || day === undefined || year === undefined) throw new Error(text);
  if (hour === undefined || minute === undefined) throw new Error(text);
  const pm = /pm/i.test(text);
  const hours = /am|pm/i.test(text) ? (hour % 12) + (pm ? 12 : 0) : hour % 24;
  return new Date(year, month - 1, day, hours, minute).getTime();
}

/**
 * A rotation's handoff, "HH:MM" in its own time zone, on this device's
 * clock today: a London "10:00" reads "5:00 AM" in New York, like the
 * shifts listed under it. An unknown time zone shows the time as written.
 */
export function formatHandoffClock(
  handoffAt: string,
  timeZone: string,
  now = Date.now(),
  locale?: string,
): string {
  const [hours = 0, minutes = 0] = handoffAt.split(":").map(Number);
  const wanted = new Date(now);
  wanted.setHours(hours, minutes, 0, 0);
  let instant = wanted.getTime();
  try {
    // Two steps settle a guess that lands across a daylight-saving change.
    for (let step = 0; step < 2; step += 1) {
      instant += wanted.getTime() - wallClockIn(instant, timeZone);
    }
  } catch {
    instant = wanted.getTime();
  }
  return formatClock(instant, locale);
}

/** VoiceOver words: "4 min ago" → "4 minutes ago", "1 hr left" → "1 hour left". */
export function spokenTime(text: string): string {
  return text.replace(
    /\b(\d+) (min|hr)\b/g,
    (_match, count: string, unit: string) =>
      `${count} ${unit === "min" ? "minute" : "hour"}${count === "1" ? "" : "s"}`,
  );
}
