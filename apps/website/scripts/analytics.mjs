#!/usr/bin/env node
/**
 * Read-only product analytics reader for the Hark SQLite database.
 *
 * Usage (local):      node scripts/analytics.mjs summary
 * Usage (container):  docker compose exec hark node scripts/analytics.mjs summary
 *
 * Every subcommand prints JSON to stdout. The database is opened read-only, so
 * this script can never mutate product data.
 */
import Database from "better-sqlite3";

const USAGE = `hark analytics (read-only)

Usage: node scripts/analytics.mjs <command> [flags]

Commands:
  summary                     Headline product numbers
  dau [--days 30]             Daily active users per UTC day
  wau [--weeks 8]             Rolling 7-day active users, weekly snapshots
  mau [--months 6]            Rolling 28-day active users, monthly snapshots
  retention [--weeks 8]       Weekly signup cohorts and week 1-4 return rates
  services [--limit 20]       Busiest services by webhook volume
  devices                     Device inventory and registration activity
  notifications [--days 30]   Accepted pushes per day and per surface
  errors [--days 7]           Failures, rate limits and quota blocks
  plans                       Last observed plan mix and billing intent
  acquisition [--days 30]     First-touch sources, campaigns, and referrers
  funnel [--days 30]          Acquisition through onboarding conversion
  journeys [--days 30]        Common page/screen transitions and exits
  events --name <name>        Daily counts for one analytics event
         [--days 30]
  names                       Event names present in the database

Flags:
  --db <path>   SQLite file (default: $DATABASE_URL or ./data/hark.sqlite)
  --days <n>    Lookback window in days where supported
  --limit <n>   Row cap where supported
  --json        Accepted for symmetry; output is always JSON
  --help        Show this help
`;

