import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { main as permissionsMain } from "./permissions/cli.mjs";

const DEFAULT_API_URL = "https://hark.ryan.ceo";
const DEFAULT_SCOPES = [
  "notifications:send",
  "interactions:create",
  "interactions:read",
  "activities:read",
  "activities:write",
  "devices:read",
  "services:read",
  "services:write",
  "apps:read",
  "apps:write",
  "devices:write",
  "inbox:read",
  "inbox:write",
  "billing:read",
  "teams:read",
  "teams:write",
  "oncall:read",
  "oncall:write",
];
const TERMINAL = new Set(["approved", "denied", "yes", "no", "replied", "canceled", "expired"]);

export class UsageError extends Error {}
export class RequestError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function parseDuration(value) {
  const match = String(value).match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/);
  if (!match) throw new UsageError(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const multiplier =
    match[2] === "d" ? 86_400 : match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1;
  return Math.round(amount * multiplier);
}

function parseAccentColor(value) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(value))) {
    throw new UsageError("--accent-color must use #RRGGBB format");
  }
  return String(value);
}

const ACTIVITY_STYLES = ["standard", "ring", "hero", "terminal", "steps"];
const INTERACTIVE_ACTIVITY_STYLES = ["approval", "shell", "verdict", "signal"];

function parseStyle(value) {
  if (!ACTIVITY_STYLES.includes(String(value))) {
    throw new UsageError(`--style must be one of: ${ACTIVITY_STYLES.join(", ")}`);
  }
  return String(value);
}

function parseInteractiveStyle(value) {
  if (!INTERACTIVE_ACTIVITY_STYLES.includes(String(value))) {
    throw new UsageError(
      `--style must be one of: ${INTERACTIVE_ACTIVITY_STYLES.join(", ")} for --live-activity`,
    );
  }
  return String(value);
}

function parseActionLabel(value, flag) {
  const label = String(value).trim();
  if (
    label.length === 0 ||
    Array.from(label).length > 24 ||
    Array.from(label).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new UsageError(`--${flag} must be a single line of 1 to 24 characters`);
  }
  return label;
}

/** Server limits for notification bodies: 8,000 characters and 16 KiB of UTF-8. */
const BODY_MAX_CHARS = 8000;
const BODY_MAX_BYTES = 16384;

function assertNotificationBody(value) {
  const body = String(value).trim();
  if (body.length === 0) throw new UsageError("notify requires a message body");
  if (body.length > BODY_MAX_CHARS || Buffer.byteLength(body, "utf8") > BODY_MAX_BYTES) {
    throw new UsageError(
      `notify body must be at most ${BODY_MAX_CHARS} characters and ${BODY_MAX_BYTES} bytes of UTF-8`,
    );
  }
  return String(value);
}

function resolveBodyFormat(options) {
  const explicit = options["body-format"];
  if (explicit !== undefined && explicit !== "text" && explicit !== "markdown") {
    throw new UsageError("--body-format must be text or markdown");
  }
  if (options.markdown && explicit === "text") {
    throw new UsageError("--markdown conflicts with --body-format text");
  }
  if (options.markdown) return "markdown";
  return explicit;
}

export function parseArgs(argv) {
  const positionals = [];
  const options = { device: [], scope: [] };
  /** Index in `positionals` where post-`--` arguments start, or null. */
  let separatorAt = null;
  const valueFlags = new Set([
    "title",
    "image",
    "url",
    "device",
    "expires-in",
    "idempotency-key",
    "timeout",
    "client-name",
    "scope",
    "key",
    "status",
    "detail",
    "progress",
    "symbol",
    "privacy",
    "accent-color",
    "style",
    "stale-after",
    "dismiss-after",
    "if-sequence",
    "limit",
    "primary-label",
    "secondary-label",
    "project",
    "summary",
    "body-format",
    "name",
    "icon",
    "app",
    "cursor",
    "filter",
    "page",
    "team",
    "email",
    "role",
    "members",
    "period",
    "handoff",
    "timezone",
    "starts-at",
    "ends-at",
    "user",
    "body",
    "dedup-key",
    "note",
    "oncall",
    "ring-interval",
    "ring-repeats",
    "ring-until-ack",
  ]);
  const booleanFlags = new Set([
    "approval",
    "yes-no",
    "text",
    "wait",
    "poll",
    "replace",
    "json",
    "stdin",
    "help",
    "open",
    "no-open",
    "live-activity",
    "markdown",
    "unread",
    "no-icon",
    "no-project",
    "personal",
    "all",
    "no-notify",
    "allow-custom-scheme",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (separatorAt === null && argument === "--") {
      separatorAt = positionals.length;
      continue;
    }
    if (separatorAt !== null || !argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const [rawName, inline] = argument.slice(2).split("=", 2);
    if (valueFlags.has(rawName)) {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith("--")) throw new UsageError(`--${rawName} requires a value`);
      if (rawName === "device" || rawName === "scope") options[rawName].push(value);
      else options[rawName] = value;
    } else if (booleanFlags.has(rawName) && inline === undefined) {
      options[rawName] = true;
    } else {
      throw new UsageError(`Unknown option: --${rawName}`);
    }
  }
  return { positionals, options, separatorAt };
}

export function configPath(env = process.env) {
  if (env.HARK_CONFIG) return env.HARK_CONFIG;
  if (platform() === "win32") return join(env.APPDATA ?? homedir(), "hark", "config.json");
  if (platform() === "darwin")
    return join(homedir(), "Library", "Application Support", "hark", "config.json");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "hark", "config.json");
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** Tokens travel only over HTTPS; plain HTTP is allowed for loopback development servers. */
function assertApiUrl(value, label) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new UsageError(`${label} must be an absolute URL`);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return;
  throw new UsageError(`${label} must use https:// (http:// is allowed only for localhost)`);
}

const normalizeApiUrl = (value) => String(value).replace(/\/+$/, "");

export async function loadConfig(env = process.env) {
  if (env.HARK_TOKEN) {
    const apiUrl = env.HARK_API_URL ?? DEFAULT_API_URL;
    assertApiUrl(apiUrl, "HARK_API_URL");
    return {
      token: env.HARK_TOKEN,
      apiUrl,
      source: "environment",
    };
  }
  const path = configPath(env);
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new RequestError(
        `No token configured. Run harkctl auth login, set HARK_TOKEN, or create ${path}.`,
        401,
      );
    }
    throw error;
  }
  if (platform() !== "win32" && (info.mode & 0o077) !== 0) {
    throw new RequestError(
      `Refusing insecure config permissions for ${path}; expected mode 0600.`,
      401,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new RequestError(`Invalid JSON in ${path}.`, 401);
  }
  if (typeof parsed.token !== "string" || !parsed.token.startsWith("hark_")) {
    throw new RequestError(`Missing Hark token in ${path}.`, 401);
  }
  const apiUrl = typeof parsed.apiUrl === "string" ? parsed.apiUrl : DEFAULT_API_URL;
  // The stored token is bound to the API it was minted for; an environment
  // override must not silently send it anywhere else.
  if (
    env.HARK_API_URL !== undefined &&
    normalizeApiUrl(env.HARK_API_URL) !== normalizeApiUrl(apiUrl)
  ) {
    throw new RequestError(
      `Refusing HARK_API_URL=${env.HARK_API_URL}: the token in ${path} belongs to ${apiUrl}. ` +
        "Unset HARK_API_URL, set HARK_TOKEN for that API, or run harkctl auth login with it.",
      401,
    );
  }
  assertApiUrl(apiUrl, `apiUrl in ${path}`);
  return {
    token: parsed.token,
    apiUrl,
    tokenId: typeof parsed.tokenId === "string" ? parsed.tokenId : undefined,
    source: "file",
    path,
  };
}

