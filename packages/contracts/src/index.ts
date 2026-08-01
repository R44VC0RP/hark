import { z } from "zod";

/** Version of the push `data` payload schema understood by the iOS extension. */
export const PUSH_SCHEMA_VERSION = 1 as const;

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    ) {
      return false;
    }

    const ipv4 = hostname.split(".").map(Number);
    if (
      ipv4.length === 4 &&
      ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      const [a, b] = ipv4;
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        // Carrier-grade NAT and IETF protocol assignments reach internal hosts too.
        (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
        (a === 192 && b === 0) ||
        (a === 198 && b !== undefined && (b === 18 || b === 19)) ||
        a === 224 ||
        a === 255
      ) {
        return false;
      }
    }

    if (
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      hostname.startsWith("fe80:") ||
      // IPv4-mapped IPv6 (::ffff:127.0.0.1) otherwise bypasses the checks above.
      hostname.startsWith("::ffff:")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

const publicHttpsUrlSchema = z
  .url()
  .max(2048)
  .refine(isPublicHttpsUrl, "Must be a public HTTPS URL");

/**
 * Tap destinations are handed to the iOS app and opened with `Linking.openURL`,
 * so only web schemes are accepted: `javascript:`, `data:`, `file:` and custom
 * app schemes must never reach a device.
 */
const webUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  }, "Must be an http or https URL");

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const serviceCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80),
  imageUrl: publicHttpsUrlSchema.nullish(),
  url: webUrlSchema.nullish(),
});
export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;

export const serviceUpdateSchema = serviceCreateSchema
  .partial()
  .refine((input) => Object.keys(input).length > 0, "At least one field is required");
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>;

export interface ServiceDto {
  id: string;
  title: string;
  imageUrl: string | null;
  url: string | null;
  /** Available for tokens generated after encrypted token storage was enabled. */
  webhookUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned when a service is created or its token is rotated. */
export interface ServiceCreatedResponse {
  service: ServiceDto;
  /** Full webhook URL containing the plaintext token. */
  webhookUrl: string;
}

// ---------------------------------------------------------------------------
// Webhook ingestion
// ---------------------------------------------------------------------------

const webhookCallbackSchema = z.object({
  url: publicHttpsUrlSchema,
  token: z.string().min(16).max(512),
});

const webhookResponseRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("approval"),
    expiresInSeconds: z.number().int().min(30).max(86_400).default(900),
    correlationId: z.string().trim().min(1).max(100).optional(),
    callback: webhookCallbackSchema.optional(),
  }),
  z.object({
    type: z.literal("yes_no"),
    expiresInSeconds: z.number().int().min(30).max(86_400).default(900),
    correlationId: z.string().trim().min(1).max(100).optional(),
    callback: webhookCallbackSchema.optional(),
  }),
  z.object({
    type: z.literal("text"),
    expiresInSeconds: z.number().int().min(30).max(86_400).default(900),
    correlationId: z.string().trim().min(1).max(100).optional(),
    callback: webhookCallbackSchema.optional(),
  }),
]);

export const webhookRequestSchema = z.object({
  body: z.string().trim().min(1, "body is required").max(2000),
  title: z.string().trim().min(1).max(80).optional(),
  imageUrl: publicHttpsUrlSchema.optional(),
  url: webUrlSchema.optional(),
  deviceIds: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)].sort())
    .optional(),
  response: webhookResponseRequestSchema.optional(),
});
export type WebhookRequest = z.infer<typeof webhookRequestSchema>;

export type WebhookResponse =
  | {
      ok: true;
      eventId: string;
      delivered: number;
      response?: { status: "pending"; expiresAt: string };
      idempotent?: boolean;
      message?: string;
    }
  | { ok: false; error: string; issues?: unknown; retryAfterSeconds?: number };

