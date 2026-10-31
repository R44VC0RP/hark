import {
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  agentNotificationCreateSchema,
  appCreateSchema,
  appShareSchema,
  appUpdateSchema,
  CRITICAL_ALERT_STATES,
  FEEDBACK_LIMIT_PER_DAY,
  FEEDBACK_LIMIT_PER_HOUR,
  feedbackCreateSchema,
  INBOX_ACTIVITY_KINDS,
  INBOX_PAGE_MAX_LIMIT,
  INTERACTION_KINDS,
  INTERACTION_STATUSES,
  inboxMarkAllReadSchema,
  interactionCreateSchema,
  LIVE_ACTIVITY_STATUSES,
  liveActivityEndSchema,
  liveActivityStartSchema,
  liveActivityUpdateSchema,
  ONCALL_ESCALATION_FINALS,
  ONCALL_ESCALATION_MODES,
  ONCALL_ESCALATION_TARGETS,
  ONCALL_PAGE_EVENT_KINDS,
  ONCALL_PAGE_STATUSES,
  ONCALL_PAGE_URGENCIES,
  ONCALL_ROTATION_PERIODS,
  oncallGroupCreateSchema,
  oncallGroupUpdateSchema,
  oncallOverrideCreateSchema,
  oncallPageCreateSchema,
  oncallPageResolveSchema,
  oncallSettingsUpdateSchema,
  serviceCreateSchema,
  serviceUpdateSchema,
  TEAM_ROLES,
  teamCreateSchema,
  teamInviteCreateSchema,
  teamMemberUpdateSchema,
  teamUpdateSchema,
} from "@hark/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { canonicalOrigin } from "../lib/origins";

/**
 * Hand-maintained OpenAPI 3.1 description of every `/api/agent/**` route.
 *
 * Request bodies are generated from the zod contracts the routes validate
 * with, so they cannot drift from the server's parsing. Response shapes are
 * written by hand from the DTOs in `@hark/contracts`. `agent-openapi.test.ts`
 * fails when a registered agent route is missing here (or vice versa).
 */

type JsonSchema = Record<string, unknown>;

function requestSchema(schema: z.ZodType): JsonSchema {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
  }) as JsonSchema;
  return json;
}

const ref = (name: string): JsonSchema => ({ $ref: `#/components/schemas/${name}` });
const str: JsonSchema = { type: "string" };
const nullableStr: JsonSchema = { type: ["string", "null"] };
const dateTime: JsonSchema = { type: "string", format: "date-time" };
const nullableDateTime: JsonSchema = { type: ["string", "null"], format: "date-time" };
const int: JsonSchema = { type: "integer" };
const bool: JsonSchema = { type: "boolean" };
const arrayOf = (items: JsonSchema): JsonSchema => ({ type: "array", items });

function object(properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
  };
}

const ok = object({ ok: { const: true } });

