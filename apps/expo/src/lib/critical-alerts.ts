import type { CriticalAlertState } from "@hark/contracts";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { api } from "./api";
import { DEVICE_ID_KEY } from "./interactions";

const ASKED_KEY = "hark.criticalAlerts.asked";

/**
 * Whether this build carries the Critical Alerts entitlement. It is set at
 * build time by `HARK_CRITICAL_ALERTS=1` (see app.config.ts); without it the
 * app never offers the prompt and reports `unavailable`.
 */
export function criticalAlertsEnabled(): boolean {
  return (
    (Constants.expoConfig?.extra as { criticalAlerts?: unknown } | undefined)?.criticalAlerts ===
    true
  );
}

/** Maps iOS permission state to what the server stores. */
export function toCriticalAlertState(
  enabled: boolean,
  allowsCriticalAlerts: boolean | null | undefined,
  asked: boolean,
): CriticalAlertState {
  if (!enabled || allowsCriticalAlerts === null || allowsCriticalAlerts === undefined) {
    return "unavailable";
  }
  if (allowsCriticalAlerts) return "authorized";
  return asked ? "denied" : "notDetermined";
}

export async function readCriticalAlertState(): Promise<CriticalAlertState> {
  const enabled = criticalAlertsEnabled();
  if (!enabled) return "unavailable";
  const [permission, asked] = await Promise.all([
    Notifications.getPermissionsAsync(),
    SecureStore.getItemAsync(ASKED_KEY),
  ]);
  return toCriticalAlertState(enabled, permission.ios?.allowsCriticalAlerts, asked === "1");
}

/** Sends the current state to the server so page pushes pick the right sound. */
export async function reportCriticalAlertState(): Promise<CriticalAlertState> {
  const state = await readCriticalAlertState();
  const deviceId = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (deviceId) {
    await api.reportAlertSettings({ deviceId, criticalAlerts: state }).catch(() => undefined);
  }
  return state;
}

/** Shows the system Critical Alerts prompt (only when the build has the entitlement). */
export async function requestCriticalAlerts(): Promise<CriticalAlertState> {
  if (!criticalAlertsEnabled()) return "unavailable";
  await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true, allowCriticalAlerts: true },
  });
  await SecureStore.setItemAsync(ASKED_KEY, "1");
  return reportCriticalAlertState();
}

export function criticalAlertLabel(state: CriticalAlertState | null | undefined): string {
  switch (state) {
    case "authorized":
      return "On";
    case "denied":
      return "Off";
    case "notDetermined":
      return "Not set up";
    default:
      return "Not available yet";
  }
}