export interface EventDto {
  id: string;
  serviceId: string;
  serviceTitle: string;
  title: string;
  body: string;
  imageUrl: string | null;
  url: string | null;
  status: string;
  deliveredCount: number;
  error: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const deviceRegisterSchema = z.object({
  expoPushToken: z.string().min(1).max(400),
  apnsToken: z.string().min(1).max(400).optional(),
  platform: z.literal("ios"),
  deviceName: z.string().trim().max(80).optional(),
  interactionSchemaVersion: z.literal(1).optional(),
  liveActivityInteractionVersion: z.literal(1).optional(),
});
export type DeviceRegisterInput = z.infer<typeof deviceRegisterSchema>;

export const deviceUnregisterSchema = z.object({
  expoPushToken: z.string().min(1).max(400),
});
export type DeviceUnregisterInput = z.infer<typeof deviceUnregisterSchema>;

// ---------------------------------------------------------------------------
// Product analytics
// ---------------------------------------------------------------------------

export const CLIENT_ANALYTICS_EVENT_NAMES = [
  "page_view",
  "screen_view",
  "outbound_clicked",
  "auth_started",
  "auth_completed",
  "app_open",
  "notification_opened",
  "notification_permission_prompted",
  "notification_permission_resolved",
  "device_registration_started",
  "device_registration_completed",
  "onboarding_completed",
] as const;
export const clientAnalyticsEventNameSchema = z.enum(CLIENT_ANALYTICS_EVENT_NAMES);
export type ClientAnalyticsEventName = z.infer<typeof clientAnalyticsEventNameSchema>;

const analyticsIdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]{16,80}$/);
const analyticsLabelSchema = z.string().trim().min(1).max(64);

export const clientAnalyticsEventSchema = z.object({
  eventId: analyticsIdentifierSchema,
  anonymousId: analyticsIdentifierSchema,
  sessionId: analyticsIdentifierSchema,
  surface: z.enum(["web", "ios"]),
  name: clientAnalyticsEventNameSchema,
  path: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/, "Path must not include a query or fragment")
    .optional(),
  outcome: z
    .enum(["granted", "denied", "undetermined", "registered", "failed", "cancelled", "success"])
    .optional(),
  properties: z
    .object({
      referrerHost: analyticsLabelSchema.optional(),
      source: analyticsLabelSchema.optional(),
      medium: analyticsLabelSchema.optional(),
      campaign: analyticsLabelSchema.optional(),
      content: analyticsLabelSchema.optional(),
      term: analyticsLabelSchema.optional(),
      destinationHost: analyticsLabelSchema.optional(),
      provider: z.enum(["apple", "google"]).optional(),
      appVersion: analyticsLabelSchema.optional(),
      appBuild: analyticsLabelSchema.optional(),
      permission: z.enum(["granted", "denied", "undetermined"]).optional(),
    })
    .strict()
    .optional(),
});
export type ClientAnalyticsEventInput = z.infer<typeof clientAnalyticsEventSchema>;

export const appleNativeTokenExchangeSchema = z.object({
  authorizationCode: z.string().min(1).max(4096),
  identityToken: z.string().min(1).max(8192),
});
export type AppleNativeTokenExchangeInput = z.infer<typeof appleNativeTokenExchangeSchema>;

export interface DeviceDto {
  id: string;
  platform: "ios";
  deviceName: string | null;
  active: boolean;
  liveActivitiesCapable: boolean;
  liveActivityTokenEnvironment: "sandbox" | "production" | null;
  liveActivityTokenUpdatedAt: string | null;
  interactiveLiveActivitiesCapable: boolean;
  createdAt: string;
  lastSeenAt: string;
}

// ---------------------------------------------------------------------------
// Live Activities
// ---------------------------------------------------------------------------

export const LIVE_ACTIVITY_SCHEMA_VERSION = 1 as const;
export const LIVE_ACTIVITY_NAME = "HarkAgentActivity" as const;
export const LIVE_ACTIVITY_SYMBOLS = ["terminal", "code", "build", "success", "warning"] as const;
export const liveActivitySymbolSchema = z.enum(LIVE_ACTIVITY_SYMBOLS);
export type LiveActivitySymbol = z.infer<typeof liveActivitySymbolSchema>;
export const LIVE_ACTIVITY_PRIVACY_MODES = ["standard", "private"] as const;
export const liveActivityPrivacyModeSchema = z.enum(LIVE_ACTIVITY_PRIVACY_MODES);
export type LiveActivityPrivacyMode = z.infer<typeof liveActivityPrivacyModeSchema>;
/**
 * Widget layout variants. `style` stays optional in the props payload so
 * payloads written before the field existed keep validating, and app builds
 * that predate a value render their standard layout.
 */