const schemas: Record<string, JsonSchema> = {
  Error: object({ error: str, code: str, issues: {}, required: arrayOf(str) }, [
    "code",
    "issues",
    "required",
  ]),
  Ok: ok,
  TokenStatus: object({
    authenticated: { const: true },
    token: object({
      id: str,
      name: str,
      prefix: str,
      scopes: arrayOf(ref("Scope")),
      createdAt: dateTime,
      lastUsedAt: nullableDateTime,
      expiresAt: nullableDateTime,
    }),
  }),
  Scope: { type: "string", enum: [...API_TOKEN_SCOPES] },
  ApiToken: object(
    {
      id: str,
      name: str,
      prefix: { ...str, description: "Identifying prefix only; secrets are never returned." },
      scopes: arrayOf(ref("Scope")),
      expiresAt: nullableDateTime,
      lastUsedAt: nullableDateTime,
      createdAt: dateTime,
      revokedAt: nullableDateTime,
      kind: {
        enum: ["token", "oauth"],
        description: "`oauth` is the grant behind a connected MCP/OAuth client.",
      },
      oauthClient: {
        anyOf: [object({ clientId: str, name: str }), { type: "null" }],
        description: "The connected client for `kind: oauth`.",
      },
    },
    ["kind", "oauthClient"],
  ),
  Device: object({
    id: str,
    platform: { const: "ios" },
    deviceName: nullableStr,
    active: bool,
    liveActivitiesCapable: bool,
    liveActivityTokenEnvironment: { enum: ["sandbox", "production", null] },
    liveActivityTokenUpdatedAt: nullableDateTime,
    interactiveLiveActivitiesCapable: bool,
    createdAt: dateTime,
    lastSeenAt: dateTime,
  }),
  AgentService: object({
    id: str,
    title: str,
    imageUrl: nullableStr,
    url: nullableStr,
    createdAt: dateTime,
    updatedAt: dateTime,
  }),
  ServiceCreated: object({
    service: {
      allOf: [ref("AgentService"), object({ webhookUrl: nullableStr })],
    },
    webhookUrl: {
      ...str,
      description: "Full webhook URL containing the plaintext token. Returned once.",
    },
  }),
  Event: object({
    id: str,
    serviceId: str,
    serviceTitle: str,
    title: nullableStr,
    body: str,
    imageUrl: nullableStr,
    url: nullableStr,
    status: str,
    deliveredCount: int,
    error: nullableStr,
    createdAt: dateTime,
  }),
  AgentNotification: object(
    {
      id: str,
      title: str,
      body: str,
      imageUrl: nullableStr,
      url: nullableStr,
      createdAt: dateTime,
      projectId: nullableStr,
      summary: nullableStr,
      bodyFormat: { enum: ["text", "markdown"] },
      appId: str,
    },
    ["projectId", "summary", "bodyFormat", "appId"],
  ),
  AgentNotificationCreated: object(
    {
      notification: ref("AgentNotification"),
      accepted: int,
      idempotent: bool,
      message: str,
    },
    ["idempotent", "message"],
  ),
  AgentNotificationWithdrawn: object({
    ok: { const: true },
    notificationId: str,
    status: { enum: ["withdrawn", "withdraw_partial"] },
    accepted: int,
  }),
  Interaction: object({
    id: str,
    title: str,
    prompt: str,
    kind: { enum: [...INTERACTION_KINDS] },
    presentation: { enum: ["notification", "live_activity"] },
    status: { enum: [...INTERACTION_STATUSES] },
    choices: arrayOf(str),
    response: nullableStr,
    imageUrl: nullableStr,
    url: nullableStr,
    actionDigest: str,
    primaryLabel: nullableStr,
    secondaryLabel: nullableStr,
    accepted: int,
    respondingDeviceId: nullableStr,
    expiresAt: dateTime,
    createdAt: dateTime,
    respondedAt: nullableDateTime,
    canceledAt: nullableDateTime,
  }),
  InboxInteraction: {
    allOf: [
      ref("Interaction"),
      object({ sourceName: str, sourceImageUrl: nullableStr, projectId: nullableStr }, [
        "projectId",
      ]),
    ],
  },
  InteractionCreated: object(
    {
      interaction: ref("Interaction"),
      accepted: int,
      idempotent: bool,
      liveActivityId: str,
      message: str,
    },
    ["idempotent", "liveActivityId", "message"],
  ),
  LiveActivity: object({
    id: str,
    key: nullableStr,
    props: { type: "object", description: "LiveActivityProps (title, status, progress, …)." },
    status: { enum: [...LIVE_ACTIVITY_STATUSES] },
    sequence: int,
    accepted: int,
    failed: int,
    expiresAt: dateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
    endedAt: nullableDateTime,
  }),
  LiveActivityMutation: object(
    {
      activity: ref("LiveActivity"),
      accepted: int,
      failed: int,
      replaced: int,
      idempotent: bool,
      message: str,
    },
    ["replaced", "idempotent", "message"],
  ),
  AppSummary: object({ id: str, name: str, origin: str, iconUrl: nullableStr }),
  App: {
    allOf: [
      ref("AppSummary"),
      object({
        url: str,
        projectId: nullableStr,
        projectName: nullableStr,
        shareName: bool,
        shareEmail: bool,
        consentedAt: nullableDateTime,
        lastOpenedAt: nullableDateTime,
        createdBy: nullableStr,
        createdAt: dateTime,
        updatedAt: dateTime,
        team: {
          anyOf: [ref("TeamSummary"), { type: "null" }],
          description:
            "Owning team; null for personal apps. Sharing and consent fields then describe the calling account only.",
        },
        addedBy: nullableStr,
      }),
    ],
  },
  InboxProjects: object({
    projects: arrayOf(
      object({
        projectId: nullableStr,
        name: str,
        unreadCount: int,
        totalCount: int,
        latestTitle: nullableStr,
        latestPreview: nullableStr,
        latestImageUrl: nullableStr,
        latestAt: nullableDateTime,
      }),
    ),
    totalUnread: int,
  }),
  InboxNotificationSummary: object({
    id: { ...str, description: "Composite ID: `event:<id>` or `notification:<id>`." },
    origin: { enum: ["event", "notification"] },
    projectId: nullableStr,
    projectName: nullableStr,
    sourceName: str,
    sourceImageUrl: nullableStr,
    title: str,
    preview: str,
    url: nullableStr,
    bodyFormat: { enum: ["text", "markdown"] },
    readAt: nullableDateTime,
    createdAt: dateTime,
    app: { anyOf: [ref("AppSummary"), { type: "null" }] },
  }),
  InboxNotificationPage: object({
    items: arrayOf(ref("InboxNotificationSummary")),
    nextCursor: nullableStr,
    readThroughToken: str,
  }),
  InboxNotificationDetail: {
    allOf: [
      ref("InboxNotificationSummary"),
      object({ body: str, summary: nullableStr, status: nullableStr }),
    ],
  },
  ReadMark: object({ ok: { const: true }, readAt: nullableDateTime, idempotent: bool }, [
    "idempotent",
  ]),
  ActivityFeedPage: object({
    items: arrayOf(
      object({
        id: str,
        kind: { enum: [...INBOX_ACTIVITY_KINDS] },
        sourceName: str,
        sourceImageUrl: nullableStr,
        title: str,
        detail: nullableStr,
        url: nullableStr,
        result: nullableStr,
        createdAt: dateTime,
      }),
    ),
    page: int,
    pageSize: int,
    total: int,
  }),
  TeamSummary: object({ id: str, name: str }),
  Team: object({
    id: str,
    name: str,
    role: ref("TeamRole"),
    memberCount: int,
    appCount: int,
    oncallGroupCount: int,
    seats: object({ used: int, available: { type: ["integer", "null"] }, billable: int }),
    plan: { enum: ["free", "team"] },
    createdAt: dateTime,
  }),
  TeamRole: { type: "string", enum: [...TEAM_ROLES] },
  TeamMember: object({
    userId: str,
    name: str,
    email: str,
    image: nullableStr,
    role: ref("TeamRole"),
    joinedAt: dateTime,
  }),
  TeamInvite: object({
    id: str,
    teamId: str,
    email: nullableStr,
    role: ref("TeamRole"),
    invitedBy: str,
    expiresAt: dateTime,
    acceptedAt: nullableDateTime,
    revokedAt: nullableDateTime,
    createdAt: dateTime,
  }),
  TeamInviteCreated: object({
    invite: ref("TeamInvite"),
    code: { ...str, description: "Plaintext join code, returned once." },
    url: { ...str, description: "Join link a person opens to accept (accepting is human-only)." },
  }),
  OncallPerson: object({ userId: str, name: str, image: nullableStr }),
  OncallShift: object(
    {
      person: ref("OncallPerson"),
      startsAt: dateTime,
      endsAt: dateTime,
      override: bool,
      overrideId: str,
    },
    ["overrideId"],
  ),
  OncallGroup: object(
    {
      id: str,
      teamId: str,
      name: str,
      rotation: object({
        members: arrayOf(ref("OncallPerson")),
        period: { enum: [...ONCALL_ROTATION_PERIODS] },
        handoffAt: str,
        timezone: str,
        startsAt: dateTime,
      }),
      escalation: arrayOf(
        object(
          {
            afterMinutes: {
              ...int,
              description: "The previous level's ack timeout before this level starts ringing.",
            },
            target: { enum: [...ONCALL_ESCALATION_TARGETS] },
            userIds: { ...arrayOf(str), description: "For `people`: paged at once." },
            groupId: { ...str, description: "For `oncall`: another group in the team." },
          },
          ["userIds", "groupId"],
        ),
      ),
      escalationMode: {
        enum: [...ONCALL_ESCALATION_MODES],
        description: "`fan_out` keeps earlier levels ringing; `hand_off` silences them.",
      },
      escalationLoops: { ...int, description: "Times the policy runs again after its last level." },
      escalationFinal: {
        enum: [...ONCALL_ESCALATION_FINALS],
        description: "Paged once after the last level and loops.",
      },
      ringIntervalSeconds: {
        ...int,
        description: "Seconds between repeat alerts while a page is unacknowledged.",
      },
      ringMaxRepeats: { ...int, description: "Repeat alerts per person after the first." },
      current: { anyOf: [ref("OncallShift"), { type: "null" }] },
      upcoming: arrayOf(ref("OncallShift")),
      overrides: arrayOf(
        object({ id: str, person: ref("OncallPerson"), startsAt: dateTime, endsAt: dateTime }),
      ),
      openPageCount: int,
      createdAt: dateTime,
      updatedAt: dateTime,
    },
    ["overrides"],
  ),
  OncallPage: object({
    id: str,
    groupId: str,
    groupName: str,
    teamId: str,
    title: str,
    body: nullableStr,
    url: nullableStr,
    app: { anyOf: [ref("AppSummary"), { type: "null" }] },
    status: { enum: [...ONCALL_PAGE_STATUSES] },
    urgency: {
      enum: [...ONCALL_PAGE_URGENCIES],
      description: "`high` rings and escalates; `low` alerts once until a person escalates it.",
    },
    dedupKey: nullableStr,
    repeatCount: int,
    notified: arrayOf(ref("OncallPerson")),
    ringing: {
      ...arrayOf(object({ person: ref("OncallPerson"), ringCount: int, nextRingAt: dateTime })),
      description: "People still being re-alerted; empty once acknowledged or resolved.",
    },
    timeline: {
      ...arrayOf(
        object({
          at: dateTime,
          kind: { enum: [...ONCALL_PAGE_EVENT_KINDS] },
          level: { type: ["integer", "null"] },
          loop: { type: ["integer", "null"] },
          people: arrayOf(ref("OncallPerson")),
          escalatedBy: { anyOf: [ref("OncallPerson"), { type: "null" }] },
        }),
      ),
      description: "Who was paged at each level and when, and who claimed or resolved it.",
    },
    escalationStep: int,
    nextEscalationAt: nullableDateTime,
    acknowledgedBy: { anyOf: [ref("OncallPerson"), { type: "null" }] },
    acknowledgedAt: nullableDateTime,
    resolvedBy: { anyOf: [ref("OncallPerson"), { type: "null" }] },
    resolvedAt: nullableDateTime,
    source: str,
    createdAt: dateTime,
  }),
  OncallSettings: object({
    ringUntilAcknowledged: bool,
    ringIntervalSeconds: {
      type: ["integer", "null"],
      description: "Personal repeat interval; null uses each group's.",
    },
    criticalAlerts: { anyOf: [{ enum: [...CRITICAL_ALERT_STATES] }, { type: "null" }] },
    devices: arrayOf(
      object({
        id: str,
        deviceName: nullableStr,
        criticalAlerts: { anyOf: [{ enum: [...CRITICAL_ALERT_STATES] }, { type: "null" }] },
      }),
    ),
  }),
  OncallPageCreated: object({
    page: ref("OncallPage"),
    deduplicated: bool,
    accepted: int,
  }),
  Billing: object({
    configured: bool,
    plan: { enum: ["free", "pro"] },
    priceMonthly: { type: "number" },
    features: object({ deviceRouting: bool }),
    limits: object({
      devices: { type: ["integer", "null"] },
      notificationsPerMonth: int,
      servicePerMinute: int,
      accountPerMinute: int,
    }),
    usage: object({ notificationsRemaining: { type: ["integer", "null"] } }),
  }),
};

