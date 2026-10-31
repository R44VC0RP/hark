import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Better Auth core tables
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  welcomeNotificationSentAt: integer("welcome_notification_sent_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("session_user_id_idx").on(table.userId),
    index("session_expires_at_idx").on(table.expiresAt),
  ],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    index("account_provider_account_idx").on(table.providerId, table.accountId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("verification_identifier_idx").on(table.identifier),
    index("verification_expires_at_idx").on(table.expiresAt),
  ],
);

/** Native Apple grants are separate from Better Auth accounts so refresh tokens stay encrypted. */
export const appleNativeGrant = sqliteTable(
  "apple_native_grant",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    appleSubject: text("apple_subject").notNull(),
    clientId: text("client_id").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    /** Domain-separated digest of Apple's single-use authorization code. */
    authorizationCodeHash: text("authorization_code_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("apple_native_grant_user_unique").on(table.userId),
    uniqueIndex("apple_native_grant_code_hash_unique").on(table.authorizationCodeHash),
    index("apple_native_grant_subject_idx").on(table.appleSubject),
  ],
);

// ---------------------------------------------------------------------------
// Hark domain tables
// ---------------------------------------------------------------------------

export const service = sqliteTable(
  "service",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    imageUrl: text("image_url"),
    url: text("url"),
    /** SHA-256 hex digest of the webhook token. The plaintext token is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    /** AES-GCM encrypted token, used to let the owner copy the URL again. */
    tokenCiphertext: text("token_ciphertext"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("service_user_id_idx").on(table.userId)],
);

/**
 * User-scoped notification project. Identity is the case-insensitive,
 * NFC-normalized name; the display name keeps the sender's original casing.
 */
