import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Alert, Platform } from "react-native";
import { trackAppEvent, trackOnboardingCompleted } from "./analytics";
import { api } from "./api";
import { authClient } from "./auth";
import { readCriticalAlertState } from "./critical-alerts";
import { haptic } from "./haptics";
import {
  clearInteractionResponses,
  DEVICE_ID_KEY,
  flushInteractionResponses,
  registerInteractionCategories,
} from "./interactions";
import { deviceNoun, isPad } from "./layout";
import { refreshLiveActivityTokenSync } from "./live-activities";
import { leaveAppTo } from "./navigation";
import { clearAllWebsiteData } from "./website-data";

/**
 * Sign out and delete account (DESIGN.md 5.15), shared by Set Up and
 * Settings. Both ask first, unregister this device's push token, clear what
 * the device stored for the account and leave the signed-in app for Sign In.
 */

/** This device's Expo push token, stored by Set Up when it registers. */
export const EXPO_TOKEN_KEY = "hark.device.expoPushToken";
/** This device's APNs token, when iOS gave one. */
export const APNS_TOKEN_KEY = "hark.device.apnsToken";

/**
 * Registers this device for pushes (or refreshes its registration): push
 * tokens, notification actions and Critical Alerts state, then stores what
 * the server returned. Set Up runs it from its Register button; a launch of
 * a set-up device runs it in the background. Throws when it fails.
 */
export async function registerThisDevice(): Promise<void> {
  void trackAppEvent("device_registration_started", { path: "/home" });
  try {
    if (!Device.isDevice) {
      throw new Error(`Push notifications require a physical ${deviceNoun}.`);
    }
    const projectId =
      (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    const expoToken = (
      await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    ).data;

    let apns: string | null = null;
    try {
      const nativeToken = await Notifications.getDevicePushTokenAsync();
      apns = typeof nativeToken.data === "string" ? nativeToken.data : null;
    } catch {
      // APNs token is optional; delivery uses the Expo push token.
    }

    await registerInteractionCategories();
    const criticalAlerts = await readCriticalAlertState().catch(() => undefined);
    const registered = await api.registerDevice({
      expoPushToken: expoToken,
      ...(apns ? { apnsToken: apns } : {}),
      platform: "ios",
      deviceName: Device.deviceName ?? undefined,
      interactionSchemaVersion: 1,
      ...(!isPad && Number.parseFloat(String(Platform.Version)) >= 17
        ? { liveActivityInteractionVersion: 1 as const }
        : {}),
      ...(criticalAlerts ? { criticalAlerts } : {}),
    });

    await SecureStore.setItemAsync(EXPO_TOKEN_KEY, expoToken);
    await SecureStore.setItemAsync(DEVICE_ID_KEY, registered.device.id);
    if (apns) {
      await SecureStore.setItemAsync(APNS_TOKEN_KEY, apns);
    } else {
      await SecureStore.deleteItemAsync(APNS_TOKEN_KEY);
    }

    void trackAppEvent("device_registration_completed", {
      path: "/home",
      outcome: "registered",
    });
    void trackOnboardingCompleted();
    void flushInteractionResponses();
    refreshLiveActivityTokenSync(registered.device.id);
  } catch (error) {
    void trackAppEvent("device_registration_completed", { path: "/home", outcome: "failed" });
    throw error;
  }
}

/**
 * True when this device finished Set Up: it is registered and may show
 * notifications. A signed-in launch then opens the Inbox directly.
 */
export async function isDeviceSetUp(): Promise<boolean> {
  const [deviceId, expoToken, permission] = await Promise.all([
    SecureStore.getItemAsync(DEVICE_ID_KEY),
    SecureStore.getItemAsync(EXPO_TOKEN_KEY),
    Notifications.getPermissionsAsync(),
  ]);
  return Boolean(deviceId && expoToken) && permission.granted;
}

async function unregisterPushToken(): Promise<void> {
  const expoPushToken = await SecureStore.getItemAsync(EXPO_TOKEN_KEY);
  if (expoPushToken) await api.unregisterDevice({ expoPushToken });
}

/** Forgets the device registration, queued responses, badge and web-app sessions. */
async function clearDevice(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(EXPO_TOKEN_KEY),
    SecureStore.deleteItemAsync(APNS_TOKEN_KEY),
    SecureStore.deleteItemAsync(DEVICE_ID_KEY),
    clearInteractionResponses(),
    Notifications.setBadgeCountAsync(0).catch(() => {}),
    clearAllWebsiteData(),
  ]);
}

async function signOut(): Promise<void> {
  try {
    await unregisterPushToken();
  } catch {
    // Best effort: the server also deactivates stale tokens.
  }
  await clearDevice();
  await authClient.signOut().catch(() => {});
  leaveAppTo("/");
}

async function deleteAccount(): Promise<void> {
  try {
    await unregisterPushToken();
    const result = await authClient.deleteUser();
    if (result.error) {
      throw new Error(result.error.message ?? "Account deletion was not completed.");
    }
    await clearDevice();
    leaveAppTo("/");
  } catch (error) {
    haptic.error();
    Alert.alert(
      "Couldn't Delete Account",
      error instanceof Error ? error.message : "Check your connection, then try again.",
    );
  }
}

/**
 * Asks "Sign Out?" and signs out this device. `onSigningOut` runs once the
 * person confirms, so the screen can show progress while the device is
 * unregistered (a moment on a good network).
 */
export function confirmSignOut(onSigningOut?: () => void): void {
  Alert.alert("Sign Out?", "This device will stop receiving notifications.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Sign Out",
      style: "destructive",
      onPress: () => {
        onSigningOut?.();
        void signOut();
      },
    },
  ]);
}

/** Asks "Delete Account?" and permanently deletes the account. */
export function confirmDeleteAccount(): void {
  Alert.alert(
    "Delete Account?",
    "This permanently deletes your services, activity history and registered devices. This can't be undone.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Delete Account", style: "destructive", onPress: () => void deleteAccount() },
    ],
  );
}
