import { z } from "zod";

const DEV_SECRET = "hark-insecure-dev-secret-change-me";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8787),
  /** SQLite file path. Production containers should point this at /data/hark.sqlite. */
  DATABASE_URL: z.string().min(1).default("./data/hark.sqlite"),
  /** Public origin the browser uses. In dev this is the Vite server, which proxies /api. */
  APP_URL: z.url().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().min(16).default(DEV_SECRET),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Sign in with Apple Services ID used by the web OAuth flow. */
  APPLE_SIGN_IN_SERVICE_ID: z.string().optional(),
  /** Native App ID / bundle identifier. This is also the native token audience. */
  APPLE_SIGN_IN_BUNDLE_ID: z.string().min(1).default("ceo.ryan.hark"),
  APPLE_SIGN_IN_KEY_ID: z.string().optional(),
  /** Sign in with Apple .p8 key. Accepts PEM text (with \n) or base64-encoded PEM. */
  APPLE_SIGN_IN_PRIVATE_KEY: z.string().optional(),
  /** Optional. Enables authenticated requests to the Expo Push Service. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Optional direct APNs credentials for Live Activity start/update/end delivery. */
  APNS_KEY_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APNS_PRIVATE_KEY: z.string().optional(),
  APNS_BUNDLE_ID: z.string().min(1).default("ceo.ryan.hark"),
  APNS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  /** Autumn production secret key. Kept server-side and never exposed to clients. */
  AUTUMN_API_KEY: z.string().optional(),
  /**
   * Comma-separated owner emails whose teams get unlimited seats without a
   * team plan (comped accounts). Matched case-insensitively against the
   * current team owner's email.
   */
  UNLIMITED_TEAM_OWNER_EMAILS: z.string().optional(),
  /**
   * Header carrying the real client IP, set (and overwritten) by a trusted edge.
   * Leave unset when the edge does not provide one: client-supplied forwarded
   * headers are spoofable and would let a caller reset its own rate-limit bucket.
   */
  /** Empty means unset, matching how compose passes absent optional values. */
  TRUSTED_CLIENT_IP_HEADER: z.string().trim().optional(),
  SERVICE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  ACCOUNT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  PRO_SERVICE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  PRO_ACCOUNT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1500),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;

/** Startup checks that warn (dev) or fail (production) without real credentials. */
export function assertRuntimeEnv(): void {
  const problems: string[] = [];
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    problems.push(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — Google sign-in will fail until configured.",
    );
  }
  if (
    !env.APPLE_SIGN_IN_SERVICE_ID ||
    !env.APPLE_TEAM_ID ||
    !env.APPLE_SIGN_IN_KEY_ID ||
    !env.APPLE_SIGN_IN_PRIVATE_KEY
  ) {
    problems.push(
      "APPLE_SIGN_IN_SERVICE_ID / APPLE_SIGN_IN_BUNDLE_ID / APPLE_TEAM_ID / APPLE_SIGN_IN_KEY_ID / APPLE_SIGN_IN_PRIVATE_KEY are not all set — Sign in with Apple will fail until configured.",
    );
  }
  if (env.BETTER_AUTH_SECRET === DEV_SECRET) {
    problems.push("BETTER_AUTH_SECRET is using the insecure development default.");
  }
  if (!env.EXPO_ACCESS_TOKEN) {
    problems.push("EXPO_ACCESS_TOKEN is not set — push requests to Expo will be unauthenticated.");
  }
  if (!env.APNS_KEY_ID || !env.APPLE_TEAM_ID || !env.APNS_PRIVATE_KEY) {
    problems.push(
      "APNS_KEY_ID / APPLE_TEAM_ID / APNS_PRIVATE_KEY are not all set — Live Activity delivery will be unavailable.",
    );
  }
  if (!env.AUTUMN_API_KEY) {
    problems.push("AUTUMN_API_KEY is not set — paid plans and checkout will be unavailable.");
  }

  if (env.NODE_ENV === "production" && !env.TRUSTED_CLIENT_IP_HEADER) {
    problems.push(
      "TRUSTED_CLIENT_IP_HEADER is not set — rate limits fall back to one shared bucket per endpoint. Set it to the client-IP header the edge overwrites.",
    );
  }
  if (env.NODE_ENV === "production" && new URL(env.APP_URL).protocol !== "https:") {
    problems.push("APP_URL is not https — production must be served over TLS.");
  }

  if (env.NODE_ENV === "production" && env.BETTER_AUTH_SECRET === DEV_SECRET) {
    console.error("Refusing to start in production with the default BETTER_AUTH_SECRET.");
    process.exit(1);
  }

  for (const p of problems) {
    console.warn(`[env] ${p}`);
  }
}