export const LIVE_ACTIVITY_STYLES = [
  "standard",
  "ring",
  "hero",
  "terminal",
  "steps",
  "approval",
  "shell",
  "verdict",
  "signal",
] as const;
export const liveActivityStyleSchema = z.enum(LIVE_ACTIVITY_STYLES);
export type LiveActivityStyle = z.infer<typeof liveActivityStyleSchema>;
export const INTERACTIVE_LIVE_ACTIVITY_STYLES = ["approval", "shell", "verdict", "signal"] as const;
export const interactiveLiveActivityStyleSchema = z.enum(INTERACTIVE_LIVE_ACTIVITY_STYLES);
export type InteractiveLiveActivityStyle = z.infer<typeof interactiveLiveActivityStyleSchema>;
export const LIVE_ACTIVITY_DEFAULT_ACCENT_COLOR = "#5ED8B7" as const;
export const LIVE_ACTIVITY_DEFAULT_EXPIRES_IN_SECONDS = 28_800 as const;
export const LIVE_ACTIVITY_DEFAULT_STALE_AFTER_SECONDS = 14_400 as const;
export const liveActivityAccentColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Accent color must use #RRGGBB format");

export const liveActivityInteractionSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    kind: z.enum(["approval", "yes_no"]),
    prompt: z.string().trim().min(1).max(2000),
    primaryLabel: z.string().trim().min(1).max(24),
    secondaryLabel: z.string().trim().min(1).max(24),
    primaryAction: z.enum(["approve", "yes"]),
    secondaryAction: z.enum(["deny", "no"]),
    state: z.enum(["pending", "approved", "denied", "yes", "no", "expired", "canceled"]),
  })
  .superRefine((value, context) => {
    const valid =
      (value.kind === "approval" &&
        value.primaryAction === "approve" &&
        value.secondaryAction === "deny") ||
      (value.kind === "yes_no" && value.primaryAction === "yes" && value.secondaryAction === "no");
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["primaryAction"],
        message: "Interaction actions must match the interaction kind",
      });
    }
  });
export type LiveActivityInteraction = z.infer<typeof liveActivityInteractionSchema>;

export const liveActivityPropsSchema = z
  .object({
    schemaVersion: z.literal(LIVE_ACTIVITY_SCHEMA_VERSION),
    activityId: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(80),
    status: z.string().trim().min(1).max(60),
    detail: z.string().trim().min(1).max(240).optional(),
    progress: z.number().min(0).max(1).optional(),
    updatedAt: z.iso.datetime(),
    symbol: liveActivitySymbolSchema,
    privacyMode: liveActivityPrivacyModeSchema,
    accentColor: liveActivityAccentColorSchema.optional(),
    style: liveActivityStyleSchema.optional(),
    interaction: liveActivityInteractionSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.style === "approval" ||
        value.style === "shell" ||
        value.style === "verdict" ||
        value.style === "signal") &&
      !value.interaction
    ) {
      context.addIssue({
        code: "custom",
        path: ["interaction"],
        message: "Interactive Live Activity styles require an interaction",
      });
    }
  });
export type LiveActivityProps = z.infer<typeof liveActivityPropsSchema>;

const deviceIdsSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .max(50)
  .transform((ids) => [...new Set(ids)].sort())
  .optional();

export const liveActivityStartSchema = z
  .object({
    key: z.string().trim().min(1).max(100).optional(),
    /** End any Live Activity currently occupying a target device before starting. */
    replace: z.boolean().default(false),
    title: z.string().trim().min(1, "Title is required").max(80),
    status: z.string().trim().min(1, "Status is required").max(60),
    detail: z.string().trim().min(1).max(240).optional(),
    progress: z.number().min(0).max(1).optional(),
    symbol: liveActivitySymbolSchema.default("terminal"),
    privacyMode: liveActivityPrivacyModeSchema.default("standard"),
    accentColor: liveActivityAccentColorSchema.default(LIVE_ACTIVITY_DEFAULT_ACCENT_COLOR),
    style: liveActivityStyleSchema.default("standard"),
    deviceIds: deviceIdsSchema,
    expiresInSeconds: z
      .number()
      .int()
      .min(60)
      .max(28_800)
      .default(LIVE_ACTIVITY_DEFAULT_EXPIRES_IN_SECONDS),
    staleAfterSeconds: z
      .number()
      .int()
      .min(0)
      .max(28_800)
      .default(LIVE_ACTIVITY_DEFAULT_STALE_AFTER_SECONDS),
  })
  .superRefine((value, context) => {
    if (
      value.style === "approval" ||
      value.style === "shell" ||
      value.style === "verdict" ||
      value.style === "signal"
    ) {
      context.addIssue({
        code: "custom",
        path: ["style"],
        message: "Use an interaction with live_activity presentation for interactive styles",
      });
    }
  });
