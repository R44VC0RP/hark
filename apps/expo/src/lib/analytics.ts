import type { ClientAnalyticsEventInput, ClientAnalyticsEventName } from "@hark/contracts";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { API_URL, getCookie } from "./auth";

const INSTALLATION_ID_KEY = "hark.analytics.installationId";
const ONBOARDED_KEY = "hark.analytics.onboarded";
const sessionId = randomId();
let installationId: Promise<string> | undefined;
let onboardingCompletion: Promise<void> | undefined;

type Properties = NonNullable<ClientAnalyticsEventInput["properties"]>;

function randomId(): string {
  return Crypto.randomUUID().replaceAll("-", "");
}

async function getInstallationId(): Promise<string> {
  if (!installationId) {
    installationId = (async () => {
      const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
      if (existing) return existing;
      const created = randomId();
      await SecureStore.setItemAsync(INSTALLATION_ID_KEY, created);
      return created;
    })();
  }
  return installationId;
}

export async function trackAppEvent(
  name: ClientAnalyticsEventName,
  input: Pick<ClientAnalyticsEventInput, "path" | "outcome"> & { properties?: Properties } = {},
): Promise<boolean> {
  try {
    const payload: ClientAnalyticsEventInput = {
      eventId: randomId(),
      anonymousId: await getInstallationId(),
      sessionId,
      surface: "ios",
      name,
      ...input,
      properties: {
        appVersion: Constants.expoConfig?.version ?? undefined,
        appBuild: Constants.expoConfig?.ios?.buildNumber ?? undefined,
        ...input.properties,
      },
    };
    const response = await fetch(`${API_URL}/api/analytics/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(getCookie() ? { cookie: getCookie() } : {}),
      },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    // Analytics must never block product behavior or surface an error to the user.
    return false;
  }
}

export function trackOnboardingCompleted(): Promise<void> {
  if (onboardingCompletion) return onboardingCompletion;
  onboardingCompletion = (async () => {
    try {
      if (await SecureStore.getItemAsync(ONBOARDED_KEY)) return;
      const tracked = await trackAppEvent("onboarding_completed", { path: "/inbox" });
      if (tracked) await SecureStore.setItemAsync(ONBOARDED_KEY, "1");
    } catch {
      // Completion is also represented by the server-authoritative device event.
    } finally {
      onboardingCompletion = undefined;
    }
  })();
  return onboardingCompletion;
}
