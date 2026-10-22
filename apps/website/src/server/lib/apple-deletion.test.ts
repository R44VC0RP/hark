import { exportPKCS8, generateKeyPair } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.APPLE_TEAM_ID = "TEAM123";
process.env.APPLE_SIGN_IN_KEY_ID = "KEY123";
process.env.APPLE_SIGN_IN_SERVICE_ID = "ceo.ryan.hark.web";
process.env.APPLE_SIGN_IN_BUNDLE_ID = "ceo.ryan.hark";

let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let revokeAppleGrantsForUser: typeof import("./apple")["revokeAppleGrantsForUser"];

beforeAll(async () => {
  const keys = await generateKeyPair("ES256", { extractable: true });
  process.env.APPLE_SIGN_IN_PRIVATE_KEY = await exportPKCS8(keys.privateKey);
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ revokeAppleGrantsForUser } = await import("./apple"));
  const { runMigrations } = await import("../db/migrate");
  runMigrations();
});

beforeEach(async () => {
  await db.delete(schema.user);
  vi.restoreAllMocks();
});

async function insertUser(id: string): Promise<void> {
  const now = new Date();
  await db.insert(schema.user).values({
    id,
    name: "Apple User",
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
}

describe("Apple account deletion revocation", () => {
  it("revokes both web and native grants with their exact client IDs", async () => {
    await insertUser("both_grants");
    const now = new Date();
    const [{ symmetricEncrypt }, { env }] = await Promise.all([
      import("better-auth/crypto"),
      import("../env"),
    ]);
    await db.insert(schema.account).values({
      id: "web_account",
      accountId: "apple-subject",
      providerId: "apple",
      userId: "both_grants",
      refreshToken: await symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: "web-refresh" }),
      createdAt: now,
      updatedAt: now,
    });
    const { encryptAppleRefreshToken } = await import("./token");
    await db.insert(schema.appleNativeGrant).values({
      id: "native_grant",
      userId: "both_grants",
      appleSubject: "apple-subject",
      clientId: "ceo.ryan.hark",
      refreshTokenCiphertext: encryptAppleRefreshToken("native-refresh"),
      authorizationCodeHash: "code-hash",
      createdAt: now,
      updatedAt: now,
    });
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await revokeAppleGrantsForUser("both_grants");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => {
      const body = init?.body;
      if (!(body instanceof URLSearchParams)) throw new Error("Expected URLSearchParams body");
      return Object.fromEntries(body.entries());
    });
    expect(bodies).toEqual([
      expect.objectContaining({
        client_id: "ceo.ryan.hark.web",
        token: "web-refresh",
        token_type_hint: "refresh_token",
      }),
      expect.objectContaining({
        client_id: "ceo.ryan.hark",
        token: "native-refresh",
        token_type_hint: "refresh_token",
      }),
    ]);
  });

  it("has nothing to revoke when an Apple account has no stored token", async () => {
    await insertUser("missing_grant");
    const now = new Date();
    await db.insert(schema.account).values({
      id: "missing_account",
      accountId: "missing-subject",
      providerId: "apple",
      userId: "missing_grant",
      createdAt: now,
      updatedAt: now,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(revokeAppleGrantsForUser("missing_grant")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an Apple invalid_grant as already revoked", async () => {
    await insertUser("gone_grant");
    const now = new Date();
    await db.insert(schema.account).values({
      id: "gone_account",
      accountId: "gone-subject",
      providerId: "apple",
      userId: "gone_grant",
      refreshToken: "gone-refresh",
      createdAt: now,
      updatedAt: now,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })),
    );

    await expect(revokeAppleGrantsForUser("gone_grant")).resolves.toBeUndefined();
  });

  it("propagates Apple revocation failures so Better Auth cannot delete the user", async () => {
    await insertUser("failed_revoke");
    const now = new Date();
    await db.insert(schema.account).values({
      id: "failed_account",
      accountId: "failed-subject",
      providerId: "apple",
      userId: "failed_revoke",
      refreshToken: "failed-refresh",
      createdAt: now,
      updatedAt: now,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    const { AppleRevocationError } = await import("./apple");
    await expect(revokeAppleGrantsForUser("failed_revoke")).rejects.toThrow(AppleRevocationError);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(revokeAppleGrantsForUser("failed_revoke")).rejects.toThrow(AppleRevocationError);
  });
});