export interface AgentOperation {
  summary: string;
  /** Scopes the token must hold; empty means any valid agent token. */
  scopes: ApiTokenScope[];
  request?: z.ZodType;
  params?: Array<{ name: string; in: "path" | "query" | "header"; schema: JsonSchema }>;
  /** Successful status and its response schema. */
  status?: 200 | 201;
  response: JsonSchema;
  description?: string;
}

const idParam = (name = "id") => ({ name, in: "path" as const, schema: str });
const idempotencyHeader = { name: "Idempotency-Key", in: "header" as const, schema: str };
const wrap = (key: string, schema: JsonSchema) => object({ [key]: schema });

export type AgentMethod = "get" | "post" | "patch" | "delete";

/** Every `/api/agent/**` operation, keyed by OpenAPI path then method. The MCP tools reuse it. */
export const agentOperations: Record<string, Partial<Record<AgentMethod, AgentOperation>>> = {
  "/auth/status": {
    get: { summary: "Describe the calling token", scopes: [], response: ref("TokenStatus") },
  },
  "/auth/revoke": {
    post: { summary: "Revoke the calling token", scopes: [], response: ok },
  },
  "/tokens": {
    get: {
      summary: "List the account's API tokens (never secrets)",
      scopes: ["tokens:manage"],
      response: wrap("tokens", arrayOf(ref("ApiToken"))),
      description:
        'Connected MCP/OAuth clients appear as `kind: "oauth"`; revoking one signs that client out (access and refresh tokens). There is no create route: an agent token cannot mint tokens, so it can never escalate its own scopes or outlive its revocation. Create tokens from a signed-in session or `harkctl auth login`.',
    },
  },
  "/tokens/{id}": {
    delete: {
      summary: "Revoke another token of the same account",
      scopes: ["tokens:manage"],
      params: [idParam()],
      response: ok,
    },
  },
  "/devices": {
    get: {
      summary: "List registered devices",
      scopes: ["devices:read"],
      response: wrap("devices", arrayOf(ref("Device"))),
      description: "Registration is phone-only: only the Hark app holds a push token.",
    },
  },
  "/devices/{id}": {
    delete: {
      summary: "Remove a device; it registers again when Hark next opens on it",
      scopes: ["devices:write"],
      params: [idParam()],
      response: ok,
    },
  },
  "/services": {
    get: {
      summary: "List webhook services (without webhook URLs)",
      scopes: ["services:read"],
      response: wrap("services", arrayOf(ref("AgentService"))),
    },
    post: {
      summary: "Create a webhook service; the webhook URL is returned once",
      scopes: ["services:write"],
      request: serviceCreateSchema,
      status: 201,
      response: ref("ServiceCreated"),
    },
  },
  "/services/{id}": {
    get: {
      summary: "Get a webhook service",
      scopes: ["services:read"],
      params: [idParam()],
      response: wrap("service", ref("AgentService")),
    },
    patch: {
      summary: "Update a webhook service's title, avatar, or tap URL",
      scopes: ["services:write"],
      params: [idParam()],
      request: serviceUpdateSchema,
      response: wrap("service", ref("AgentService")),
    },
    delete: {
      summary: "Delete a webhook service",
      scopes: ["services:write"],
      params: [idParam()],
      response: ok,
    },
  },
  "/services/{id}/rotate": {
    post: {
      summary: "Rotate the webhook token; the new URL is returned once",
      scopes: ["services:write"],
      params: [idParam()],
      response: ref("ServiceCreated"),
    },
  },
  "/events": {
    get: {
      summary: "Recent webhook deliveries",
      scopes: ["events:read"],
      params: [{ name: "limit", in: "query", schema: { ...int, minimum: 1, maximum: 100 } }],
      response: wrap("events", arrayOf(ref("Event"))),
    },
  },
  "/activity-feed": {
    get: {
      summary: "Merged account activity history, newest first (20 per page)",
      scopes: ["events:read"],
      params: [
        { name: "filter", in: "query", schema: { enum: ["all", ...INBOX_ACTIVITY_KINDS] } },
        { name: "page", in: "query", schema: { ...int, minimum: 0 } },
      ],
      response: ref("ActivityFeedPage"),
    },
  },
  "/notifications": {
    post: {
      summary: "Send a one-shot push",
      scopes: ["notifications:send"],
      params: [idempotencyHeader],
      request: agentNotificationCreateSchema,
      status: 201,
      response: { oneOf: [ref("AgentNotificationCreated"), ref("OncallPageCreated")] },
      description:
        "With `oncall` (which also needs `oncall:write`), the push pages that on-call group instead (the token owner must be on its team, and the team needs the Team plan or this returns 402) and returns the page; the Idempotency-Key becomes the page's dedup key. `deviceIds` returns 402 unless the account has device routing (legacy Hark Pro only); omit it to reach the account's active iPhone.",
    },
  },
  "/notifications/{id}/withdraw": {
    post: {
      summary: "Withdraw an agent notification from the account's devices",
      scopes: ["notifications:send"],
      params: [idParam()],
      response: ref("AgentNotificationWithdrawn"),
      description:
        "Sends a silent command that removes the push from Notification Center and marks the inbox copy read. Accepts `anot_…` or `notification:anot_…`. Returns 502 when no device accepted the command.",
    },
  },
  "/interactions": {
    get: {
      summary: "List the account's pending prompts from every source",
      scopes: ["interactions:read"],
      response: wrap("interactions", arrayOf(ref("InboxInteraction"))),
      description:
        "There is deliberately no agent route that answers a prompt: approvals come only from a human on the phone or a signed-in session.",
    },
    post: {
      summary: "Ask a question (approval, yes/no, or reply)",
      scopes: ["interactions:create", "notifications:send"],
      params: [idempotencyHeader],
      request: interactionCreateSchema,
      status: 201,
      response: ref("InteractionCreated"),
    },
  },
  "/interactions/{id}": {
    get: {
      summary: "Get a prompt created by this token",
      scopes: ["interactions:read"],
      params: [idParam()],
      response: wrap("interaction", ref("Interaction")),
    },
  },
  "/interactions/{id}/wait": {
    get: {
      summary: "Long-poll a prompt created by this token until it is answered",
      scopes: ["interactions:read"],
      params: [
        idParam(),
        { name: "timeout", in: "query", schema: { type: "number", minimum: 0, maximum: 25 } },
      ],
      response: object({ interaction: ref("Interaction"), timedOut: bool }),
    },
  },
  "/interactions/{id}/cancel": {
    post: {
      summary: "Cancel a pending prompt created by this token",
      scopes: ["interactions:create"],
      params: [idParam()],
      response: wrap("interaction", ref("Interaction")),
    },
  },
  "/activities": {
    get: {
      summary: "List Live Activities started by this token",
      scopes: ["activities:read"],
      params: [{ name: "limit", in: "query", schema: { ...int, minimum: 1, maximum: 100 } }],
      response: wrap("activities", arrayOf(ref("LiveActivity"))),
    },
    post: {
      summary: "Start a Live Activity",
      scopes: ["activities:write"],
      params: [idempotencyHeader],
      request: liveActivityStartSchema,
      status: 201,
      response: ref("LiveActivityMutation"),
    },
  },
  "/activities/{identifier}": {
    get: {
      summary: "Get a Live Activity by ID or key",
      scopes: ["activities:read"],
      params: [idParam("identifier")],
      response: wrap("activity", ref("LiveActivity")),
    },
    patch: {
      summary: "Update a Live Activity",
      scopes: ["activities:write"],
      params: [idParam("identifier"), idempotencyHeader],
      request: liveActivityUpdateSchema,
      response: ref("LiveActivityMutation"),
    },
  },
  "/activities/{identifier}/end": {
    post: {
      summary: "End a Live Activity",
      scopes: ["activities:write"],
      params: [idParam("identifier"), idempotencyHeader],
      request: liveActivityEndSchema,
      response: ref("LiveActivityMutation"),
    },
  },
  "/apps": {
    get: {
      summary: "List web apps",
      scopes: ["apps:read"],
      response: wrap("apps", arrayOf(ref("App"))),
    },
    post: {
      summary: "Register a web app (an existing URL is updated)",
      scopes: ["apps:write"],
      request: appCreateSchema,
      status: 201,
      response: object({ app: ref("App"), created: bool, message: str }, ["message"]),
    },
  },
  "/apps/{id}": {
    get: {
      summary: "Get a web app",
      scopes: ["apps:read"],
      params: [idParam()],
      response: wrap("app", ref("App")),
    },
    patch: {
      summary: "Update a web app's name, URL, icon, or project",
      scopes: ["apps:write"],
      params: [idParam()],
      request: appUpdateSchema,
      response: object({ app: ref("App"), message: str }, ["message"]),
      description:
        "Sharing preferences and sign-in consent are owner decisions made on the phone and cannot be changed here. Moving the URL to a new origin clears consent.",
    },
    delete: {
      summary: "Remove a web app",
      scopes: ["apps:write"],
      params: [idParam()],
      response: ok,
    },
  },
  "/apps/{id}/revoke": {
    post: {
      summary: "Revoke sign-in consent; the owner approves again on next open",
      scopes: ["apps:write"],
      params: [idParam()],
      response: wrap("app", ref("App")),
      description: "Agents can reduce access but never grant it: Hark passes are phone-only.",
    },
  },
  "/apps/{id}/share": {
    post: {
      summary: "Move an app into a team, or (teamId null) back to your own apps",
      scopes: ["apps:write"],
      params: [idParam()],
      request: appShareSchema,
      response: wrap("app", ref("App")),
      description:
        "Only the person who added the app can move it. Moving it into a team without the Team plan returns 402 with code `seat_limit`. Other members are notified unless `notify` is false, and each approves sign-in for themselves.",
    },
  },
  "/teams": {
    get: {
      summary: "List the teams you belong to",
      scopes: ["teams:read"],
      response: wrap("teams", arrayOf(ref("Team"))),
    },
    post: {
      summary: "Create a team; you become its owner",
      scopes: ["teams:write"],
      request: teamCreateSchema,
      status: 201,
      response: wrap("team", ref("Team")),
      description:
        "Free to create. Adding people, sharing apps into it, on-call groups and pages need the Team plan ($5 per seat per month, every member including the owner), which only the owner can start from the team page on hark.fyi.",
    },
  },
  "/teams/{id}": {
    get: {
      summary: "A team and its members",
      scopes: ["teams:read"],
      params: [idParam()],
      response: object({ team: ref("Team"), members: arrayOf(ref("TeamMember")) }),
    },
    patch: {
      summary: "Rename a team (admin or owner)",
      scopes: ["teams:write"],
      params: [idParam()],
      request: teamUpdateSchema,
      response: wrap("team", ref("Team")),
    },
    delete: {
      summary: "Delete a team (owner); its apps return to the members who added them",
      scopes: ["teams:write"],
      params: [idParam()],
      response: ok,
    },
  },
  "/teams/{id}/leave": {
    post: {
      summary: "Leave a team (the owner must transfer ownership first)",
      scopes: ["teams:write"],
      params: [idParam()],
      response: ok,
    },
  },
  "/teams/{id}/members/{userId}": {
    patch: {
      summary: "Change a member's role; `owner` transfers ownership (owner only)",
      scopes: ["teams:write"],
      params: [idParam(), idParam("userId")],
      request: teamMemberUpdateSchema,
      response: wrap("member", ref("TeamMember")),
    },
    delete: {
      summary: "Remove a member (admin or owner); the owner cannot be removed",
      scopes: ["teams:write"],
      params: [idParam(), idParam("userId")],
      response: ok,
    },
  },
  "/teams/{id}/invites": {
    get: {
      summary: "List invites (admin or owner)",
      scopes: ["teams:read"],
      params: [idParam()],
      response: wrap("invites", arrayOf(ref("TeamInvite"))),
    },
    post: {
      summary: "Create a 7-day join link (admin or owner)",
      scopes: ["teams:write"],
      params: [idParam()],
      request: teamInviteCreateSchema,
      status: 201,
      response: ref("TeamInviteCreated"),
      description:
        "Returns 402 with code `seat_limit` when the team does not have the Team plan. Accepting an invite is human-only: there is no agent route for it.",
    },
  },
  "/teams/{id}/invites/{inviteId}": {
    delete: {
      summary: "Revoke an invite",
      scopes: ["teams:write"],
      params: [idParam(), idParam("inviteId")],
      response: ok,
    },
  },
  "/teams/{id}/apps": {
    get: {
      summary: "The team's shared apps",
      scopes: ["teams:read", "apps:read"],
      params: [idParam()],
      response: wrap("apps", arrayOf(ref("App"))),
    },
  },
  "/teams/{id}/oncall": {
    get: {
      summary: "The team's on-call groups with current and upcoming shifts",
      scopes: ["oncall:read"],
      params: [idParam()],
      response: wrap("groups", arrayOf(ref("OncallGroup"))),
    },
    post: {
      summary: "Create an on-call group (admin or owner)",
      scopes: ["oncall:write"],
      params: [idParam()],
      request: oncallGroupCreateSchema,
      status: 201,
      response: wrap("group", ref("OncallGroup")),
      description: "Returns 402 with code `seat_limit` when the team does not have the Team plan.",
    },
  },
  "/teams/{id}/pages": {
    get: {
      summary: "The team's pages, newest first",
      scopes: ["oncall:read"],
      params: [
        idParam(),
        { name: "status", in: "query", schema: { enum: ["open", "all"] } },
        { name: "cursor", in: "query", schema: str },
        { name: "limit", in: "query", schema: { ...int, minimum: 1, maximum: 50 } },
      ],
      response: object({ pages: arrayOf(ref("OncallPage")), nextCursor: nullableStr }),
    },
  },
  "/oncall/me": {
    get: {
      summary: "Your upcoming shifts and the open pages that notified you",
      scopes: ["oncall:read"],
      response: object({
        shifts: arrayOf({
          allOf: [
            ref("OncallShift"),
            object({ groupId: str, groupName: str, teamId: str, teamName: str }),
          ],
        }),
        pages: arrayOf(ref("OncallPage")),
        settings: ref("OncallSettings"),
      }),
    },
  },
  "/oncall/settings": {
    get: {
      summary: "Your ringing settings and each iPhone's Critical Alerts permission",
      scopes: ["oncall:read"],
      response: wrap("settings", ref("OncallSettings")),
    },
    patch: {
      summary: "Change your ringing settings (ring until acknowledged, repeat interval)",
      scopes: ["oncall:write"],
      request: oncallSettingsUpdateSchema,
      response: wrap("settings", ref("OncallSettings")),
    },
  },
  "/oncall/{groupId}": {
    get: {
      summary: "An on-call group",
      scopes: ["oncall:read"],
      params: [idParam("groupId")],
      response: wrap("group", ref("OncallGroup")),
    },
    patch: {
      summary: "Edit a group's name, rotation, escalation, or ringing (admin or owner)",
      scopes: ["oncall:write"],
      params: [idParam("groupId")],
      request: oncallGroupUpdateSchema,
      response: wrap("group", ref("OncallGroup")),
    },
    delete: {
      summary: "Delete an on-call group (admin or owner)",
      scopes: ["oncall:write"],
      params: [idParam("groupId")],
      response: ok,
    },
  },
  "/oncall/{groupId}/overrides": {
    post: {
      summary: "Put someone on call for a window (admins: anyone; members: themselves)",
      scopes: ["oncall:write"],
      params: [idParam("groupId")],
      request: oncallOverrideCreateSchema,
      status: 201,
      response: wrap("group", ref("OncallGroup")),
    },
  },
  "/oncall/{groupId}/overrides/{overrideId}": {
    delete: {
      summary: "Remove an override",
      scopes: ["oncall:write"],
      params: [idParam("groupId"), idParam("overrideId")],
      response: wrap("group", ref("OncallGroup")),
    },
  },
  "/oncall/{groupId}/pages": {
    post: {
      summary: "Page the group: whoever is on call first, then escalation",
      scopes: ["oncall:write"],
      params: [idParam("groupId")],
      request: oncallPageCreateSchema,
      status: 201,
      response: ref("OncallPageCreated"),
      description:
        "Returns 200 with `deduplicated: true` when an open page with the same `dedupKey` absorbed it. Returns 402 when the team does not have the Team plan. Pages count against your notification allowance.",
    },
  },
  "/pages/{id}": {
    get: {
      summary: "A page",
      scopes: ["oncall:read"],
      params: [idParam()],
      response: wrap("page", ref("OncallPage")),
      description:
        "There is deliberately no agent route to acknowledge or escalate: an acknowledgement tells the team a person is on it, so only a human can give it (on the phone or in a signed-in session).",
    },
  },
  "/pages/{id}/resolve": {
    post: {
      summary: "Resolve a page; anyone still being paged is cleared",
      scopes: ["oncall:write"],
      params: [idParam()],
      request: oncallPageResolveSchema,
      response: wrap("page", ref("OncallPage")),
    },
  },
  "/inbox/projects": {
    get: {
      summary: "Inbox projects with unread counts",
      scopes: ["inbox:read"],
      response: ref("InboxProjects"),
    },
  },
  "/inbox/notifications": {
    get: {
      summary: "Inbox notifications, newest first, with cursor pagination",
      scopes: ["inbox:read"],
      params: [
        {
          name: "limit",
          in: "query",
          schema: { ...int, minimum: 1, maximum: INBOX_PAGE_MAX_LIMIT },
        },
        {
          name: "project",
          in: "query",
          schema: { ...str, description: "Project ID, or `unfiled`." },
        },
        { name: "unread", in: "query", schema: { enum: ["1", "true"] } },
        { name: "cursor", in: "query", schema: str },
      ],
      response: ref("InboxNotificationPage"),
    },
  },
  "/inbox/notifications/{id}": {
    get: {
      summary: "One inbox notification with its full body",
      scopes: ["inbox:read"],
      params: [idParam()],
      response: wrap("notification", ref("InboxNotificationDetail")),
    },
  },
  "/inbox/notifications/read-all": {
    post: {
      summary: "Mark everything up to a list response's readThroughToken read",
      scopes: ["inbox:write"],
      request: inboxMarkAllReadSchema,
      response: object({ ok: { const: true }, updated: int }),
    },
  },
  "/inbox/notifications/{id}/read": {
    post: {
      summary: "Mark one notification read",
      scopes: ["inbox:write"],
      params: [idParam()],
      response: ref("ReadMark"),
    },
  },
  "/inbox/notifications/{id}/unread": {
    post: {
      summary: "Mark one notification unread",
      scopes: ["inbox:write"],
      params: [idParam()],
      response: ref("ReadMark"),
    },
  },
  "/billing": {
    get: {
      summary: "Plan, limits, and remaining usage",
      scopes: ["billing:read"],
      response: ref("Billing"),
      description:
        "`pro` is legacy Hark Pro (no longer sold); everyone else is `free`. `features.deviceRouting` says whether `deviceIds` is accepted. Team seats are billed to each team and never change these personal limits. Checkout and the billing portal are session-only.",
    },
  },
  "/feedback": {
    post: {
      summary: "Report a Hark bug or send feedback to the Hark team",
      scopes: [],
      request: feedbackCreateSchema,
      status: 201,
      response: object({
        feedback: object({ id: str, kind: str, createdAt: str }),
        message: str,
      }),
      description: `For problems with Hark itself (errors, wrong or confusing behaviour, docs that do not match, missing features), not with the user's own apps. Put what happened in \`message\` and the tool or command, the request and the exact error text in \`context\`. Never include secrets, tokens, webhook URLs or other people's personal data. The Hark team reads every report; there is no reply through the API, so tell the user they can also email support@hark.fyi. Limited to ${FEEDBACK_LIMIT_PER_HOUR} an hour and ${FEEDBACK_LIMIT_PER_DAY} a day per account (\`429\`, code \`rate_limited\`).`,
    },
  },
};

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});