export type LiveActivityStartInput = z.infer<typeof liveActivityStartSchema>;

export const liveActivityUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    status: z.string().trim().min(1).max(60).optional(),
    detail: z.string().trim().min(1).max(240).nullable().optional(),
    progress: z.number().min(0).max(1).nullable().optional(),
    symbol: liveActivitySymbolSchema.optional(),
    privacyMode: liveActivityPrivacyModeSchema.optional(),
    accentColor: liveActivityAccentColorSchema.optional(),
    style: liveActivityStyleSchema.optional(),
    staleAfterSeconds: z.number().int().min(0).max(28_800).optional(),
    ifSequence: z.number().int().nonnegative().optional(),
  })
  .refine(
    (input) => Object.keys(input).some((key) => key !== "ifSequence"),
    "At least one activity field is required",
  )
  .superRefine((value, context) => {
    if (
      value.style === "approval" ||
      value.style === "shell" ||
      value.style === "verdict" ||
      value.style === "signal"
    ) {
      context.addIssue({
        code: "custom",
        path: ["style"],
        message: "Interactive styles are managed by interactive Live Activity requests",
      });
    }
  });
export type LiveActivityUpdateInput = z.infer<typeof liveActivityUpdateSchema>;

export const liveActivityEndSchema = z.object({
  status: z.string().trim().min(1).max(60).default("Complete"),
  detail: z.string().trim().min(1).max(240).nullable().optional(),
  progress: z.number().min(0).max(1).nullable().optional(),
  symbol: liveActivitySymbolSchema.default("success"),
  accentColor: liveActivityAccentColorSchema.optional(),
  dismissAfterSeconds: z.number().int().min(0).max(14_400).default(0),
  ifSequence: z.number().int().nonnegative().optional(),
});
export type LiveActivityEndInput = z.infer<typeof liveActivityEndSchema>;

export const apnsEnvironmentSchema = z.enum(["sandbox", "production"]);
export type ApnsEnvironment = z.infer<typeof apnsEnvironmentSchema>;

export const liveActivityPushToStartTokenSchema = z.object({
  deviceId: z.string().trim().min(1).max(100),
  pushToStartToken: z.string().regex(/^[a-fA-F0-9]{32,512}$/),
  environment: apnsEnvironmentSchema,
  schemaVersion: z.literal(LIVE_ACTIVITY_SCHEMA_VERSION),
});
export type LiveActivityPushToStartTokenInput = z.infer<typeof liveActivityPushToStartTokenSchema>;

export const liveActivityUpdateTokenSchema = z.object({
  deviceId: z.string().trim().min(1).max(100),
  updateToken: z.string().regex(/^[a-fA-F0-9]{32,512}$/),
  nativeActivityId: z.string().trim().min(1).max(200).optional(),
  activityId: z.string().trim().min(1).max(100).optional(),
  environment: apnsEnvironmentSchema,
  schemaVersion: z.literal(LIVE_ACTIVITY_SCHEMA_VERSION),
});
export type LiveActivityUpdateTokenInput = z.infer<typeof liveActivityUpdateTokenSchema>;

export const liveActivityBackgroundTokenSchema = z.object({
  deliveryId: z.string().trim().min(1).max(100),
  registrationToken: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
  nativeActivityId: z.string().trim().min(1).max(200),
  updateToken: z.string().regex(/^[a-fA-F0-9]{32,512}$/),
});
export type LiveActivityBackgroundTokenInput = z.infer<typeof liveActivityBackgroundTokenSchema>;

export const LIVE_ACTIVITY_STATUSES = [
  "starting",
  "active",
  "partial",
  "failed",
  "ended",
  "expired",
] as const;
export type LiveActivityStatus = (typeof LIVE_ACTIVITY_STATUSES)[number];