export async function writeConfig(path, config) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(
    directory,
    `.config.json.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (platform() !== "win32") await chmod(temporary, 0o600);
    await rename(temporary, path);
    if (platform() !== "win32") await chmod(path, 0o600);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export function openBrowser(url) {
  const target = String(url);
  const command =
    platform() === "darwin"
      ? { file: "open", args: [target] }
      : platform() === "win32"
        ? { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", target] }
        : { file: "xdg-open", args: [target] };
  const child = spawn(command.file, command.args, {
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {});
  child.unref();
}

async function request(config, path, init = {}) {
  let response;
  try {
    response = await fetch(`${String(config.apiUrl).replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    throw new RequestError(error instanceof Error ? error.message : "Network request failed", 0);
  }
  const body = await response
    .json()
    .catch(() => ({ error: `Request failed (${response.status})` }));
  if (!response.ok) throw new RequestError(body.error ?? "Request failed", response.status, body);
  return body;
}

async function publicRequest(apiUrl, path, init = {}) {
  let response;
  try {
    response = await fetch(`${String(apiUrl).replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
  } catch (error) {
    throw new RequestError(error instanceof Error ? error.message : "Network request failed", 0);
  }
  const body = await response
    .json()
    .catch(() => ({ error: `Request failed (${response.status})` }));
  if (!response.ok) throw new RequestError(body.error ?? "Request failed", response.status, body);
  return body;
}

/** Only opens authorization pages served by the API the token is being minted for. */
function isSameOriginWebUrl(value, apiUrl) {
  try {
    const url = new URL(String(value));
    const okScheme =
      url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname));
    return okScheme && url.origin === new URL(apiUrl).origin;
  } catch {
    return false;
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function login(options, env, runtime) {
  if (options.open && options["no-open"]) {
    throw new UsageError("--open and --no-open cannot be used together");
  }
  const apiUrl = env.HARK_API_URL ?? DEFAULT_API_URL;
  assertApiUrl(apiUrl, "HARK_API_URL");
  const expiresInSeconds = parseDuration(options["expires-in"] ?? "90d");
  const timeoutSeconds = parseDuration(options.timeout ?? "10m");
  const clientName = options["client-name"] ?? "harkctl";
  const scopes = options.scope.length > 0 ? [...new Set(options.scope)] : DEFAULT_SCOPES;
  const started = await publicRequest(apiUrl, "/api/device-authorization/start", {
    method: "POST",
    body: JSON.stringify({ clientName, scopes, expiresInSeconds }),
  });

  runtime.stderr(`Code: ${started.userCode}`);
  runtime.stderr(`Authorize at: ${started.verificationUri}`);
  const shouldOpen = options.open || (!options["no-open"] && runtime.stderrIsTTY);
  if (shouldOpen && !isSameOriginWebUrl(started.verificationUriComplete, apiUrl)) {
    runtime.stderr(`Not opening the browser: the authorization URL is not on ${apiUrl}`);
  } else if (shouldOpen) {
    try {
      runtime.openBrowser(started.verificationUriComplete);
    } catch (error) {
      runtime.stderr(
        `Could not open browser: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  const deadline = runtime.now() + Math.min(timeoutSeconds, started.expiresIn) * 1000;
  let interval = started.interval;
  while (runtime.now() < deadline) {
    await runtime.sleep(Math.min(interval * 1000, deadline - runtime.now()));
    if (runtime.now() >= deadline) break;
    let response;
    try {
      response = await publicRequest(apiUrl, "/api/device-authorization/token", {
        method: "POST",
        body: JSON.stringify({ deviceCode: started.deviceCode }),
      });
    } catch (error) {
      if (
        error instanceof RequestError &&
        ["authorization_pending", "slow_down"].includes(error.body?.error)
      ) {
        interval =
          Number(error.body?.interval) ||
          (error.body?.error === "slow_down" ? interval + 5 : interval);
        continue;
      }
      throw error;
    }

    const path = configPath(env);
    const accessToken = typeof response?.accessToken === "string" ? response.accessToken : null;
    let saved = false;
    try {
      if (
        !accessToken?.startsWith("hark_") ||
        typeof response.token !== "object" ||
        response.token === null ||
        typeof response.token.id !== "string"
      ) {
        throw new RequestError("Malformed authorization response", 502);
      }
      await runtime.writeConfig(path, { apiUrl, token: accessToken, tokenId: response.token.id });
      saved = true;
      return {
        authenticated: true,
        token: response.token,
        configPath: path,
      };
    } finally {
      // Never leave a minted token alive that was not stored.
      if (!saved && accessToken) {
        await request({ apiUrl, token: accessToken }, "/api/agent/auth/revoke", {
          method: "POST",
        }).catch(() => {});
      }
    }
  }
  throw new RequestError("Authorization timed out", 408, { error: "expired_token" });
}

async function readStdinJson() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try {
    return JSON.parse(input);
  } catch {
    throw new UsageError("stdin must contain valid JSON");
  }
}

/**
 * Fields each command accepts from `--stdin`. Routing and targeting fields
 * (device IDs, on-call groups, app IDs) are flags only, so piped JSON built
 * from external content cannot redirect where a request goes.
 */
const STDIN_KEYS = {
  notify: ["body", "title", "summary", "project", "bodyFormat", "imageUrl", "url"],
  "notify ask": ["prompt", "title", "expiresIn", "presentation", "imageUrl", "url"],
  "services create": ["title", "imageUrl", "url"],
  "services update": ["title", "imageUrl", "url"],
  "activity start": [
    "key",
    "replace",
    "title",
    "status",
    "detail",
    "progress",
    "symbol",
    "privacyMode",
    "accentColor",
    "style",
    "expiresInSeconds",
    "staleAfterSeconds",
  ],
  "activity update": [
    "title",
    "status",
    "detail",
    "progress",
    "symbol",
    "privacyMode",
    "accentColor",
    "style",
    "staleAfterSeconds",
    "ifSequence",
  ],
  "activity end": [
    "status",
    "detail",
    "progress",
    "symbol",
    "accentColor",
    "dismissAfterSeconds",
    "ifSequence",
  ],
  "oncall create": ["name", "rotation", "escalation", "ringIntervalSeconds", "ringMaxRepeats"],
  "oncall update": ["name", "rotation", "escalation", "ringIntervalSeconds", "ringMaxRepeats"],
};

async function readStdinFor(options, command) {
  if (!options.stdin) return {};
  const input = await readStdinJson();
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new UsageError("stdin must contain a JSON object");
  }
  const allowed = STDIN_KEYS[command];
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new UsageError(
      `${command} --stdin does not accept: ${unknown.join(", ")} (allowed: ${allowed.join(", ")})`,
    );
  }
  if (input.url !== undefined && input.url !== null && !options["allow-custom-scheme"]) {
    if (!URL.canParse(String(input.url)) || new URL(String(input.url)).protocol !== "https:") {
      throw new UsageError(
        `${command} --stdin url must be an https:// URL; pass --allow-custom-scheme to allow other schemes`,
      );
    }
  }
  return input;
}