function toPathItem(path: string): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const [method, operation] of Object.entries(agentOperations[path] ?? {})) {
    if (!operation) continue;
    const status = String(operation.status ?? 200);
    item[method] = {
      summary: operation.summary,
      ...(operation.description ? { description: operation.description } : {}),
      operationId: `${method}${path.replace(/[{}]/g, "").replace(/[/-](\w)/g, (_, c: string) => c.toUpperCase())}`,
      security: [{ bearer: operation.scopes }],
      "x-hark-scopes": operation.scopes,
      ...(operation.params
        ? {
            parameters: operation.params.map((param) => ({
              ...param,
              required: param.in === "path",
            })),
          }
        : {}),
      ...(operation.request
        ? {
            requestBody: {
              required: true,
              content: { "application/json": { schema: requestSchema(operation.request) } },
            },
          }
        : {}),
      responses: {
        [status]: {
          description: "Success",
          content: { "application/json": { schema: operation.response } },
        },
        "400": errorResponse("Invalid request"),
        "401": errorResponse("Missing, unknown, revoked, or expired token"),
        "403": errorResponse("The token lacks a required scope"),
        "404": errorResponse("Not found for this account"),
      },
    };
  }
  return item;
}

export const AGENT_API_PREFIX = "/api/agent";

export const agentOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Hark Agent API",
    version: "1.0.0",
    description:
      "Scoped bearer-token API for agents and scripts (`Authorization: Bearer hark_…`). Docs for agents: https://hark.fyi/agents.md. Hark is free for personal use; team features need the team's Team plan ($5 per seat per month) and otherwise return 402. Every route is owner-scoped: resources of other accounts return 404. Human-only actions are deliberately absent: answering prompts, approving app sign-in or issuing Hark passes, changing app sharing, creating API tokens, registering devices, starting checkout or the billing portal, accepting team invites, and acknowledging or escalating on-call pages.",
  },
  /** Relative here; the route below serves it absolute on the canonical origin. */
  servers: [{ url: AGENT_API_PREFIX }],
  components: {
    securitySchemes: {
      bearer: {
        type: "http",
        scheme: "bearer",
        description: "A Hark agent token from `harkctl auth login` or the dashboard.",
      },
    },
    schemas,
  },
  paths: Object.fromEntries(Object.keys(agentOperations).map((path) => [path, toPathItem(path)])),
  "x-hark-scopes": [...API_TOKEN_SCOPES],
};

/**
 * Public, unauthenticated discovery document. Mount before the agent routes.
 * The server URL is absolute so clients that load the spec from elsewhere (or
 * from a legacy host) call the canonical API, and any origin may read it.
 */
export const agentOpenApiRoute = new Hono().get("/openapi.json", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  c.header("Access-Control-Allow-Origin", "*");
  return c.json({
    ...agentOpenApiDocument,
    servers: [{ url: `${canonicalOrigin()}${AGENT_API_PREFIX}` }],
  });
});