export interface LiveActivityDto {
  id: string;
  key: string | null;
  props: LiveActivityProps;
  status: LiveActivityStatus;
  sequence: number;
  accepted: number;
  failed: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface InboxLiveActivityDto extends LiveActivityDto {
  sourceName: string;
  sourceImageUrl: string | null;
}

export interface LiveActivityMutationResponse {
  activity: LiveActivityDto;
  accepted: number;
  failed: number;
  /** Distinct blocking activities ended because the start requested `replace`. */
  replaced?: number;
  idempotent?: boolean;
  message?: string;
}

export type LiveActivityWebhookResponse =
  | {
      ok: true;
      activityId: string;
      sequence: number;
      status: LiveActivityStatus;
      accepted: number;
      failed: number;
      state: LiveActivityProps;
      expiresAt: string;
      staleAt: string | null;
      endedAt: string | null;
      /** Distinct blocking activities ended because the start requested `replace`. */
      replaced?: number;
      idempotent?: boolean;
      message?: string;
    }
  | {
      ok: false;
      error: string;
      code?: "ACTIVE_ACTIVITY_CONFLICT";
      activityId?: string;
      issues?: unknown;
      retryAfterSeconds?: number;
    };

// ---------------------------------------------------------------------------
// Agent access and interactions
// ---------------------------------------------------------------------------

export const API_TOKEN_SCOPES = [
  "notifications:send",
  "interactions:create",
  "interactions:read",
  "activities:read",
  "activities:write",
  "services:read",
  "services:write",
  "devices:read",
  "events:read",
] as const;
export const apiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);
export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>;

export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  scopes: z.array(apiTokenScopeSchema).min(1).max(API_TOKEN_SCOPES.length),
  expiresAt: z.iso.datetime().nullable().optional(),
});
export type ApiTokenCreateInput = z.infer<typeof apiTokenCreateSchema>;

export interface ApiTokenDto {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface ApiTokenCreatedResponse {
  token: ApiTokenDto;
  /** Plaintext secret. It is returned once and is never persisted by Hark. */
  secret: string;
}

export const deviceAuthorizationStartSchema = z.object({
  clientName: z.string().trim().min(1, "Client name is required").max(80),
  scopes: z
    .array(apiTokenScopeSchema)
    .min(1)
    .max(API_TOKEN_SCOPES.length)
    .transform((scopes) => [...new Set(scopes)].sort()),
  expiresInSeconds: z.number().int().min(3600).max(31_536_000).default(7_776_000),
});
export type DeviceAuthorizationStartInput = z.infer<typeof deviceAuthorizationStartSchema>;

export interface DeviceAuthorizationStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceAuthorizationRequestDto {
  clientName: string;
  scopes: ApiTokenScope[];
  status: "pending" | "approved" | "denied" | "expired" | "consumed";
  userCode: string;
  expiresAt: string;
  tokenExpiresAt: string;
}

export interface DeviceAuthorizationTokenResponse {
  accessToken: string;
  token: ApiTokenDto;
}

export const INTERACTION_KINDS = ["approval", "yes_no", "reply"] as const;
export const interactionKindSchema = z.enum(INTERACTION_KINDS);
export type InteractionKind = z.infer<typeof interactionKindSchema>;

export const INTERACTION_STATUSES = [
  "pending",
  "approved",
  "denied",
  "yes",
  "no",
  "replied",
  "canceled",
  "expired",
] as const;
export const interactionStatusSchema = z.enum(INTERACTION_STATUSES);
export type InteractionStatus = z.infer<typeof interactionStatusSchema>;
export const INTERACTION_PRESENTATIONS = ["notification", "live_activity"] as const;
export const interactionPresentationSchema = z.enum(INTERACTION_PRESENTATIONS);
export type InteractionPresentation = z.infer<typeof interactionPresentationSchema>;

export const HARK_APPROVAL_CATEGORY_ID = "HARK_APPROVAL_V1" as const;
export const HARK_REPLY_CATEGORY_ID = "HARK_REPLY_V1" as const;
export const HARK_YES_NO_CATEGORY_ID = "HARK_YES_NO_V1" as const;
export const HARK_APPROVE_ACTION_ID = "HARK_APPROVE" as const;
export const HARK_DENY_ACTION_ID = "HARK_DENY" as const;
export const HARK_REPLY_ACTION_ID = "HARK_REPLY" as const;
export const HARK_YES_ACTION_ID = "HARK_YES" as const;
export const HARK_NO_ACTION_ID = "HARK_NO" as const;

const interactionActionLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .refine(
    (value) =>
      Array.from(value).every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    "Action labels must be a single line",
  );

export const interactionCreateSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(80),
    prompt: z.string().trim().min(1, "Prompt is required").max(2000),
    kind: interactionKindSchema,
    imageUrl: publicHttpsUrlSchema.optional(),
    url: webUrlSchema.optional(),
    deviceIds: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(50)
      .transform((ids) => [...new Set(ids)].sort())
      .optional(),
    expiresInSeconds: z.number().int().min(30).max(86_400).default(900),
    presentation: interactionPresentationSchema.optional(),
    style: interactiveLiveActivityStyleSchema.optional(),
    primaryLabel: interactionActionLabelSchema.optional(),
    secondaryLabel: interactionActionLabelSchema.optional(),
  })
  .superRefine((value, context) => {
    const presentation = value.presentation ?? "notification";
    if (presentation === "live_activity" && value.kind === "reply") {
      context.addIssue({
        code: "custom",
        path: ["kind"],
        message: "Live Activity interactions support approval or yes_no responses",
      });
    }
    if (presentation === "live_activity" && value.expiresInSeconds > 28_800) {
      context.addIssue({
        code: "custom",
        path: ["expiresInSeconds"],
        message: "Live Activity interactions expire within 8 hours",
      });
    }
    if (presentation === "live_activity" && value.prompt.length > 240) {
      context.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "Live Activity interaction prompts are limited to 240 characters",
      });
    }
    if (
      presentation === "live_activity" &&
      (value.imageUrl !== undefined || value.url !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: [value.imageUrl !== undefined ? "imageUrl" : "url"],
        message: "Live Activity interactions do not support imageUrl or url",
      });
    }
    if (
      presentation !== "live_activity" &&
      (value.primaryLabel !== undefined || value.secondaryLabel !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["presentation"],
        message: "Custom action labels require live_activity presentation",
      });
    }
    if (presentation !== "live_activity" && value.style !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["style"],
        message: "Interactive Live Activity styles require live_activity presentation",
      });
    }
  });