function interactionExitCode(interaction) {
  if (interaction.status === "denied" || interaction.status === "no") return 5;
  if (interaction.status === "canceled" || interaction.status === "expired") return 4;
  return 0;
}

/** `--poll` waits this long at most for an instant answer before returning. */
const POLL_TIMEOUT_SECONDS = 20;

async function waitForInteraction(config, id, timeoutSeconds, runtime) {
  const now = runtime?.now ?? (() => Date.now());
  const deadline = now() + timeoutSeconds * 1000;
  let body;
  while (true) {
    const remaining = Math.max(0, (deadline - now()) / 1000);
    body = await request(
      config,
      `/api/agent/interactions/${encodeURIComponent(id)}/wait?timeout=${Math.min(25, remaining)}`,
    );
    if (TERMINAL.has(body.interaction.status)) return body;
    if (now() >= deadline) return { ...body, timedOut: true };
  }
}

function help() {
  return `Usage:
  harkctl auth login [--client-name <name>] [--scope <scope>] [--expires-in <duration>]
                     [--timeout <duration>] [--open|--no-open] [--json]
  harkctl auth logout
  harkctl auth status
  harkctl notify <body> [--title <name>] [--image <url>] [--url <url>] [--device <id>]
                 [--project <name>] [--summary <text>] [--markdown | --body-format <text|markdown>]
                 [--app <app_id>] [--oncall <group_id>] [--idempotency-key <key>]
                 [--stdin [--allow-custom-scheme]]
  harkctl notify ask <prompt> (--approval|--yes-no|--text) [--title <name>] [--image <url>]
                  [--url <url>] [--device <id>] [--expires-in <duration>]
                  [--live-activity [--style <approval|shell|verdict|signal>]
                                   [--primary-label <label>] [--secondary-label <label>]]
                  [--idempotency-key <key>] [--stdin [--allow-custom-scheme]]
                  [--wait [--timeout <duration>] | --poll]
  harkctl notify withdraw <notification_id>
  harkctl interaction list
  harkctl interaction get <id>
  harkctl interaction wait <id> [--timeout <duration>]
  harkctl activity start --title <title> --status <status> [--key <key>] [--detail <text>]
                         [--progress <0..1>] [--symbol <symbol>] [--privacy <standard|private>]
                         [--style <standard|ring|hero|terminal|steps>] [--accent-color <#RRGGBB>]
                         [--device <id>...] [--expires-in <duration>] [--stale-after <duration>]
                         [--replace] [--idempotency-key <key>] [--stdin]
  harkctl activity update <id|key> [--title <title>] [--status <status>] [--detail <text>]
                            [--progress <0..1>] [--symbol <symbol>] [--privacy <standard|private>]
                            [--style <standard|ring|hero|terminal|steps>] [--accent-color <#RRGGBB>]
                            [--stale-after <duration>] [--if-sequence <n>]
                            [--idempotency-key <key>] [--stdin]
  harkctl activity end <id|key> [--status <status>] [--detail <text>] [--progress <0..1>]
                         [--symbol <symbol>] [--accent-color <#RRGGBB>]
                         [--dismiss-after <duration>] [--if-sequence <n>]
                         [--idempotency-key <key>] [--stdin]
  harkctl activity get <id|key>
  harkctl activity list [--limit <n>]
  harkctl activity feed [--filter <all|notification|live_activity|response>] [--page <n>]
  harkctl permissions setup [claude|codex|opencode|all]
  harkctl permissions uninstall [claude|codex|opencode|all]
  harkctl permissions doctor
  harkctl devices list
  harkctl devices remove <device_id>
  harkctl services list
  harkctl services create --title <title> [--image <url>] [--url <url>] [--stdin]
  harkctl services get <service_id>
  harkctl services update <service_id> [--title <title>] [--image <url>] [--url <url>] [--stdin]
  harkctl services rotate <service_id>
  harkctl services remove <service_id>
  harkctl inbox projects
  harkctl inbox list [--project <project_id|unfiled>] [--unread] [--limit <n>] [--cursor <c>]
  harkctl inbox get <notification_id>
  harkctl inbox read <notification_id>
  harkctl inbox unread <notification_id>
  harkctl inbox read-all [--project <project_id|unfiled>]
  harkctl apps create --name <name> --url <url> [--icon <url>] [--project <name>]
                      [--team <team_id>] [--json]
  harkctl apps list [--json]
  harkctl apps get <app_id> [--json]
  harkctl apps update <app_id> [--name <name>] [--url <url>] [--icon <url> | --no-icon]
                      [--project <name> | --no-project] [--json]
  harkctl apps revoke <app_id> [--json]
  harkctl apps remove <app_id> [--json]
  harkctl apps share <app_id> (--team <team_id> | --personal) [--no-notify] [--json]
  harkctl teams list
  harkctl teams create <name>
  harkctl teams get <team_id>
  harkctl teams rename <team_id> <name>
  harkctl teams delete <team_id>
  harkctl teams leave <team_id>
  harkctl teams members <team_id>
  harkctl teams role <team_id> <user_id> <owner|admin|member>
  harkctl teams remove-member <team_id> <user_id>
  harkctl teams invite <team_id> [--email <email>] [--role <member|admin>]
  harkctl teams invites <team_id>
  harkctl teams revoke-invite <team_id> <invite_id>
  harkctl oncall list --team <team_id>
  harkctl oncall me
  harkctl oncall get <group_id>
  harkctl oncall create --team <team_id> --name <name> --members <user_id,...>
                        [--period <daily|weekly>] [--handoff <HH:MM>] [--timezone <zone>]
                        [--starts-at <iso>] [--ring-interval <seconds>] [--ring-repeats <n>]
                        [--stdin]
  harkctl oncall update <group_id> [--name <name>] [--members <user_id,...>] [--period <p>]
                        [--handoff <HH:MM>] [--timezone <zone>] [--starts-at <iso>]
                        [--ring-interval <seconds>] [--ring-repeats <n>] [--stdin]
  harkctl oncall settings
  harkctl oncall settings set [--ring-until-ack <on|off>] [--ring-interval <seconds|group>]
  harkctl oncall override <group_id> --user <user_id> --starts-at <iso> --ends-at <iso>
  harkctl oncall remove-override <group_id> <override_id>
  harkctl page <group_id> <title> [--body <text>] [--url <url>] [--app <app_id>]
                [--dedup-key <key>]
  harkctl pages list --team <team_id> [--all] [--limit <n>] [--cursor <c>]
  harkctl pages get <page_id>
  harkctl pages resolve <page_id> [--note <text>]
  harkctl billing
  harkctl tokens list
  harkctl tokens revoke <token_id>

notify sends a one-shot push; notify ask sends a push that elicits an answer.
Inside notify, a first positional of exactly "ask" selects the subcommand. Everything
after a bare "--" is treated as positional, so "harkctl notify -- ask" sends the
literal body "ask". --wait blocks until the answer or timeout; --poll waits at most
${POLL_TIMEOUT_SECONDS} seconds to catch an instant answer. A timed-out poll or wait does
not end the prompt: it stays answerable on the phone until it expires, and
harkctl interaction wait <id> resumes waiting at any time.

notify bodies can hold up to 8,000 characters (16 KiB of UTF-8). --project files the
notification into a named project in the Hark app inbox, --summary sets the short
push/preview text for a long body, and --markdown (or --body-format markdown) records
how the body should eventually render. Project names are case-insensitive per account.

notify withdraw removes an agent notification from your phones (a silent command) and marks
it read; "harkctl notify -- withdraw" sends the literal body "withdraw". interaction list
shows every pending prompt on the account; agents can read prompts but only a human on the
phone can answer them. inbox read-all marks only notifications that existed when it ran.

apps registers a web app (an HTTPS site you control) that opens full-screen in the Hark
iPhone app, which hands the page a short-lived signed Hark pass. Creating an app with an
existing URL updates it. notify --app <app_id> opens that app when tapped; --url must
then be on the app's origin.

apps update changes metadata only; sharing and sign-in approval are decided on the phone,
and moving an app to a new origin asks for approval again. apps revoke signs the app out.

teams share apps and on-call groups with other Hark users. Inviting returns a join link;
only a signed-in person can accept it. apps share --team moves an app you added into a
team (every member then approves sign-in on their own phone); --personal moves it back.

page alerts whoever is on call in an on-call group, then escalates until someone
acknowledges. Acknowledging and escalating are deliberately human-only (on the phone or
the website); agents can raise, read, and resolve pages. --dedup-key (or, with
notify --oncall, --idempotency-key) merges repeats into the open page.

Pages ring until acknowledged: whoever is being paged is re-alerted every
--ring-interval seconds (30-300, default 60) up to --ring-repeats times (0-30, default
10; 0 alerts once). Repeats replace the alert on the phone instead of stacking.
oncall settings shows your own paging preferences and each iPhone's Critical Alerts
status; oncall settings set turns ringing off for you or sets a personal interval
(--ring-interval group goes back to each group's interval).

Default logins exclude events:read (activity feed) and tokens:manage (tokens list/revoke);
request them with --scope. No command creates tokens: new tokens always need a signed-in
human (harkctl auth login).

Authentication: run harkctl auth login, or set HARK_TOKEN for an advanced manual setup.
Tokens are never accepted as command arguments.`;
}