function parseArgs(argv) {
  const flags = { json: true };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "json" || key === "help") {
      flags[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`Flag --${key} needs a value`);
    }
    flags[key] = value;
    index += 1;
  }
  return { command: positional[0], flags };
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function intFlag(flags, key, fallback, max = 3650) {
  if (flags[key] === undefined) return fallback;
  const parsed = Number.parseInt(String(flags[key]), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(`--${key} must be a positive integer`);
  return Math.min(parsed, max);
}

/** UTC `YYYY-MM-DD` for a day offset from now. */
function day(offsetDays = 0) {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function msAgo(days) {
  return Date.now() - days * 86_400_000;
}

function open(flags) {
  const file = flags.db ?? process.env.DATABASE_URL ?? "./data/hark.sqlite";
  if (file === ":memory:") fail("Refusing to report on an in-memory database");
  try {
    const database = new Database(file, { readonly: true, fileMustExist: true });
    database.pragma("query_only = ON");
    return { database, file };
  } catch (error) {
    fail(`Could not open ${file} read-only: ${error instanceof Error ? error.message : error}`);
  }
}

function tableExists(database, name) {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function one(database, sql, ...params) {
  return database.prepare(sql).get(...params) ?? {};
}

function all(database, sql, ...params) {
  return database.prepare(sql).all(...params);
}

function distinctActive(database, days) {
  return (
    one(
      database,
      "SELECT COUNT(DISTINCT user_id) AS value FROM analytics_user_day WHERE day >= ?",
      day(days - 1),
    ).value ?? 0
  );
}

function commandSummary(database) {
  const users = one(database, "SELECT COUNT(*) AS value FROM user").value ?? 0;
  const signups7 = one(
    database,
    "SELECT COUNT(*) AS value FROM user WHERE created_at >= ?",
    msAgo(7),
  ).value;
  const signups30 = one(
    database,
    "SELECT COUNT(*) AS value FROM user WHERE created_at >= ?",
    msAgo(30),
  ).value;
  const devices = one(database, "SELECT COUNT(*) AS total, SUM(active) AS active FROM device");
  const services = one(database, "SELECT COUNT(*) AS value FROM service").value ?? 0;
  const webhooks = one(
    database,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last7,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last30,
            SUM(delivered_count) AS delivered
     FROM event`,
    msAgo(7),
    msAgo(30),
  );
  const interactions = one(
    database,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last30,
            SUM(CASE WHEN responded_at IS NOT NULL THEN 1 ELSE 0 END) AS responded
     FROM interaction`,
    msAgo(30),
  );
  const activities = one(
    database,
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last30
     FROM live_activity`,
    msAgo(30),
  );
  const notifications = one(
    database,
    `SELECT COALESCE(SUM(value), 0) AS value
     FROM analytics_event WHERE name = 'notification_sent' AND created_at >= ?`,
    msAgo(30),
  );
  return {
    generatedAt: new Date().toISOString(),
    users: { total: users, signupsLast7Days: signups7 ?? 0, signupsLast30Days: signups30 ?? 0 },
    active: {
      dau: distinctActive(database, 1),
      wau: distinctActive(database, 7),
      mau: distinctActive(database, 28),
    },
    devices: { total: devices.total ?? 0, active: devices.active ?? 0 },
    services: { total: services },
    webhooks: {
      total: webhooks.total ?? 0,
      last7Days: webhooks.last7 ?? 0,
      last30Days: webhooks.last30 ?? 0,
      pushesAccepted: webhooks.delivered ?? 0,
    },
    interactions: {
      total: interactions.total ?? 0,
      last30Days: interactions.last30 ?? 0,
      responded: interactions.responded ?? 0,
    },
    liveActivities: { total: activities.total ?? 0, last30Days: activities.last30 ?? 0 },
    notificationsSentLast30Days: notifications.value ?? 0,
  };
}

function commandDau(database, flags) {
  const days = intFlag(flags, "days", 30);
  return {
    windowDays: days,
    series: all(
      database,
      `SELECT day, COUNT(DISTINCT user_id) AS users
       FROM analytics_user_day WHERE day >= ? GROUP BY day ORDER BY day`,
      day(days - 1),
    ),
  };
}

function rollingSeries(database, windowDays, points, stepDays) {
  const series = [];
  for (let index = points - 1; index >= 0; index -= 1) {
    const end = day(index * stepDays);
    const start = day(index * stepDays + windowDays - 1);
    const row = one(
      database,
      `SELECT COUNT(DISTINCT user_id) AS users
       FROM analytics_user_day WHERE day >= ? AND day <= ?`,
      start,
      end,
    );
    series.push({ start, end, users: row.users ?? 0 });
  }
  return series;
}

function commandWau(database, flags) {
  const weeks = intFlag(flags, "weeks", 8, 260);
  return { windowDays: 7, series: rollingSeries(database, 7, weeks, 7) };
}

function commandMau(database, flags) {
  const months = intFlag(flags, "months", 6, 60);
  return { windowDays: 28, series: rollingSeries(database, 28, months, 28) };
}

function commandRetention(database, flags) {
  const weeks = intFlag(flags, "weeks", 8, 104);
  const cohorts = all(
    database,
    `SELECT strftime('%Y-%W', created_at / 1000, 'unixepoch') AS cohort,
            MIN(date(created_at / 1000, 'unixepoch')) AS firstSignup,
            COUNT(*) AS size
     FROM user
     WHERE created_at >= ?
     GROUP BY cohort
     ORDER BY cohort`,
    msAgo(weeks * 7),
  );
  const detail = cohorts.map((cohort) => {
    const returns = {};
    for (const week of [1, 2, 3, 4]) {
      const row = one(
        database,
        `SELECT COUNT(DISTINCT d.user_id) AS users
         FROM analytics_user_day d
         JOIN user u ON u.id = d.user_id
         WHERE strftime('%Y-%W', u.created_at / 1000, 'unixepoch') = ?
           AND d.day >= date(u.created_at / 1000, 'unixepoch', ?)
           AND d.day < date(u.created_at / 1000, 'unixepoch', ?)`,
        cohort.cohort,
        `+${week * 7} days`,
        `+${(week + 1) * 7} days`,
      );
      returns[`week${week}`] = row.users ?? 0;
    }
    return { ...cohort, returns };
  });
  return { cohortWeeks: weeks, cohorts: detail };
}

function commandServices(database, flags) {
  const limit = intFlag(flags, "limit", 20, 500);
  const days = intFlag(flags, "days", 30);
  return {
    windowDays: days,
    services: all(
      database,
      `SELECT s.id AS serviceId,
              s.user_id AS userId,
              COUNT(e.id) AS webhooks,
              COALESCE(SUM(e.delivered_count), 0) AS pushesAccepted,
              SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN e.status = 'no_devices' THEN 1 ELSE 0 END) AS noDevices,
              MAX(e.created_at) AS lastEventAt
       FROM service s
       LEFT JOIN event e ON e.service_id = s.id AND e.created_at >= ?
       GROUP BY s.id
       ORDER BY webhooks DESC, s.created_at ASC
       LIMIT ?`,
      msAgo(days),
      limit,
    ).map((row) => ({
      ...row,
      lastEventAt: row.lastEventAt ? new Date(row.lastEventAt).toISOString() : null,
    })),
  };
}

function commandDevices(database) {
  const totals = one(
    database,
    `SELECT COUNT(*) AS total,
            SUM(active) AS active,
            SUM(CASE WHEN live_activity_push_to_start_token_ciphertext IS NOT NULL THEN 1 ELSE 0 END)
              AS liveActivityCapable,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS createdLast30Days,
            SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS seenLast7Days
     FROM device`,
    msAgo(30),
    msAgo(7),
  );
  const perUser = one(
    database,
    `SELECT COUNT(DISTINCT user_id) AS usersWithDevice FROM device WHERE active = 1`,
  );
  return {
    total: totals.total ?? 0,
    active: totals.active ?? 0,
    liveActivityCapable: totals.liveActivityCapable ?? 0,
    createdLast30Days: totals.createdLast30Days ?? 0,
    seenLast7Days: totals.seenLast7Days ?? 0,
    usersWithActiveDevice: perUser.usersWithDevice ?? 0,
    analytics: all(
      database,
      `SELECT name, COALESCE(outcome, 'none') AS outcome, COUNT(*) AS events,
              COALESCE(SUM(value), 0) AS value
       FROM analytics_event
       WHERE name IN ('device_registered', 'device_unregistered', 'device_deactivated_stale',
                      'onboarding_welcome_sent')
         AND created_at >= ?
       GROUP BY name, outcome
       ORDER BY name, outcome`,
      msAgo(30),
    ),
  };
}

function commandNotifications(database, flags) {
  const days = intFlag(flags, "days", 30);
  return {
    windowDays: days,
    perDay: all(
      database,
      `SELECT date(created_at / 1000, 'unixepoch') AS day,
              COUNT(*) AS sends,
              COALESCE(SUM(value), 0) AS pushesAccepted
       FROM analytics_event
       WHERE name = 'notification_sent' AND created_at >= ?
       GROUP BY day ORDER BY day`,
      msAgo(days),
    ),
    perSurface: all(
      database,
      `SELECT COALESCE(outcome, 'unknown') AS surface,
              COUNT(*) AS sends,
              COALESCE(SUM(value), 0) AS pushesAccepted
       FROM analytics_event
       WHERE name = 'notification_sent' AND created_at >= ?
       GROUP BY surface ORDER BY pushesAccepted DESC`,
      msAgo(days),
    ),
  };
}

function commandErrors(database, flags) {
  const days = intFlag(flags, "days", 7);
  return {
    windowDays: days,
    analytics: all(
      database,
      `SELECT name, COALESCE(outcome, 'none') AS outcome, COUNT(*) AS events
       FROM analytics_event
       WHERE name IN ('webhook_failed', 'webhook_rate_limited', 'webhook_quota_exceeded',
                      'live_activity_failed', 'device_deactivated_stale')
         AND created_at >= ?
       GROUP BY name, outcome
       ORDER BY events DESC`,
      msAgo(days),
    ),
    webhookStatus: all(
      database,
      `SELECT status, COUNT(*) AS events FROM event WHERE created_at >= ?
       GROUP BY status ORDER BY events DESC`,
      msAgo(days),
    ),
    apnsReasons: all(
      database,
      `SELECT COALESCE(apns_reason, 'none') AS reason, COUNT(*) AS attempts
       FROM live_activity_delivery_attempt
       WHERE created_at >= ? AND apns_reason IS NOT NULL
       GROUP BY reason ORDER BY attempts DESC LIMIT 20`,
      msAgo(days),
    ),
  };
}

function commandPlans(database, flags) {
  const days = intFlag(flags, "days", 30);
  return {
    windowDays: days,
    note: "Plan is the last value observed on an analytics event; billing state lives in Autumn.",
    lastObservedPlan: all(
      database,
      `SELECT plan, COUNT(*) AS users FROM (
         SELECT user_id, plan,
                ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rank
         FROM analytics_event
         WHERE plan IS NOT NULL AND user_id IS NOT NULL AND created_at >= ?
       ) WHERE rank = 1
       GROUP BY plan ORDER BY users DESC`,
      msAgo(days),
    ),
    billingIntent: all(
      database,
      `SELECT name, COUNT(*) AS events, COUNT(DISTINCT user_id) AS users
       FROM analytics_event
       WHERE name IN ('plan_checkout_started', 'plan_upgraded', 'billing_portal_opened')
         AND created_at >= ?
       GROUP BY name ORDER BY events DESC`,
      msAgo(days),
    ),
  };
}

function commandAcquisition(database, flags) {
  const days = intFlag(flags, "days", 30);
  const grouped = (field) =>
    all(
      database,
      `SELECT COALESCE(json_extract(metadata, ?), 'unknown') AS label,
              COUNT(*) AS visits,
              COUNT(DISTINCT anonymous_id) AS visitors,
              COUNT(DISTINCT user_id) AS knownUsers
       FROM analytics_event
       WHERE name IN ('page_view', 'app_open') AND created_at >= ?
       GROUP BY label ORDER BY visitors DESC, visits DESC LIMIT 50`,
      `$.${field}`,
      msAgo(days),
    );
  return {
    windowDays: days,
    sources: grouped("source"),
    campaigns: grouped("campaign"),
    referrers: grouped("referrerHost"),
  };
}

function commandFunnel(database, flags) {
  const days = intFlag(flags, "days", 30);
  const names = [
    "page_view",
    "outbound_clicked",
    "app_open",
    "auth_started",
    "auth_completed",
    "notification_permission_resolved",
    "device_registration_completed",
    "onboarding_completed",
    "service_created",
    "webhook_delivered",
  ];
  const rows = all(
    database,
    `SELECT name, COUNT(*) AS events,
            COUNT(DISTINCT COALESCE(user_id, anonymous_id)) AS actors
     FROM analytics_event
     WHERE name IN (${names.map(() => "?").join(",")}) AND created_at >= ?
     GROUP BY name`,
    ...names,
    msAgo(days),
  );
  const byName = new Map(rows.map((row) => [row.name, row]));
  return {
    windowDays: days,
    steps: names.map((name) => ({
      name,
      events: byName.get(name)?.events ?? 0,
      actors: byName.get(name)?.actors ?? 0,
    })),
  };
}

function commandJourneys(database, flags) {
  const days = intFlag(flags, "days", 30);
  const limit = intFlag(flags, "limit", 30, 500);
  return {
    windowDays: days,
    transitions: all(
      database,
      `WITH route_events AS (
         SELECT session_id, created_at, json_extract(metadata, '$.path') AS path,
                LEAD(json_extract(metadata, '$.path')) OVER (
                  PARTITION BY session_id ORDER BY created_at, id
                ) AS nextPath
         FROM analytics_event
         WHERE name IN ('page_view', 'screen_view') AND session_id IS NOT NULL
           AND created_at >= ?
       )
       SELECT path AS fromPath, COALESCE(nextPath, '[exit]') AS toPath, COUNT(*) AS transitions
       FROM route_events WHERE path IS NOT NULL
       GROUP BY fromPath, toPath ORDER BY transitions DESC LIMIT ?`,
      msAgo(days),
      limit,
    ),
    outbound: all(
      database,
      `SELECT json_extract(metadata, '$.path') AS fromPath,
              json_extract(metadata, '$.destinationHost') AS destinationHost,
              COUNT(*) AS clicks
       FROM analytics_event
       WHERE name IN ('outbound_clicked', 'notification_opened') AND created_at >= ?
       GROUP BY fromPath, destinationHost ORDER BY clicks DESC LIMIT ?`,
      msAgo(days),
      limit,
    ),
  };
}

function commandEvents(database, flags) {
  const name = flags.name;
  if (!name) fail("events requires --name <event-name>");
  const days = intFlag(flags, "days", 30);
  return {
    name,
    windowDays: days,
    total: one(
      database,
      `SELECT COUNT(*) AS events, COALESCE(SUM(value), 0) AS value,
              COUNT(DISTINCT user_id) AS users
       FROM analytics_event WHERE name = ? AND created_at >= ?`,
      name,
      msAgo(days),
    ),
    perDay: all(
      database,
      `SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS events,
              COALESCE(SUM(value), 0) AS value
       FROM analytics_event WHERE name = ? AND created_at >= ?
       GROUP BY day ORDER BY day`,
      name,
      msAgo(days),
    ),
    perOutcome: all(
      database,
      `SELECT COALESCE(outcome, 'none') AS outcome, COUNT(*) AS events,
              COALESCE(SUM(value), 0) AS value
       FROM analytics_event WHERE name = ? AND created_at >= ?
       GROUP BY outcome ORDER BY events DESC`,
      name,
      msAgo(days),
    ),
    rollups: all(
      database,
      `SELECT day, metric, value FROM analytics_daily
       WHERE (metric = ? OR metric = ?) AND day >= ?
       ORDER BY day, metric`,
      name,
      `${name}:value`,
      day(days - 1),
    ),
  };
}

function commandNames(database) {
  return {
    events: all(
      database,
      `SELECT name, COUNT(*) AS events, MIN(created_at) AS firstAt, MAX(created_at) AS lastAt
       FROM analytics_event GROUP BY name ORDER BY events DESC`,
    ).map((row) => ({
      name: row.name,
      events: row.events,
      firstAt: new Date(row.firstAt).toISOString(),
      lastAt: new Date(row.lastAt).toISOString(),
    })),
    rollupMetrics: all(
      database,
      "SELECT metric, COUNT(*) AS days, SUM(value) AS value FROM analytics_daily GROUP BY metric ORDER BY metric",
    ),
  };
}

const COMMANDS = {
  summary: commandSummary,
  dau: commandDau,
  wau: commandWau,
  mau: commandMau,
  retention: commandRetention,
  services: commandServices,
  devices: commandDevices,
  notifications: commandNotifications,
  errors: commandErrors,
  plans: commandPlans,
  acquisition: commandAcquisition,
  funnel: commandFunnel,
  journeys: commandJourneys,
  events: commandEvents,
  names: commandNames,
};

function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || !command) {
    process.stdout.write(USAGE);
    process.exit(command ? 0 : 1);
  }
  const handler = COMMANDS[command];
  if (!handler) fail(`Unknown command "${command}". Run with --help for the list.`);

  const { database, file } = open(flags);
  try {
    for (const table of ["analytics_event", "analytics_daily", "analytics_user_day"]) {
      if (!tableExists(database, table)) {
        fail(`${file} is missing ${table}; start the server once so migrations run.`);
      }
    }
    const payload = handler(database, flags);
    process.stdout.write(`${JSON.stringify({ database: file, ...payload }, null, 2)}\n`);
  } finally {
    database.close();
  }
}

main();