export type InteractionCreateInput = z.infer<typeof interactionCreateSchema>;

export const interactionResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["approve", "deny"]),
    deviceId: z.string().trim().min(1).max(100),
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    action: z.enum(["yes", "no"]),
    deviceId: z.string().trim().min(1).max(100),
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    action: z.literal("reply"),
    response: z.string().trim().min(1, "Reply is required").max(4000),
    deviceId: z.string().trim().min(1).max(100),
    actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);
export type InteractionResponseInput = z.infer<typeof interactionResponseSchema>;

export const interactionCredentialResponseSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["approve", "deny", "yes", "no"]),
    deviceId: z.string().trim().min(1).max(100),
    responseToken: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
  }),
  z.object({
    action: z.literal("reply"),
    response: z.string().trim().min(1).max(4000),
    deviceId: z.string().trim().min(1).max(100),
    responseToken: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
  }),
]);
export type InteractionCredentialResponseInput = z.infer<
  typeof interactionCredentialResponseSchema
>;

export const liveActivityInteractionResponseSchema = z.object({
  action: z.enum(["approve", "deny", "yes", "no"]),
  deviceId: z.string().trim().min(1).max(100),
  deliveryId: z.string().trim().min(1).max(100),
  credential: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
});
export type LiveActivityInteractionResponseInput = z.infer<
  typeof liveActivityInteractionResponseSchema
>;

export interface InteractionDto {
  id: string;
  title: string;
  prompt: string;
  kind: InteractionKind;
  presentation: InteractionPresentation;
  status: InteractionStatus;
  choices: string[];
  response: string | null;
  imageUrl: string | null;
  url: string | null;
  actionDigest: string;
  primaryLabel: string | null;
  secondaryLabel: string | null;
  accepted: number;
  respondingDeviceId: string | null;
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
  canceledAt: string | null;
}

export interface InboxInteractionDto extends InteractionDto {
  sourceName: string;
  sourceImageUrl: string | null;
}