/** Adds a re-login hint when a token predates the app scopes. */
async function appsRequest(config, path, init) {
  try {
    return await request(config, path, init);
  } catch (error) {
    if (error instanceof RequestError && error.status === 403) {
      throw new RequestError(
        `${error.message}. Run harkctl auth login to grant app scopes (apps:read, apps:write).`,
        error.status,
        error.body,
      );
    }
    throw error;
  }
}

/** Adds a re-login hint naming the scopes a 403 reported as missing. */
async function scopedRequest(config, path, init) {
  try {
    return await request(config, path, init);
  } catch (error) {
    const required = error instanceof RequestError ? error.body?.required : undefined;
    if (error instanceof RequestError && error.status === 403 && Array.isArray(required)) {
      throw new RequestError(
        `${error.message}. Run harkctl auth login --scope ... to grant ${required.join(", ")}.`,
        error.status,
        error.body,
      );
    }
    throw error;
  }
}

function requireId(id, usage) {
  if (!id) throw new UsageError(`${usage} requires an ID`);
  return encodeURIComponent(id);
}

function parseNonNegativeInteger(value, flag) {
  if (!/^\d+$/.test(String(value))) {
    throw new UsageError(`--${flag} must be a non-negative integer`);
  }
  return String(Number.parseInt(value, 10));
}

function formatApp(app) {
  return `${app.id}  ${app.name}  ${app.url}`;
}

/** A page that reached nobody exits 7 like an undelivered notify; merged repeats exit 0. */
function pageExitCode(body) {
  return body.accepted === 0 && !body.deduplicated ? 7 : 0;
}

function parseMembers(value) {
  const members = String(value)
    .split(",")
    .map((member) => member.trim())
    .filter(Boolean);
  if (members.length === 0) throw new UsageError("--members needs at least one user ID");
  return members;
}

const TEAM_ROLES = ["owner", "admin", "member"];

