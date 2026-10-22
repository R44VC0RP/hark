import type { LookupAddress } from "node:dns";
import dns from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "../db";
import { interaction } from "../db/schema";
import { decryptCallbackToken } from "./token";

const RETRY_DELAYS_MS = [0, 30_000, 120_000, 600_000, 3_600_000] as const;
let running: Promise<void> | null = null;

/**
 * Addresses a callback must never reach, whatever its hostname resolves to.
 * Separate lists: a BlockList matches IPv4 addresses against IPv4-mapped
 * IPv6 rules, so one list blocking ::ffff:0:0/96 would block every IPv4 host.
 */
const blockedIpv4 = new BlockList();
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  // Unspecified, loopback, IPv4-compatible and IPv4-mapped (::ffff:0:0/96).
  ["::", 80],
  ["::ffff:0:0", 96],
  // NAT64 well-known and local-use prefixes translate to IPv4 hosts.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

class UnsafeCallbackError extends Error {}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? blockedIpv6.check(address, "ipv6") : blockedIpv4.check(address, "ipv4");
}

/**
 * Resolves the callback host once and refuses it when any address is
 * non-public, so a DNS name cannot point the worker at loopback or the
 * metadata service. The returned address is the one the request connects to.
 */
async function resolvePublicAddress(hostname: string): Promise<LookupAddress> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family
    ? [{ address: host, family }]
    : await dns.lookup(host, { all: true, verbatim: true });
  const [first] = addresses;
  if (!first || addresses.some(({ address, family }) => isBlockedAddress(address, family))) {
    throw new UnsafeCallbackError("Callback host resolves to a non-public address");
  }
  return first;
}

/** POSTs to the callback over HTTPS pinned to the vetted address; never follows redirects. */
async function postCallback(
  callbackUrl: string,
  headers: Record<string, string>,
  body: string,
): Promise<number> {
  const url = new URL(callbackUrl);
  if (url.protocol !== "https:") throw new UnsafeCallbackError("Callback URL must use HTTPS");
  const pinned = await resolvePublicAddress(url.hostname);
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        lookup,
        signal: AbortSignal.timeout(10_000),
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

export function deliverInteractionCallbacks(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const now = new Date();
    const rows = await db
      .select()
      .from(interaction)
      .where(
        and(
          inArray(interaction.status, ["approved", "denied", "yes", "no", "replied"]),
          inArray(interaction.callbackStatus, ["pending", "retrying"]),
          isNotNull(interaction.callbackUrl),
          isNotNull(interaction.callbackTokenCiphertext),
          lte(interaction.callbackNextAttemptAt, now),
        ),
      )
      .limit(20);

    for (const row of rows) {
      const attempt = row.callbackAttempts + 1;
      try {
        const status = await postCallback(
          row.callbackUrl as string,
          {
            authorization: `Bearer ${decryptCallbackToken(row.callbackTokenCiphertext as string)}`,
            "content-type": "application/json",
            "user-agent": "Hark-Callbacks/1",
          },
          JSON.stringify({
            type: "notification.response",
            eventId: row.eventId,
            correlationId: row.correlationId,
            kind: row.kind,
            status: row.status,
            action: row.kind === "reply" ? "reply" : row.response,
            text: row.kind === "reply" ? row.response : null,
            respondedAt: row.respondedAt?.toISOString() ?? null,
          }),
        );
        if (status >= 200 && status < 300) {
          await db
            .update(interaction)
            .set({
              callbackStatus: "delivered",
              callbackAttempts: attempt,
              callbackDeliveredAt: new Date(),
              callbackLastError: null,
              callbackNextAttemptAt: null,
            })
            .where(eq(interaction.id, row.id));
          continue;
        }
        throw new Error(`HTTP ${status}`);
      } catch (error) {
        // A host that resolves to a non-public address fails for good.
        const delay = error instanceof UnsafeCallbackError ? undefined : RETRY_DELAYS_MS[attempt];
        await db
          .update(interaction)
          .set({
            callbackStatus: delay === undefined ? "failed" : "retrying",
            callbackAttempts: attempt,
            callbackLastError: error instanceof Error ? error.message.slice(0, 200) : "Failed",
            callbackNextAttemptAt: delay === undefined ? null : new Date(Date.now() + delay),
          })
          .where(eq(interaction.id, row.id));
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export function startInteractionCallbackWorker(): () => void {
  void deliverInteractionCallbacks();
  const timer = setInterval(() => void deliverInteractionCallbacks(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