export const INBOX_ACTIVITY_KINDS = ["notification", "live_activity", "response"] as const;
export type InboxActivityKind = (typeof INBOX_ACTIVITY_KINDS)[number];

export interface InboxActivityDto {
  id: string;
  kind: InboxActivityKind;
  sourceName: string;
  sourceImageUrl: string | null;
  title: string;
  detail: string | null;
  url: string | null;
  result: string | null;
  createdAt: string;
}

export interface InboxActivityPageDto {
  items: InboxActivityDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface InteractionCreateResponse {
  interaction: InteractionDto;
  /** Requests accepted by Expo or APNs, depending on presentation; not proof of device display. */
  accepted: number;
  idempotent?: boolean;
  liveActivityId?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Agent notifications (one-shot pushes sent with an API token)
// ---------------------------------------------------------------------------

export const agentNotificationCreateSchema = z.object({
  body: z.string().trim().min(1, "body is required").max(2000),
  title: z.string().trim().min(1).max(80).default("Hark"),
  imageUrl: publicHttpsUrlSchema.optional(),
  url: webUrlSchema.optional(),
  deviceIds: z
    .array(z.string().trim().min(1).max(100))
    .min(1)
    .max(50)
    .transform((ids) => [...new Set(ids)].sort())
    .optional(),
});
export type AgentNotificationCreateInput = z.infer<typeof agentNotificationCreateSchema>;

export interface AgentNotificationDto {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  url: string | null;
  createdAt: string;
}

export interface AgentNotificationCreateResponse {
  notification: AgentNotificationDto;
  /** Number of notification requests accepted by Expo, not proof of device delivery. */
  accepted: number;
  idempotent?: boolean;
  message?: string;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export interface BillingDto {
  configured: boolean;
  plan: "free" | "pro";
  priceMonthly: number;
  features: {
    deviceRouting: boolean;
  };
  limits: {
    devices: number | null;
    notificationsPerMonth: number;
    servicePerMinute: number;
    accountPerMinute: number;
  };
  usage: {
    notificationsRemaining: number | null;
  };
}

export interface BillingRedirectResponse {
  url: string;
}

/** One purchasable plan, as shown on the public pricing page. */
export interface PricingPlanDto {
  id: string;
  name: string;
  description: string | null;
  /** USD per month; 0 for the free plan. */
  priceMonthly: number;
  /** null means unlimited. */
  notificationsPerMonth: number | null;
  /** null means unlimited. */
  devices: number | null;
  deviceRouting: boolean;
  servicePerMinute: number;
  accountPerMinute: number;
}

export interface PricingPlansDto {
  /** Whether the plans were loaded live from the billing provider. */
  source: "autumn" | "static";
  plans: PricingPlanDto[];
}

// ---------------------------------------------------------------------------
// Push data payload (delivered to the iOS app + notification service extension)
// ---------------------------------------------------------------------------

export const webhookPushDataSchema = z.object({
  v: z.literal(PUSH_SCHEMA_VERSION),
  eventId: z.string(),
  serviceId: z.string(),
  /** Alias of serviceId kept for forwards compatibility with multi-source plans. */
  sourceId: z.string(),
  /** Display name shown as the notification sender. */
  sourceName: z.string(),
  avatarUrl: z.url().optional(),
  /** Destination URL to open when the notification is tapped. */
  url: z.url().optional(),
  conversationId: z.string(),
});
export const interactionPushDataSchema = z.object({
  v: z.literal(PUSH_SCHEMA_VERSION),
  interactionId: z.string(),
  eventId: z.string().optional(),
  interactionKind: interactionKindSchema,
  sourceName: z.string(),
  conversationId: z.string(),
  categoryId: z.enum([HARK_APPROVAL_CATEGORY_ID, HARK_YES_NO_CATEGORY_ID, HARK_REPLY_CATEGORY_ID]),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/),
  responseToken: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{43}$/)
    .optional(),
  avatarUrl: z.url().optional(),
  url: z.url().optional(),
});
export const pushDataSchema = z.union([webhookPushDataSchema, interactionPushDataSchema]);
export type PushData = z.infer<typeof pushDataSchema>;
export type InteractionPushData = z.infer<typeof interactionPushDataSchema>;

// ---------------------------------------------------------------------------
// Generic API envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  issues?: unknown;
}
