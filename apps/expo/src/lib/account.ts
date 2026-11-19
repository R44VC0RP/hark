import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Alert } from "react-native";
import { api } from "./api";
import { authClient } from "./auth";
import { haptic } from "./haptics";
import { clearInteractionResponses, DEVICE_ID_KEY } from "./interactions";
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

/** Asks "Sign Out?" and signs out this device. */
export function confirmSignOut(): void {
  Alert.alert("Sign Out?", "This device will stop receiving notifications.", [
    { text: "Cancel", style: "cancel" },
    { text: "Sign Out", style: "destructive", onPress: () => void signOut() },
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