async function teamsCommand(config, args, options) {
  const [action, teamId, ...rest] = args;
  const base = "/api/agent/teams";
  const teamPath = () => `${base}/${requireId(teamId, `teams ${action}`)}`;
  switch (action) {
    case "list":
      return scopedRequest(config, base);
    case "create": {
      const name = [teamId, ...rest].filter(Boolean).join(" ") || options.name;
      if (!name) throw new UsageError("teams create requires a name");
      return scopedRequest(config, base, { method: "POST", body: JSON.stringify({ name }) });
    }
    case "get":
      return scopedRequest(config, teamPath());
    case "members":
      return { members: (await scopedRequest(config, teamPath())).members };
    case "rename": {
      const name = rest.join(" ") || options.name;
      if (!name) throw new UsageError("teams rename requires a new name");
      return scopedRequest(config, teamPath(), { method: "PATCH", body: JSON.stringify({ name }) });
    }
    case "delete":
      return scopedRequest(config, teamPath(), { method: "DELETE" });
    case "leave":
      return scopedRequest(config, `${teamPath()}/leave`, { method: "POST" });
    case "role": {
      const [userId, role] = rest;
      if (!userId || !TEAM_ROLES.includes(role)) {
        throw new UsageError("teams role requires <team_id> <user_id> <owner|admin|member>");
      }
      return scopedRequest(config, `${teamPath()}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    }
    case "remove-member": {
      const [userId] = rest;
      if (!userId) throw new UsageError("teams remove-member requires <team_id> <user_id>");
      return scopedRequest(config, `${teamPath()}/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
    }
    case "invite": {
      if (options.role && !["admin", "member"].includes(options.role)) {
        throw new UsageError("--role must be member or admin");
      }
      return scopedRequest(config, `${teamPath()}/invites`, {
        method: "POST",
        body: JSON.stringify({
          ...(options.email ? { email: options.email } : {}),
          ...(options.role ? { role: options.role } : {}),
        }),
      });
    }
    case "invites":
      return scopedRequest(config, `${teamPath()}/invites`);
    case "revoke-invite": {
      const [inviteId] = rest;
      if (!inviteId) throw new UsageError("teams revoke-invite requires <team_id> <invite_id>");
      return scopedRequest(config, `${teamPath()}/invites/${encodeURIComponent(inviteId)}`, {
        method: "DELETE",
      });
    }
    default:
      throw new UsageError("Unknown teams command. Run harkctl --help.");
  }
}

function parseIntegerFlag(value, flag, min, max) {
  const number = /^\d+$/.test(String(value)) ? Number.parseInt(value, 10) : Number.NaN;
  if (!(number >= min && number <= max)) {
    throw new UsageError(`--${flag} must be an integer from ${min} to ${max}`);
  }
  return number;
}

/** Group ringing fields from --ring-interval / --ring-repeats. */
function ringFromOptions(options) {
  return {
    ...(options["ring-interval"] !== undefined
      ? {
          ringIntervalSeconds: parseIntegerFlag(options["ring-interval"], "ring-interval", 30, 300),
        }
      : {}),
    ...(options["ring-repeats"] !== undefined
      ? { ringMaxRepeats: parseIntegerFlag(options["ring-repeats"], "ring-repeats", 0, 30) }
      : {}),
  };
}

function settingsFromOptions(options) {
  const ring = options["ring-until-ack"];
  if (ring !== undefined && ring !== "on" && ring !== "off") {
    throw new UsageError("--ring-until-ack must be on or off");
  }
  const interval = options["ring-interval"];
  return {
    ...(ring !== undefined ? { ringUntilAcknowledged: ring === "on" } : {}),
    ...(interval !== undefined
      ? {
          ringIntervalSeconds:
            interval === "group" ? null : parseIntegerFlag(interval, "ring-interval", 30, 300),
        }
      : {}),
  };
}

function rotationFromOptions(options, stdinRotation) {
  const rotation = {
    ...(stdinRotation ?? {}),
    ...(options.members ? { memberIds: parseMembers(options.members) } : {}),
    ...(options.period ? { period: options.period } : {}),
    ...(options.handoff ? { handoffAt: options.handoff } : {}),
    ...(options.timezone ? { timezone: options.timezone } : {}),
    ...(options["starts-at"] ? { startsAt: options["starts-at"] } : {}),
  };
  return Object.keys(rotation).length > 0 ? rotation : undefined;
}

async function oncallCommand(config, args, options) {
  const [action, groupId, ...rest] = args;
  const groupPath = () => `/api/agent/oncall/${requireId(groupId, `oncall ${action}`)}`;
  switch (action) {
    case "list":
      if (!options.team) throw new UsageError("oncall list requires --team <team_id>");
      return scopedRequest(config, `/api/agent/teams/${encodeURIComponent(options.team)}/oncall`);
    case "me":
      return scopedRequest(config, "/api/agent/oncall/me");
    case "settings": {
      if (groupId === undefined) return scopedRequest(config, "/api/agent/oncall/settings");
      if (groupId !== "set")
        throw new UsageError("Unknown oncall settings command. Run harkctl --help.");
      const payload = settingsFromOptions(options);
      if (Object.keys(payload).length === 0) {
        throw new UsageError("oncall settings set requires --ring-until-ack or --ring-interval");
      }
      return scopedRequest(config, "/api/agent/oncall/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    }
    case "get":
      return scopedRequest(config, groupPath());
    case "create": {
      const stdin = await readStdinFor(options, "oncall create");
      if (!options.team) throw new UsageError("oncall create requires --team <team_id>");
      const name = options.name ?? stdin.name;
      const rotation = rotationFromOptions(options, stdin.rotation);
      if (!name || !rotation?.memberIds) {
        throw new UsageError("oncall create requires --name and --members");
      }
      const payload = {
        ...stdin,
        ...ringFromOptions(options),
        name,
        rotation: {
          period: "daily",
          handoffAt: "09:00",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          ...rotation,
        },
      };
      return scopedRequest(config, `/api/agent/teams/${encodeURIComponent(options.team)}/oncall`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    case "update": {
      const stdin = await readStdinFor(options, "oncall update");
      let rotation = rotationFromOptions(options, stdin.rotation);
      if (rotation) {
        // The server replaces the whole rotation, so fill unchanged fields
        // (including the original start, which keeps the order) from the group.
        const { group } = await scopedRequest(config, groupPath());
        rotation = {
          memberIds: group.rotation.members.map((member) => member.userId),
          period: group.rotation.period,
          handoffAt: group.rotation.handoffAt,
          timezone: group.rotation.timezone,
          startsAt: group.rotation.startsAt,
          ...rotation,
        };
      }
      const payload = {
        ...stdin,
        ...(options.name ? { name: options.name } : {}),
        ...(rotation ? { rotation } : {}),
        ...ringFromOptions(options),
      };
      if (Object.keys(payload).length === 0) {
        throw new UsageError("oncall update requires a field to change (or --stdin)");
      }
      return scopedRequest(config, groupPath(), { method: "PATCH", body: JSON.stringify(payload) });
    }
    case "override": {
      if (!options.user || !options["starts-at"] || !options["ends-at"]) {
        throw new UsageError("oncall override requires --user, --starts-at, and --ends-at");
      }
      return scopedRequest(config, `${groupPath()}/overrides`, {
        method: "POST",
        body: JSON.stringify({
          userId: options.user,
          startsAt: options["starts-at"],
          endsAt: options["ends-at"],
        }),
      });
    }
    case "remove-override": {
      const [overrideId] = rest;
      if (!overrideId)
        throw new UsageError("oncall remove-override requires <group_id> <override_id>");
      return scopedRequest(config, `${groupPath()}/overrides/${encodeURIComponent(overrideId)}`, {
        method: "DELETE",
      });
    }
    default:
      throw new UsageError("Unknown oncall command. Run harkctl --help.");
  }
}

export async function execute(argv, env = process.env, overrides = {}) {
  const { positionals, options, separatorAt } = parseArgs(argv);
  if (options.help || positionals.length === 0)
    return { body: { help: help() }, exitCode: 0, text: true };
  const [group, action, id] = positionals;
  const runtime = {
    now: () => Date.now(),
    openBrowser,
    sleep,
    stderr: (message) => console.error(message),
    stderrIsTTY: Boolean(process.stderr.isTTY),
    writeConfig,
    ...overrides,
  };

  if (group === "auth" && action === "login") {
    return { body: await login(options, env, runtime), exitCode: 0 };
  }

  if (group === "permissions") {
    const body = await permissionsMain(positionals.slice(1));
    if (body?.help) return { body, exitCode: 0, text: true };
    return { body: body ?? { ok: true }, exitCode: 0 };
  }

  const config = await loadConfig(env);

  if (group === "auth" && action === "logout") {
    let revoked = false;
    try {
      await request(config, "/api/agent/auth/revoke", { method: "POST" });
      revoked = true;
    } catch {
      // Local credentials are removed even if the server is unreachable or already revoked.
    }
    if (config.source === "file") await rm(config.path, { force: true });
    return {
      body: {
        authenticated: false,
        revoked,
        credentialsRemoved: config.source === "file",
      },
      exitCode: 0,
    };
  }

  if (group === "auth" && action === "status") {
    return { body: await request(config, "/api/agent/auth/status"), exitCode: 0 };
  }
  if (group === "devices" && action === "list") {
    return { body: await request(config, "/api/agent/devices"), exitCode: 0 };
  }
  if (group === "services" && action === "list") {
    return { body: await request(config, "/api/agent/services"), exitCode: 0 };
  }
  if (group === "services" && action === "create") {
    const stdin = await readStdinFor(options, "services create");
    const title = options.title ?? stdin.title;
    if (!title) throw new UsageError("services create requires --title");
    const payload = {
      ...stdin,
      title,
      ...(options.image ? { imageUrl: options.image } : {}),
      ...(options.url ? { url: options.url } : {}),
    };
    return {
      body: await request(config, "/api/agent/services", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      exitCode: 0,
    };
  }
  if (group === "devices" && action === "remove") {
    const path = `/api/agent/devices/${requireId(id, "devices remove")}`;
    return { body: await scopedRequest(config, path, { method: "DELETE" }), exitCode: 0 };
  }
  if (group === "services" && ["get", "update", "rotate", "remove"].includes(action)) {
    const path = `/api/agent/services/${requireId(id, `services ${action}`)}`;
    if (action === "get") return { body: await scopedRequest(config, path), exitCode: 0 };
    if (action === "rotate") {
      return {
        body: await scopedRequest(config, `${path}/rotate`, { method: "POST" }),
        exitCode: 0,
      };
    }
    if (action === "remove") {
      return { body: await scopedRequest(config, path, { method: "DELETE" }), exitCode: 0 };
    }
    const stdin = await readStdinFor(options, "services update");
    const payload = {
      ...stdin,
      ...(options.title ? { title: options.title } : {}),
      ...(options.image ? { imageUrl: options.image } : {}),
      ...(options.url ? { url: options.url } : {}),
    };
    if (Object.keys(payload).length === 0) {
      throw new UsageError("services update requires --title, --image, --url, or --stdin");
    }
    return {
      body: await scopedRequest(config, path, { method: "PATCH", body: JSON.stringify(payload) }),
      exitCode: 0,
    };
  }
  if (group === "inbox") {
    if (action === "projects") {
      return { body: await scopedRequest(config, "/api/agent/inbox/projects"), exitCode: 0 };
    }
    if (action === "list" || action === "read-all") {
      const query = new URLSearchParams();
      if (options.project) query.set("project", options.project);
      if (action === "list") {
        if (options.limit) query.set("limit", parseNonNegativeInteger(options.limit, "limit"));
        if (options.unread) query.set("unread", "1");
        if (options.cursor) query.set("cursor", options.cursor);
      } else {
        // The read-through token bounds read-all to notifications that existed
        // when this command ran, so anything arriving meanwhile stays unread.
        query.set("limit", "1");
      }
      const suffix = query.size > 0 ? `?${query}` : "";
      const page = await scopedRequest(config, `/api/agent/inbox/notifications${suffix}`);
      if (action === "list") return { body: page, exitCode: 0 };
      const body = await scopedRequest(config, "/api/agent/inbox/notifications/read-all", {
        method: "POST",
        body: JSON.stringify({
          readThrough: page.readThroughToken,
          ...(options.project ? { project: options.project } : {}),
        }),
      });
      return { body, exitCode: 0 };
    }
    if (["get", "read", "unread"].includes(action)) {
      const path = `/api/agent/inbox/notifications/${requireId(id, `inbox ${action}`)}`;
      if (action === "get") return { body: await scopedRequest(config, path), exitCode: 0 };
      return {
        body: await scopedRequest(config, `${path}/${action}`, { method: "POST" }),
        exitCode: 0,
      };
    }
  }
  if (group === "billing" && action === undefined) {
    return { body: await scopedRequest(config, "/api/agent/billing"), exitCode: 0 };
  }
  if (group === "tokens" && action === "list") {
    return { body: await scopedRequest(config, "/api/agent/tokens"), exitCode: 0 };
  }
  if (group === "tokens" && action === "revoke") {
    const path = `/api/agent/tokens/${requireId(id, "tokens revoke")}`;
    return { body: await scopedRequest(config, path, { method: "DELETE" }), exitCode: 0 };
  }
  if (group === "interaction" && action === "list") {
    return { body: await scopedRequest(config, "/api/agent/interactions"), exitCode: 0 };
  }
  if (group === "activity" && action === "feed") {
    const query = new URLSearchParams();
    if (options.filter) query.set("filter", options.filter);
    if (options.page) query.set("page", parseNonNegativeInteger(options.page, "page"));
    const suffix = query.size > 0 ? `?${query}` : "";
    return { body: await scopedRequest(config, `/api/agent/activity-feed${suffix}`), exitCode: 0 };
  }
  if (group === "apps" && ["get", "update", "revoke"].includes(action)) {
    const path = `/api/agent/apps/${requireId(id, `apps ${action}`)}`;
    let body;
    if (action === "get") body = await appsRequest(config, path);
    else if (action === "revoke") {
      body = await appsRequest(config, `${path}/revoke`, { method: "POST" });
    } else {
      if (options.icon && options["no-icon"]) {
        throw new UsageError("--icon and --no-icon cannot be used together");
      }
      if (options.project && options["no-project"]) {
        throw new UsageError("--project and --no-project cannot be used together");
      }
      const payload = {
        ...(options.name ? { name: options.name } : {}),
        ...(options.url ? { url: options.url } : {}),
        ...(options.icon ? { iconUrl: options.icon } : {}),
        ...(options["no-icon"] ? { iconUrl: null } : {}),
        ...(options.project ? { project: options.project } : {}),
        ...(options["no-project"] ? { project: null } : {}),
      };
      if (Object.keys(payload).length === 0) {
        throw new UsageError(
          "apps update requires --name, --url, --icon, --no-icon, --project, or --no-project",
        );
      }
      body = await appsRequest(config, path, { method: "PATCH", body: JSON.stringify(payload) });
    }
    const suffix =
      action === "revoke"
        ? " (sign-in revoked)"
        : action === "update" && body.app.consentedAt === null
          ? " (approve sign-in on your phone)"
          : "";
    return {
      body,
      exitCode: 0,
      ...(options.json ? {} : { output: `${formatApp(body.app)}${suffix}` }),
    };
  }
  if (group === "apps" && action === "create") {
    if (!options.name || !options.url)
      throw new UsageError("apps create requires --name and --url");
    const payload = {
      name: options.name,
      url: options.url,
      ...(options.icon ? { iconUrl: options.icon } : {}),
      ...(options.project ? { project: options.project } : {}),
      ...(options.team ? { teamId: options.team } : {}),
    };
    const body = await appsRequest(config, "/api/agent/apps", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      body,
      exitCode: 0,
      ...(options.json
        ? {}
        : { output: `${formatApp(body.app)}${body.created ? "" : " (updated existing)"}` }),
    };
  }
  if (group === "apps" && action === "list") {
    const body = await appsRequest(config, "/api/agent/apps");
    return {
      body,
      exitCode: 0,
      ...(options.json
        ? {}
        : { output: body.apps.length > 0 ? body.apps.map(formatApp).join("\n") : "No apps" }),
    };
  }
  if (group === "apps" && action === "remove") {
    if (!id) throw new UsageError("apps remove requires an app ID");
    const body = await appsRequest(config, `/api/agent/apps/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return { body, exitCode: 0, ...(options.json ? {} : { output: `Removed ${id}` }) };
  }
  if (group === "activity" && action === "list") {
    const limit = options.limit ? Number.parseInt(options.limit, 10) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new UsageError("--limit must be an integer from 1 to 100");
    }
    return {
      body: await request(config, `/api/agent/activities?limit=${limit}`),
      exitCode: 0,
    };
  }
  if (group === "activity" && action === "get") {
    const identifier = id ?? options.key;
    if (!identifier) throw new UsageError("activity get requires an activity ID or --key");
    return {
      body: await request(config, `/api/agent/activities/${encodeURIComponent(identifier)}`),
      exitCode: 0,
    };
  }
  if (group === "activity" && action === "start") {
    const stdin = await readStdinFor(options, "activity start");
    const progress = options.progress === undefined ? stdin.progress : Number(options.progress);
    if (progress !== undefined && (!Number.isFinite(progress) || progress < 0 || progress > 1)) {
      throw new UsageError("--progress must be a number from 0 to 1");
    }
    const title = options.title ?? stdin.title;
    const status = options.status ?? stdin.status;
    if (!title || !status) throw new UsageError("activity start requires --title and --status");
    const payload = {
      ...stdin,
      title,
      status,
      ...(options.key ? { key: options.key } : {}),
      ...(options.replace ? { replace: true } : {}),
      ...(options.detail ? { detail: options.detail } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(options.symbol ? { symbol: options.symbol } : {}),
      ...(options.privacy ? { privacyMode: options.privacy } : {}),
      ...(options["accent-color"]
        ? { accentColor: parseAccentColor(options["accent-color"]) }
        : {}),
      ...(options.style ? { style: parseStyle(options.style) } : {}),
      ...(options.device.length > 0 ? { deviceIds: options.device } : {}),
      ...(options["expires-in"] ? { expiresInSeconds: parseDuration(options["expires-in"]) } : {}),
      ...(options["stale-after"]
        ? { staleAfterSeconds: parseDuration(options["stale-after"]) }
        : {}),
    };
    const body = await request(config, "/api/agent/activities", {
      method: "POST",
      headers: options["idempotency-key"]
        ? { "Idempotency-Key": options["idempotency-key"] }
        : undefined,
      body: JSON.stringify(payload),
    });
    return { body, exitCode: body.accepted === 0 ? 7 : 0 };
  }
  if (group === "activity" && action === "update") {
    const identifier = id ?? options.key;
    if (!identifier) throw new UsageError("activity update requires an activity ID or --key");
    const stdin = await readStdinFor(options, "activity update");
    const progress = options.progress === undefined ? stdin.progress : Number(options.progress);
    if (
      progress !== undefined &&
      progress !== null &&
      (!Number.isFinite(progress) || progress < 0 || progress > 1)
    ) {
      throw new UsageError("--progress must be a number from 0 to 1");
    }
    const ifSequence =
      options["if-sequence"] === undefined
        ? stdin.ifSequence
        : Number.parseInt(options["if-sequence"], 10);
    if (ifSequence !== undefined && (!Number.isInteger(ifSequence) || ifSequence < 0)) {
      throw new UsageError("--if-sequence must be a non-negative integer");
    }
    const payload = {
      ...stdin,
      ...(options.title ? { title: options.title } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.detail ? { detail: options.detail } : {}),
      ...(progress !== undefined ? { progress } : {}),
      ...(options.symbol ? { symbol: options.symbol } : {}),
      ...(options.privacy ? { privacyMode: options.privacy } : {}),
      ...(options["accent-color"]
        ? { accentColor: parseAccentColor(options["accent-color"]) }
        : {}),
      ...(options.style ? { style: parseStyle(options.style) } : {}),
      ...(options["stale-after"]
        ? { staleAfterSeconds: parseDuration(options["stale-after"]) }
        : {}),
      ...(ifSequence !== undefined ? { ifSequence } : {}),
    };
    const body = await request(config, `/api/agent/activities/${encodeURIComponent(identifier)}`, {
      method: "PATCH",
      headers: options["idempotency-key"]
        ? { "Idempotency-Key": options["idempotency-key"] }
        : undefined,
      body: JSON.stringify(payload),
    });
    return { body, exitCode: body.accepted === 0 ? 7 : 0 };
  }
  if (group === "activity" && action === "end") {
    const identifier = id ?? options.key;
    if (!identifier) throw new UsageError("activity end requires an activity ID or --key");
    const stdin = await readStdinFor(options, "activity end");
    const ifSequence =
      options["if-sequence"] === undefined
        ? stdin.ifSequence
        : Number.parseInt(options["if-sequence"], 10);
    if (ifSequence !== undefined && (!Number.isInteger(ifSequence) || ifSequence < 0)) {
      throw new UsageError("--if-sequence must be a non-negative integer");
    }
    const payload = {
      ...stdin,
      ...(options.status ? { status: options.status } : {}),
      ...(options.detail ? { detail: options.detail } : {}),
      ...(options.progress !== undefined ? { progress: Number(options.progress) } : {}),
      ...(options.symbol ? { symbol: options.symbol } : {}),
      ...(options["accent-color"]
        ? { accentColor: parseAccentColor(options["accent-color"]) }
        : {}),
      ...(options["dismiss-after"]
        ? { dismissAfterSeconds: parseDuration(options["dismiss-after"]) }
        : {}),
      ...(ifSequence !== undefined ? { ifSequence } : {}),
    };
    const body = await request(
      config,
      `/api/agent/activities/${encodeURIComponent(identifier)}/end`,
      {
        method: "POST",
        headers: options["idempotency-key"]
          ? { "Idempotency-Key": options["idempotency-key"] }
          : undefined,
        body: JSON.stringify(payload),
      },
    );
    return { body, exitCode: body.accepted === 0 ? 7 : 0 };
  }
  if (group === "interaction" && action === "get" && id) {
    const body = await request(config, `/api/agent/interactions/${encodeURIComponent(id)}`);
    return { body, exitCode: interactionExitCode(body.interaction) };
  }
  if (group === "interaction" && action === "wait" && id) {
    const timeout = parseDuration(options.timeout ?? "60s");
    const body = await waitForInteraction(config, id, timeout, runtime);
    return {
      body,
      exitCode: body.timedOut ? 4 : interactionExitCode(body.interaction),
    };
  }
  if (group === "apps" && action === "share") {
    if (!id) throw new UsageError("apps share requires an app ID");
    if (Boolean(options.team) === Boolean(options.personal)) {
      throw new UsageError("apps share requires exactly one of --team <team_id> or --personal");
    }
    const body = await scopedRequest(config, `/api/agent/apps/${encodeURIComponent(id)}/share`, {
      method: "POST",
      body: JSON.stringify({
        teamId: options.personal ? null : options.team,
        ...(options["no-notify"] ? { notify: false } : {}),
      }),
    });
    const where = body.app.team ? `shared with ${body.app.team.name}` : "personal";
    return {
      body,
      exitCode: 0,
      ...(options.json ? {} : { output: `${formatApp(body.app)} (${where})` }),
    };
  }
  if (group === "teams") {
    return { body: await teamsCommand(config, positionals.slice(1), options), exitCode: 0 };
  }
  if (group === "oncall") {
    return { body: await oncallCommand(config, positionals.slice(1), options), exitCode: 0 };
  }
  if (group === "page") {
    const groupId = positionals[1];
    const title = positionals.slice(2).join(" ");
    if (!groupId || !title) throw new UsageError("page requires a group ID and a title");
    const body = await scopedRequest(
      config,
      `/api/agent/oncall/${encodeURIComponent(groupId)}/pages`,
      {
        method: "POST",
        body: JSON.stringify({
          title,
          ...(options.body ? { body: options.body } : {}),
          ...(options.url ? { url: options.url } : {}),
          ...(options.app ? { appId: options.app } : {}),
          ...(options["dedup-key"] ? { dedupKey: options["dedup-key"] } : {}),
        }),
      },
    );
    return { body, exitCode: pageExitCode(body) };
  }
  if (group === "pages") {
    if (action === "list") {
      if (!options.team) throw new UsageError("pages list requires --team <team_id>");
      const query = new URLSearchParams({ status: options.all ? "all" : "open" });
      if (options.limit) query.set("limit", parseNonNegativeInteger(options.limit, "limit"));
      if (options.cursor) query.set("cursor", options.cursor);
      const path = `/api/agent/teams/${encodeURIComponent(options.team)}/pages?${query}`;
      return { body: await scopedRequest(config, path), exitCode: 0 };
    }
    if (action === "get" || action === "resolve") {
      const path = `/api/agent/pages/${requireId(id, `pages ${action}`)}`;
      if (action === "get") return { body: await scopedRequest(config, path), exitCode: 0 };
      return {
        body: await scopedRequest(config, `${path}/resolve`, {
          method: "POST",
          body: JSON.stringify(options.note ? { note: options.note } : {}),
        }),
        exitCode: 0,
      };
    }
  }
  if (group === "notify") {
    // A first positional of exactly `ask` or `withdraw` selects the subcommand
    // unless it came after a bare `--`, which forces it to be the literal body.
    const isSubcommand = separatorAt === null || separatorAt > 1;
    if (positionals[1] === "withdraw" && isSubcommand) {
      if (positionals.length !== 3) {
        throw new UsageError(
          'notify withdraw takes exactly one notification ID; use "harkctl notify -- withdraw ..." to send that text',
        );
      }
      const path = `/api/agent/notifications/${encodeURIComponent(positionals[2])}/withdraw`;
      return { body: await scopedRequest(config, path, { method: "POST" }), exitCode: 0 };
    }
    const isAsk = positionals[1] === "ask" && isSubcommand;
    if (isAsk) {
      const selectors = [
        options.approval ? "approval" : null,
        options["yes-no"] ? "yes_no" : null,
        options.text ? "reply" : null,
      ].filter(Boolean);
      if (selectors.length !== 1) {
        throw new UsageError(
          "notify ask requires exactly one response type: --approval, --yes-no, or --text",
        );
      }
      if (options.poll && (options.wait || options.timeout !== undefined)) {
        throw new UsageError("--poll cannot be combined with --wait or --timeout");
      }
      if (options.timeout !== undefined && !options.wait) {
        throw new UsageError("--timeout requires --wait");
      }
      if (
        options.project ||
        options.summary ||
        options.markdown ||
        options["body-format"] ||
        options.app
      ) {
        throw new UsageError(
          "--project, --summary, --markdown, --body-format, and --app apply to notify, not notify ask",
        );
      }
      const stdin = await readStdinFor(options, "notify ask");
      const prompt = positionals.slice(2).join(" ") || stdin.prompt;
      if (!prompt) throw new UsageError("notify ask requires a prompt");
      const expiresInSeconds = parseDuration(options["expires-in"] ?? stdin.expiresIn ?? "15m");
      const liveActivity = options["live-activity"] || stdin.presentation === "live_activity";
      if (liveActivity && selectors[0] === "reply") {
        throw new UsageError("--live-activity supports --approval or --yes-no, not --text");
      }
      if (!liveActivity && (options["primary-label"] || options["secondary-label"])) {
        throw new UsageError("custom action labels require --live-activity");
      }
      if (!liveActivity && options.style) {
        throw new UsageError("interactive --style requires --live-activity");
      }
      if (liveActivity && expiresInSeconds > 28_800) {
        throw new UsageError("--live-activity requests must expire within 8 hours");
      }
      const payload = {
        ...stdin,
        title: options.title ?? stdin.title ?? "Hark",
        prompt,
        kind: selectors[0],
        expiresInSeconds,
        ...(liveActivity ? { presentation: "live_activity" } : {}),
        ...(liveActivity && options.style ? { style: parseInteractiveStyle(options.style) } : {}),
        ...(options["primary-label"]
          ? { primaryLabel: parseActionLabel(options["primary-label"], "primary-label") }
          : {}),
        ...(options["secondary-label"]
          ? { secondaryLabel: parseActionLabel(options["secondary-label"], "secondary-label") }
          : {}),
        ...(options.image ? { imageUrl: options.image } : {}),
        ...(options.url ? { url: options.url } : {}),
        ...(options.device.length > 0 ? { deviceIds: options.device } : {}),
      };
      const body = await request(config, "/api/agent/interactions", {
        method: "POST",
        headers: options["idempotency-key"]
          ? { "Idempotency-Key": options["idempotency-key"] }
          : undefined,
        body: JSON.stringify(payload),
      });
      if (body.accepted === 0) return { body, exitCode: 7 };
      if (!options.wait && !options.poll) return { body, exitCode: 0 };
      const timeout = options.poll
        ? POLL_TIMEOUT_SECONDS
        : parseDuration(options.timeout ?? `${expiresInSeconds}s`);
      const waited = await waitForInteraction(config, body.interaction.id, timeout, runtime);
      return {
        body: { ...body, interaction: waited.interaction, timedOut: waited.timedOut ?? false },
        exitCode: waited.timedOut ? 4 : interactionExitCode(waited.interaction),
      };
    }
    const stdin = await readStdinFor(options, "notify");
    const notificationBody = positionals.slice(1).join(" ") || stdin.body;
    if (!notificationBody) throw new UsageError("notify requires a message body");
    assertNotificationBody(notificationBody);
    const bodyFormat = resolveBodyFormat(options);
    const payload = {
      ...stdin,
      body: notificationBody,
      ...(options.title ? { title: options.title } : {}),
      ...(options.image ? { imageUrl: options.image } : {}),
      ...(options.url ? { url: options.url } : {}),
      ...(options.device.length > 0 ? { deviceIds: options.device } : {}),
      ...(options.project ? { project: options.project } : {}),
      ...(options.summary ? { summary: options.summary } : {}),
      ...(bodyFormat ? { bodyFormat } : {}),
      ...(options.app ? { appId: options.app } : {}),
      ...(options.oncall ? { oncall: options.oncall } : {}),
    };
    if (options.oncall && options.device.length > 0) {
      throw new UsageError("--oncall cannot be combined with --device");
    }
    const body = await request(config, "/api/agent/notifications", {
      method: "POST",
      headers: options["idempotency-key"]
        ? { "Idempotency-Key": options["idempotency-key"] }
        : undefined,
      body: JSON.stringify(payload),
    });
    if (options.oncall) return { body, exitCode: pageExitCode(body) };
    return { body, exitCode: body.accepted === 0 ? 7 : 0 };
  }
  throw new UsageError("Unknown command. Run harkctl --help.");
}

export async function run(argv, env = process.env, overrides = {}) {
  try {
    const result = await execute(argv, env, overrides);
    if (result.text) console.log(result.body.help);
    else if (result.output !== undefined) console.log(result.output);
    else console.log(JSON.stringify(result.body));
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error(message);
    if (error instanceof UsageError) return 2;
    if (error instanceof RequestError) {
      if (error.body?.error === "access_denied") return 5;
      if (error.status === 408 || error.body?.error === "expired_token") return 4;
      if (error.status === 401 || error.status === 403) return 3;
      if (error.status === 0) return 6;
    }
    return 1;
  }
}