export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("project_user_normalized_name_unique").on(table.userId, table.normalizedName),
    index("project_user_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const device = sqliteTable(
  "device",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expoPushToken: text("expo_push_token").notNull().unique(),
    apnsToken: text("apns_token"),
    platform: text("platform").notNull().default("ios"),
    deviceName: text("device_name"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    liveActivityPushToStartTokenCiphertext: text("live_activity_push_to_start_token_ciphertext"),
    liveActivityTokenEnvironment: text("live_activity_token_environment"),
    liveActivitySchemaVersion: integer("live_activity_schema_version"),
    liveActivityTokenUpdatedAt: integer("live_activity_token_updated_at", { mode: "timestamp_ms" }),
    interactionSchemaVersion: integer("interaction_schema_version"),
    liveActivityInteractionVersion: integer("live_activity_interaction_version"),
    /**
     * Critical Alerts permission as last reported by the app: `authorized`,
     * `denied`, `notDetermined`, or `unavailable` (no entitlement in the build).
     * Null until a build that reports it registers. Page pushes use the
     * critical sound only for `authorized` devices.
     */
    criticalAlerts: text("critical_alerts"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("device_user_id_idx").on(table.userId)],
);

/**
 * Delivery log and project-inbox backing store; not exposed as analytics.
 * Bodies are capped at ingestion (8,000 chars / 16 KiB UTF-8) and summaries at
 * 500 chars. Retention follow-up: rows currently persist until account
 * deletion; a scheduled prune of old read rows is planned but out of V1 scope.
 */
export const event = sqliteTable(
  "event",
  {
    id: text("id").primaryKey(),
    serviceId: text("service_id")
      .notNull()
      .references(() => service.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    url: text("url"),
    status: text("status").notNull(),
    deliveredCount: integer("delivered_count").notNull().default(0),
    error: text("error"),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    /** Optional project association; delivery survives project deletion. */
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    /** Account-global read marker. Null means unread in the project inbox. */
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    /** Stored metadata only in V1; `text` when null. */
    bodyFormat: text("body_format"),
    /** Sender-supplied digest used for push text and bounded previews. */
    summary: text("summary"),
    /** Optional web app opened on tap; delivery survives app deletion. */
    appId: text("app_id").references((): AnySQLiteColumn => app.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("event_service_idempotency_key_unique").on(table.serviceId, table.idempotencyKey),
    index("event_service_created_at_idx").on(table.serviceId, table.createdAt),
    index("event_project_created_at_idx").on(table.projectId, table.createdAt),
    index("event_unread_idx").on(table.serviceId, table.createdAt).where(sql`"read_at" is null`),
  ],
);

export const apiToken = sqliteTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 digest of a high-entropy token. Plaintext is returned only at creation. */
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    /**
     * Set for the grant behind a connected OAuth (MCP) client. Such rows have
     * no usable secret: the client authenticates with OAuth access tokens and
     * this row carries the stable identity agent routes scope ownership to.
     */
    oauthClientId: text("oauth_client_id"),
  },
  (table) => [
    index("api_token_user_created_at_idx").on(table.userId, table.createdAt),
    index("api_token_prefix_idx").on(table.prefix),
    uniqueIndex("api_token_active_oauth_grant_unique")
      .on(table.userId, table.oauthClientId)
      .where(sql`"oauth_client_id" is not null and "revoked_at" is null`),
  ],
);

/** One-shot pushes sent with an agent API token, kept for idempotent retries. */
export const agentNotification = sqliteTable(
  "agent_notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null for Hark's own notices (team invites, shared apps), which have no token. */
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    /** Sender label for token-less notices; token rows use the token name. */
    sourceName: text("source_name"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    imageUrl: text("image_url"),
    url: text("url"),
    acceptedCount: integer("accepted_count").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    /** Optional project association; delivery survives project deletion. */
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    /** Account-global read marker. Null means unread in the project inbox. */
    readAt: integer("read_at", { mode: "timestamp_ms" }),
    /** Stored metadata only in V1; `text` when null. */
    bodyFormat: text("body_format"),
    /** Sender-supplied digest used for push text and bounded previews. */
    summary: text("summary"),
    /** Optional web app opened on tap; delivery survives app deletion. */
    appId: text("app_id").references((): AnySQLiteColumn => app.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_notification_token_idempotency_unique").on(
      table.requesterTokenId,
      table.idempotencyKey,
    ),
    index("agent_notification_token_created_at_idx").on(table.requesterTokenId, table.createdAt),
    index("agent_notification_user_created_at_idx").on(table.userId, table.createdAt),
    index("agent_notification_project_created_at_idx").on(table.projectId, table.createdAt),
    index("agent_notification_unread_idx")
      .on(table.userId, table.createdAt)
      .where(sql`"read_at" is null`),
  ],
);

/**
 * Owner-registered web app opened full-screen in the Hark iPhone app. Sign-in
 * passes are issued only after the owner consents, and are bound to `origin`.
 */
export const app = sqliteTable(
  "app",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Launch URL loaded by the in-app web view. */
    url: text("url").notNull(),
    /** Canonical origin of `url`; the Hark pass audience. */
    origin: text("origin").notNull(),
    iconUrl: text("icon_url"),
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    shareName: integer("share_name", { mode: "boolean" }).notNull().default(true),
    shareEmail: integer("share_email", { mode: "boolean" }).notNull().default(false),
    /** Null until the owner approves sign-in; revoking clears it. */
    consentedAt: integer("consented_at", { mode: "timestamp_ms" }),
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp_ms" }),
    createdByTokenId: text("created_by_token_id").references(() => apiToken.id, {
      onDelete: "set null",
    }),
    /**
     * Team that owns the app; null for personal apps. For team apps `userId`
     * is the member who added it, and per-member sharing and consent live in
     * `app_member_state` instead of the columns above.
     */
    teamId: text("team_id").references((): AnySQLiteColumn => team.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("app_user_url_unique").on(table.userId, table.url),
    index("app_user_id_idx").on(table.userId),
    index("app_team_id_idx").on(table.teamId),
  ],
);

/** Each member's own sharing choices and sign-in consent for a team app. */
export const appMemberState = sqliteTable(
  "app_member_state",
  {
    appId: text("app_id")
      .notNull()
      .references(() => app.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    shareName: integer("share_name", { mode: "boolean" }).notNull().default(true),
    shareEmail: integer("share_email", { mode: "boolean" }).notNull().default(false),
    consentedAt: integer("consented_at", { mode: "timestamp_ms" }),
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("app_member_state_app_user_unique").on(table.appId, table.userId),
    index("app_member_state_user_idx").on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// Teams and on-call
// ---------------------------------------------------------------------------

export const team = sqliteTable("team", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const teamMember = sqliteTable(
  "team_member",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `owner` (exactly one), `admin`, or `member`. */
    role: text("role").notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("team_member_team_user_unique").on(table.teamId, table.userId),
    index("team_member_user_idx").on(table.userId),
  ],
);

export const teamInvite = sqliteTable(
  "team_invite",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    /** Domain-separated SHA-256 digest; the plaintext join code is returned once. */
    codeHash: text("code_hash").notNull(),
    email: text("email"),
    role: text("role").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    invitedByName: text("invited_by_name").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    acceptedByUserId: text("accepted_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("team_invite_code_hash_unique").on(table.codeHash),
    index("team_invite_team_created_idx").on(table.teamId, table.createdAt),
  ],
);

export const oncallGroup = sqliteTable(
  "oncall_group",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Rotation order of user IDs. Members who leave the team are removed. */
    memberIds: text("member_ids", { mode: "json" }).$type<string[]>().notNull(),
    period: text("period").notNull(),
    handoffAt: text("handoff_at").notNull(),
    timezone: text("timezone").notNull(),
    /** First handoff, normalized to `handoffAt` in `timezone`. */
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    escalation: text("escalation", { mode: "json" })
      .$type<
        Array<{
          afterMinutes: number;
          target: "next" | "oncall" | "people" | "group" | "team";
          userIds?: string[];
          groupId?: string;
        }>
      >()
      .notNull(),
    /** `fan_out`: earlier levels keep ringing; `hand_off`: a new level silences them. */
    escalationMode: text("escalation_mode").notNull().default("fan_out"),
    /** Times the policy runs again after its last level. */
    escalationLoops: integer("escalation_loops").notNull().default(0),
    /** `none`, `group`, or `team`: paged once after the last level and loops. */
    escalationFinal: text("escalation_final").notNull().default("none"),
    /** Seconds between repeat alerts while a page is unacknowledged. */
    ringIntervalSeconds: integer("ring_interval_seconds").notNull().default(60),
    /** Repeat alerts per person after the first; 0 alerts once. */
    ringMaxRepeats: integer("ring_max_repeats").notNull().default(10),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("oncall_group_team_idx").on(table.teamId)],
);

export const oncallOverride = sqliteTable(
  "oncall_override",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => oncallGroup.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("oncall_override_group_ends_idx").on(table.groupId, table.endsAt)],
);

export const oncallPage = sqliteTable(
  "oncall_page",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => oncallGroup.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    url: text("url"),
    appId: text("app_id").references(() => app.id, { onDelete: "set null" }),
    /** `triggered`, `acknowledged`, or `resolved`. */
    status: text("status").notNull(),
    /** `high` rings and escalates; `low` alerts once and waits for a person. */
    urgency: text("urgency").notNull().default("high"),
    dedupKey: text("dedup_key"),
    repeatCount: integer("repeat_count").notNull().default(0),
    /** Escalation steps already run. */
    escalationStep: integer("escalation_step").notNull().default(0),
    /** Read by the escalation worker, so pending escalations survive restarts. */
    nextEscalationAt: integer("next_escalation_at", { mode: "timestamp_ms" }),
    /** User most recently paged individually; `next` steps continue after them. */
    lastPagedUserId: text("last_paged_user_id"),
    sourceName: text("source_name").notNull(),
    /** User whose notification allowance the page counts against. */
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    acknowledgedByUserId: text("acknowledged_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    acknowledgedAt: integer("acknowledged_at", { mode: "timestamp_ms" }),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolveNote: text("resolve_note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("oncall_page_team_created_idx").on(table.teamId, table.createdAt),
    index("oncall_page_escalation_idx").on(table.status, table.nextEscalationAt),
    uniqueIndex("oncall_page_open_dedup_unique")
      .on(table.groupId, table.dedupKey)
      .where(sql`${table.status} in ('triggered', 'acknowledged')`),
  ],
);

/** Everyone a page notified, with their one-shot lock-screen credential. */
export const oncallPageRecipient = sqliteTable(
  "oncall_page_recipient",
  {
    pageId: text("page_id")
      .notNull()
      .references(() => oncallPage.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 0 for the initial notification, then the escalation step number. */
    step: integer("step").notNull(),
    responseTokenHash: text("response_token_hash").notNull(),
    /** Set on the credential's first successful use; it is single-use. */
    responseTokenUsedAt: integer("response_token_used_at", { mode: "timestamp_ms" }),
    /**
     * The credential sent with the previous alert. Each repeat alert rotates
     * the credential; the one before stays valid so a tap that races a repeat
     * still works.
     */
    previousResponseTokenHash: text("previous_response_token_hash"),
    acceptedCount: integer("accepted_count").notNull().default(0),
    notifiedAt: integer("notified_at", { mode: "timestamp_ms" }).notNull(),
    /** Repeat alerts sent so far. */
    ringCount: integer("ring_count").notNull().default(0),
    /**
     * Next repeat alert, read by the worker so ringing survives restarts.
     * Null once the person stops ringing (acknowledged, resolved, handed off,
     * out of repeats, or ring-until-acknowledged turned off).
     */
    nextRingAt: integer("next_ring_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("oncall_page_recipient_page_user_unique").on(table.pageId, table.userId),
    uniqueIndex("oncall_page_recipient_token_unique").on(table.responseTokenHash),
    index("oncall_page_recipient_user_idx").on(table.userId, table.notifiedAt),
    index("oncall_page_recipient_ring_idx").on(table.nextRingAt),
  ],
);

/** Page timeline: who was paged at which level, and who claimed or resolved it. */
export const oncallPageEvent = sqliteTable(
  "oncall_page_event",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => oncallPage.id, { onDelete: "cascade" }),
    /** `paged`, `acknowledged`, or `resolved`. */
    kind: text("kind").notNull(),
    level: integer("level"),
    loop: integer("loop"),
    userIds: text("user_ids", { mode: "json" }).$type<string[]>().notNull(),
    /** Person who escalated by hand; null for scheduled escalations. */
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("oncall_page_event_page_idx").on(table.pageId, table.createdAt)],
);

/** A person's own paging preferences, shared by every group they are in. */
export const oncallPreference = sqliteTable("oncall_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Repeat the alert until someone acknowledges; false alerts once per page. */
  ringUntilAcknowledged: integer("ring_until_acknowledged", { mode: "boolean" })
    .notNull()
    .default(true),
  /** Overrides the group's repeat interval for this person; null uses the group's. */
  ringIntervalSeconds: integer("ring_interval_seconds"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** ES256 keys that sign Hark passes. Private keys are stored encrypted. */
export const appSigningKey = sqliteTable("app_signing_key", {
  /** JWK `kid`. */
  id: text("id").primaryKey(),
  algorithm: text("algorithm").notNull(),
  /** Public JWK as JSON, served from the JWKS endpoint while not retired. */
  publicJwk: text("public_jwk").notNull(),
  privateJwkCiphertext: text("private_jwk_ciphertext").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  retiredAt: integer("retired_at", { mode: "timestamp_ms" }),
});

export const deviceAuthorizationRequest = sqliteTable(
  "device_authorization_request",
  {
    id: text("id").primaryKey(),
    /** Domain-separated SHA-256 digest. The plaintext device code is never persisted. */
    deviceCodeHash: text("device_code_hash").notNull(),
    userCode: text("user_code").notNull(),
    clientName: text("client_name").notNull(),
    requestedScopes: text("requested_scopes", { mode: "json" }).$type<string[]>().notNull(),
    status: text("status").notNull().default("pending"),
    approvedUserId: text("approved_user_id").references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    tokenExpiresAt: integer("token_expires_at", { mode: "timestamp_ms" }).notNull(),
    pollIntervalSeconds: integer("poll_interval_seconds").notNull(),
    lastPollAt: integer("last_poll_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
    /** Shown on the approval page so a person can spot a request they did not start. */
    requesterUserAgent: text("requester_user_agent"),
    /** Trusted client IP with the last octet/group masked; null without a trusted edge header. */
    requesterIp: text("requester_ip"),
  },
  (table) => [
    uniqueIndex("device_authorization_device_code_hash_unique").on(table.deviceCodeHash),
    uniqueIndex("device_authorization_user_code_unique").on(table.userCode),
    index("device_authorization_status_expiry_idx").on(table.status, table.expiresAt),
    index("device_authorization_approved_user_idx").on(table.approvedUserId),
  ],
);

export const interaction = sqliteTable(
  "interaction",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    requesterServiceId: text("requester_service_id").references(() => service.id, {
      onDelete: "cascade",
    }),
    eventId: text("event_id").references(() => event.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    kind: text("kind").notNull(),
    presentation: text("presentation").notNull().default("notification"),
    primaryLabel: text("primary_label"),
    secondaryLabel: text("secondary_label"),
    status: text("status").notNull().default("pending"),
    choices: text("choices", { mode: "json" }).$type<string[]>().notNull(),
    response: text("response"),
    url: text("url"),
    imageUrl: text("image_url"),
    correlationId: text("correlation_id"),
    /** Digest echoed by the notification action to bind responses to the exact interaction. */
    actionDigest: text("action_digest").notNull(),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    responseTokenHash: text("response_token_hash"),
    callbackUrl: text("callback_url"),
    callbackTokenCiphertext: text("callback_token_ciphertext"),
    callbackStatus: text("callback_status"),
    callbackAttempts: integer("callback_attempts").notNull().default(0),
    callbackNextAttemptAt: integer("callback_next_attempt_at", { mode: "timestamp_ms" }),
    callbackLastError: text("callback_last_error"),
    callbackDeliveredAt: integer("callback_delivered_at", { mode: "timestamp_ms" }),
    acceptedCount: integer("accepted_count").notNull().default(0),
    respondingDeviceId: text("responding_device_id").references(() => device.id, {
      onDelete: "set null",
    }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    respondedAt: integer("responded_at", { mode: "timestamp_ms" }),
    canceledAt: integer("canceled_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check(
      "interaction_requester_check",
      sql`("requester_token_id" is not null) != ("requester_service_id" is not null)`,
    ),
    uniqueIndex("interaction_token_idempotency_unique").on(
      table.requesterTokenId,
      table.idempotencyKey,
    ),
    index("interaction_token_created_at_idx").on(table.requesterTokenId, table.createdAt),
    uniqueIndex("interaction_service_idempotency_unique").on(
      table.requesterServiceId,
      table.idempotencyKey,
    ),
    uniqueIndex("interaction_event_unique").on(table.eventId),
    index("interaction_service_created_at_idx").on(table.requesterServiceId, table.createdAt),
    index("interaction_callback_due_idx").on(table.callbackStatus, table.callbackNextAttemptAt),
    index("interaction_user_status_expiry_idx").on(table.userId, table.status, table.expiresAt),
    index("interaction_user_responded_at_idx").on(table.userId, table.respondedAt),
  ],
);

export const liveActivity = sqliteTable(
  "live_activity",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    requesterServiceId: text("requester_service_id").references(() => service.id, {
      onDelete: "cascade",
    }),
    interactionId: text("interaction_id")
      .unique()
      .references(() => interaction.id, { onDelete: "cascade" }),
    key: text("key"),
    schemaVersion: integer("schema_version").notNull(),
    props: text("props", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("starting"),
    sequence: integer("sequence").notNull().default(0),
    apnsTimestamp: integer("apns_timestamp").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    staleAt: integer("stale_at", { mode: "timestamp_ms" }),
    dismissalAt: integer("dismissal_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check(
      "live_activity_requester_check",
      sql`("requester_token_id" is not null) != ("requester_service_id" is not null)`,
    ),
    uniqueIndex("live_activity_token_idempotency_unique").on(
      table.requesterTokenId,
      table.idempotencyKey,
    ),
    uniqueIndex("live_activity_service_idempotency_unique").on(
      table.requesterServiceId,
      table.idempotencyKey,
    ),
    // Keys must be unique only among non-terminal activities, so a requester
    // can reuse a stable key (for example `deploy`) once its activity ends.
    uniqueIndex("live_activity_token_key_unique")
      .on(table.requesterTokenId, table.key)
      .where(sql`${table.status} in ('starting', 'active', 'partial')`),
    uniqueIndex("live_activity_service_key_unique")
      .on(table.requesterServiceId, table.key)
      .where(sql`${table.status} in ('starting', 'active', 'partial')`),
    index("live_activity_user_status_updated_idx").on(table.userId, table.status, table.updatedAt),
    index("live_activity_token_created_idx").on(table.requesterTokenId, table.createdAt),
    index("live_activity_service_created_idx").on(table.requesterServiceId, table.createdAt),
  ],
);

export const liveActivityDelivery = sqliteTable(
  "live_activity_delivery",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => liveActivity.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => device.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull().default("task"),
    status: text("status").notNull().default("pending"),
    environment: text("environment").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    nativeActivityId: text("native_activity_id"),
    updateTokenCiphertext: text("update_token_ciphertext"),
    updateTokenUpdatedAt: integer("update_token_updated_at", { mode: "timestamp_ms" }),
    lastEvent: text("last_event"),
    lastSequence: integer("last_sequence").notNull().default(-1),
    lastApnsStatus: integer("last_apns_status"),
    lastApnsReason: text("last_apns_reason"),
    lastApnsId: text("last_apns_id"),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("live_activity_delivery_activity_device_unique").on(
      table.activityId,
      table.deviceId,
    ),
    index("live_activity_delivery_device_status_idx").on(table.deviceId, table.status),
    uniqueIndex("live_activity_delivery_one_active_task_per_device_unique")
      .on(table.deviceId)
      .where(
        sql`${table.purpose} = 'task' and ${table.status} in ('pending', 'accepted', 'active')`,
      ),
    index("live_activity_delivery_native_id_idx").on(table.nativeActivityId),
  ],
);

export const liveActivityOperation = sqliteTable(
  "live_activity_operation",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => liveActivity.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    requesterServiceId: text("requester_service_id").references(() => service.id, {
      onDelete: "cascade",
    }),
    event: text("event").notNull(),
    sequence: integer("sequence").notNull(),
    /** State immediately after this operation; null only for legacy rows. */
    props: text("props", { mode: "json" }).$type<Record<string, unknown>>(),
    idempotencyKey: text("idempotency_key"),
    requestHash: text("request_hash"),
    acceptedCount: integer("accepted_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "live_activity_operation_requester_check",
      sql`("requester_token_id" is not null) != ("requester_service_id" is not null)`,
    ),
    uniqueIndex("live_activity_operation_token_idempotency_unique").on(
      table.requesterTokenId,
      table.idempotencyKey,
    ),
    uniqueIndex("live_activity_operation_service_idempotency_unique").on(
      table.requesterServiceId,
      table.idempotencyKey,
    ),
    index("live_activity_operation_token_created_idx").on(table.requesterTokenId, table.createdAt),
    index("live_activity_operation_service_created_idx").on(
      table.requesterServiceId,
      table.createdAt,
    ),
    index("live_activity_operation_activity_created_idx").on(table.activityId, table.createdAt),
  ],
);

export const liveActivityDeliveryAttempt = sqliteTable(
  "live_activity_delivery_attempt",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => liveActivity.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => liveActivityDelivery.id, { onDelete: "cascade" }),
    operationId: text("operation_id")
      .notNull()
      .references(() => liveActivityOperation.id, { onDelete: "cascade" }),
    requesterTokenId: text("requester_token_id").references(() => apiToken.id, {
      onDelete: "cascade",
    }),
    requesterServiceId: text("requester_service_id").references(() => service.id, {
      onDelete: "cascade",
    }),
    event: text("event").notNull(),
    sequence: integer("sequence").notNull(),
    apnsStatus: integer("apns_status"),
    apnsReason: text("apns_reason"),
    apnsId: text("apns_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "live_activity_attempt_requester_check",
      sql`("requester_token_id" is not null) != ("requester_service_id" is not null)`,
    ),
    index("live_activity_attempt_token_created_idx").on(table.requesterTokenId, table.createdAt),
    index("live_activity_attempt_activity_created_idx").on(table.activityId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Self-hosted product analytics
//
// These tables hold aggregate usage signals only: identifiers, enum-ish names,
// coarse buckets and counters. Notification content, prompts, reply text,
// tokens, emails, IP addresses and user agents are never written here.
// ---------------------------------------------------------------------------

/** Append-only usage log. Pruned after ANALYTICS_RETENTION_DAYS. */
export const analyticsEvent = sqliteTable(
  "analytics_event",
  {
    id: text("id").primaryKey(),
    /** Client-generated retry key. Null for server-authoritative events. */
    clientEventId: text("client_event_id").unique(),
    /** Stable event name, e.g. `webhook_delivered`. See lib/analytics.ts. */
    name: text("name").notNull(),
    anonymousId: text("anonymous_id"),
    sessionId: text("session_id"),
    surface: text("surface"),
    userId: text("user_id"),
    serviceId: text("service_id"),
    deviceId: text("device_id"),
    /** Billing plan observed when the event happened: `free` or `pro`. */
    plan: text("plan"),
    /** Coarse outcome bucket, e.g. `accepted`, `no_devices`, `push_rejected`. */
    outcome: text("outcome"),
    /** Counter carried by the event, e.g. accepted pushes. */
    value: integer("value").notNull().default(0),
    /** Small JSON object of primitives. Capped in size; never free-form content. */
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("analytics_event_name_created_at_idx").on(table.name, table.createdAt),
    index("analytics_event_user_created_at_idx").on(table.userId, table.createdAt),
    index("analytics_event_anonymous_created_at_idx").on(table.anonymousId, table.createdAt),
    index("analytics_event_session_created_at_idx").on(table.sessionId, table.createdAt),
    index("analytics_event_created_at_idx").on(table.createdAt),
  ],
);

/** Tiny idempotent rollup keyed by UTC day plus metric name. Kept indefinitely. */
export const analyticsDaily = sqliteTable(
  "analytics_daily",
  {
    /** UTC date as `YYYY-MM-DD`. */
    day: text("day").notNull(),
    /** Event name, or `<name>:value` for the summed counter. */
    metric: text("metric").notNull(),
    value: integer("value").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("analytics_daily_day_metric_unique").on(table.day, table.metric)],
);

/** One row per user per UTC day of activity, so DAU/WAU/MAU is a cheap count. */
export const analyticsUserDay = sqliteTable(
  "analytics_user_day",
  {
    userId: text("user_id").notNull(),
    day: text("day").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("analytics_user_day_user_day_unique").on(table.userId, table.day),
    index("analytics_user_day_day_idx").on(table.day),
  ],
);

// ---------------------------------------------------------------------------
// OAuth provider (Better Auth `@better-auth/oauth-provider`) for the MCP server
// ---------------------------------------------------------------------------

/** Registered OAuth clients, mostly MCP clients from dynamic registration. */
export const oauthClient = sqliteTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    disabled: integer("disabled", { mode: "boolean" }).default(false),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    subjectType: text("subject_type"),
    /** JSON string array (the adapter serializes arrays on SQLite). */
    scopes: text("scopes"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    grantTypes: text("grant_types"),
    responseTypes: text("response_types"),
    public: integer("public", { mode: "boolean" }),
    type: text("type"),
    requirePKCE: integer("require_pkce", { mode: "boolean" }),
    referenceId: text("reference_id"),
    metadata: text("metadata"),
  },
  (table) => [index("oauth_client_user_idx").on(table.userId)],
);

/** Hashed opaque refresh tokens (`offline_access`); rotated on every use. */
export const oauthRefreshToken = sqliteTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    authTime: integer("auth_time", { mode: "timestamp_ms" }),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("oauth_refresh_token_client_idx").on(table.clientId),
    index("oauth_refresh_token_session_idx").on(table.sessionId),
    index("oauth_refresh_token_user_idx").on(table.userId),
  ],
);

/** Hashed opaque access tokens. `/mcp` looks them up on every request. */
export const oauthAccessToken = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("oauth_access_token_client_idx").on(table.clientId),
    index("oauth_access_token_session_idx").on(table.sessionId),
    index("oauth_access_token_user_idx").on(table.userId),
    index("oauth_access_token_refresh_idx").on(table.refreshId),
  ],
);

/** Remembered consent per user and client; the scopes granted last time. */
export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    scopes: text("scopes").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("oauth_consent_client_idx").on(table.clientId),
    index("oauth_consent_user_idx").on(table.userId),
  ],
);

/** Bug reports and requests sent to the Hark team with an agent token (POST /api/agent/feedback). */
export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The token that sent it; kept as plain text so revoking the token keeps the report. */
    tokenId: text("token_id"),
    /** The sending token's name or OAuth client, e.g. `harkctl` or `Claude Code`. */
    client: text("client"),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    context: text("context"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("feedback_user_created_at_idx").on(table.userId, table.createdAt)],
);
