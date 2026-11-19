import type { EventDto } from "@hark/contracts";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Redirect, Stack } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { type SFSymbol, SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, View } from "react-native";
import { DeliveryRow } from "../src/components/delivery-row";
import {
  APNS_TOKEN_KEY,
  confirmDeleteAccount,
  confirmSignOut,
  EXPO_TOKEN_KEY,
} from "../src/lib/account";
import { trackAppEvent, trackOnboardingCompleted } from "../src/lib/analytics";
import { api } from "../src/lib/api";
import { useSession } from "../src/lib/auth";
import { readCriticalAlertState } from "../src/lib/critical-alerts";
import {
  DEVICE_ID_KEY,
  flushInteractionResponses,
  registerInteractionCategories,
} from "../src/lib/interactions";
import { deviceNoun, isPad } from "../src/lib/layout";
import { refreshLiveActivityTokenSync } from "../src/lib/live-activities";
import { spoken } from "../src/ui/a11y";
import { Button } from "../src/ui/button";
import { Cell, List, Section, useStackedRows } from "../src/ui/list";
import { Text } from "../src/ui/text";
import { colors, metrics, space } from "../src/ui/tokens";

type PermissionState = "unknown" | "undetermined" | "granted" | "denied";
type RegistrationState = "idle" | "working" | "registered" | "error";

/** Recent Deliveries refresh while Set Up is open. */
const EVENTS_POLL_MS = 10_000;
const STEP_MIN_HEIGHT = 72;
/** How far the "Hark" wordmark grows with Dynamic Type next to its fixed dot. */
const WORDMARK_MAX_SCALE = 1.4;

function permissionState(
  result: Notifications.NotificationPermissionsStatus,
): Exclude<PermissionState, "unknown"> {
  return result.granted ? "granted" : result.canAskAgain ? "undetermined" : "denied";
}

/**
 * Set Up This iPhone (DESIGN.md 5.2), what a new account sees after Sign In:
 * allow notifications, register the device, then the Inbox. Recent
 * Deliveries below show webhooks arriving while you set up. Sign out and
 * delete account live in the More menu.
 */
export default function SetUpScreen() {
  const { data: session, isPending } = useSession();

  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [registration, setRegistration] = useState<RegistrationState>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const autoRegistrationAttempted = useRef(false);
  const eventsJson = useRef("");

  const refreshPermission = useCallback(async () => {
    setPermission(permissionState(await Notifications.getPermissionsAsync()));
  }, []);

  useEffect(() => {
    void refreshPermission();
    // Back from the Settings app ("Open Settings"), where notifications may
    // have been turned on.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshPermission();
    });
    return () => appState.remove();
  }, [refreshPermission]);

  useEffect(() => {
    void SecureStore.getItemAsync(EXPO_TOKEN_KEY)
      .then((storedExpoToken) => {
        if (storedExpoToken) setRegistration("registered");
      })
      .finally(() => setStorageHydrated(true));
  }, []);

  const requestPermission = async () => {
    void trackAppEvent("notification_permission_prompted", { path: "/home" });
    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    const state = permissionState(result);
    setPermission(state);
    void trackAppEvent("notification_permission_resolved", {
      path: "/home",
      outcome: state,
      properties: { permission: state },
    });
  };

  const registerDevice = useCallback(async (preserveReadyState = false) => {
    void trackAppEvent("device_registration_started", { path: "/home" });
    if (!preserveReadyState) setRegistration("working");
    setLastError(null);
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

      setRegistration("registered");
      void trackAppEvent("device_registration_completed", {
        path: "/home",
        outcome: "registered",
      });
      void trackOnboardingCompleted();
      void flushInteractionResponses();
      refreshLiveActivityTokenSync(registered.device.id);
    } catch (err) {
      void trackAppEvent("device_registration_completed", { path: "/home", outcome: "failed" });
      if (!preserveReadyState) {
        setRegistration("error");
        setLastError(err instanceof Error ? err.message : "Registration failed.");
      }
    }
  }, []);

  useEffect(() => {
    if (
      !storageHydrated ||
      !session ||
      permission !== "granted" ||
      autoRegistrationAttempted.current
    ) {
      return;
    }
    autoRegistrationAttempted.current = true;
    void registerDevice(registration === "registered");
  }, [storageHydrated, session, permission, registration, registerDevice]);

  const refreshEvents = useCallback(async () => {
    try {
      const activity = await api.listEvents();
      // Polling only re-renders when something changed.
      const json = JSON.stringify(activity.events);
      if (json === eventsJson.current) return;
      eventsJson.current = json;
      setEvents(activity.events);
    } catch {
      // Keep the last successful snapshot visible while offline.
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshEvents();
    const interval = setInterval(() => void refreshEvents(), EVENTS_POLL_MS);
    const received = Notifications.addNotificationReceivedListener(() => {
      void refreshEvents();
    });
    return () => {
      clearInterval(interval);
      received.remove();
    };
  }, [session, refreshEvents]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshEvents(), refreshPermission()]);
    } finally {
      setRefreshing(false);
    }
  };

  if (!isPending && !session) return <Redirect href="/" />;
  if (__DEV__ && !Device.isDevice) return <Redirect href="/inbox" />;
  if (permission === "granted" && registration === "registered") {
    return <Redirect href="/inbox" />;
  }

  const allowed = permission === "granted";
  const registered = registration === "registered";

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu accessibilityLabel="More" icon="ellipsis">
          <Stack.Toolbar.MenuAction
            icon="rectangle.portrait.and.arrow.right"
            onPress={confirmSignOut}
          >
            Sign Out
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction destructive icon="trash" onPress={confirmDeleteAccount}>
            Delete Account…
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <List onRefresh={() => void onRefresh()} reading refreshing={refreshing}>
        <View accessibilityLabel="Hark" accessible style={styles.wordmark}>
          <View style={styles.dot} />
          {/* The dot doesn't scale, so the wordmark grows only so far. */}
          <Text maxFontSizeMultiplier={WORDMARK_MAX_SCALE} variant="brandMark">
            Hark
          </Text>
        </View>
        <Text
          accessibilityRole="header"
          lineBreakStrategyIOS="standard"
          style={styles.headline}
          variant="brandDisplay"
        >
          Two steps and this {deviceNoun} starts receiving your webhooks.
        </Text>

        <Section
          footer={
            lastError ? (
              <Text
                accessibilityLiveRegion="polite"
                color="danger"
                lineBreakStrategyIOS="standard"
                variant="footnote"
              >
                {lastError}
              </Text>
            ) : undefined
          }
        >
          <StepRow
            action={
              allowed
                ? null
                : permission === "denied"
                  ? { title: "Open Settings", onPress: () => void Linking.openSettings() }
                  : { title: "Allow", onPress: () => void requestPermission() }
            }
            done={allowed}
            subtitle={
              permission === "denied"
                ? "Notifications are off. Turn them on for Hark in Settings."
                : "Hark shows each webhook as a communication notification with your service's name and avatar."
            }
            symbol="bell.badge"
            title="Allow Notifications"
          />
          <StepRow
            action={
              registered
                ? null
                : {
                    title: "Register",
                    busyTitle: "Registering…",
                    busy: registration === "working",
                    disabled: !allowed,
                    onPress: () => void registerDevice(false),
                  }
            }
            blocked={!allowed}
            done={registered}
            subtitle={
              registered
                ? "Registered and ready."
                : `Links this ${deviceNoun} to your account so your services can reach it.`
            }
            symbol={isPad ? "ipad" : "iphone"}
            title={`Register This ${deviceNoun}`}
          />
        </Section>

        <Section
          footer={
            events?.length === 0 ? "No webhooks yet. Send one and it shows up here." : undefined
          }
          title="Recent Deliveries"
        >
          {events === null ? (
            <Cell minHeight={metrics.rowMinHeightSubtitle} style={styles.loadingCell}>
              <ActivityIndicator accessibilityLabel="Loading deliveries" />
            </Cell>
          ) : (
            events.map((event) => <DeliveryRow event={event} key={event.id} />)
          )}
        </Section>
      </List>
    </>
  );
}

interface StepAction {
  title: string;
  onPress: () => void;
  busy?: boolean;
  busyTitle?: string;
  disabled?: boolean;
}

/**
 * One setup step: its symbol (a checkmark once done), what it does, and the
 * button that does it. At accessibility text sizes the button moves under
 * the text so nothing truncates.
 */
function StepRow({
  title,
  subtitle,
  symbol,
  done,
  blocked,
  action,
}: {
  title: string;
  subtitle: string;
  symbol: SFSymbol;
  done: boolean;
  /** Waiting on the step before it: its symbol is grey. */
  blocked?: boolean;
  action: StepAction | null;
}) {
  const stacked = useStackedRows();
  const symbolView = (
    <SymbolView
      name={done ? "checkmark.circle.fill" : symbol}
      size={22}
      tintColor={blocked && !done ? colors.secondaryLabel : colors.accent}
    />
  );
  const button = action ? (
    <Button
      busy={action.busy}
      busyTitle={action.busyTitle}
      disabled={action.disabled}
      onPress={action.onPress}
      style={stacked ? styles.stackedButton : null}
      title={action.title}
      variant="prominent"
    />
  ) : null;
  return (
    <Cell
      minHeight={STEP_MIN_HEIGHT}
      separatorInset={
        metrics.rowPaddingHorizontal + metrics.rowSymbolColumn + metrics.rowAccessoryGap
      }
      style={[styles.step, stacked && styles.stepStacked]}
    >
      <View style={styles.stepSymbol}>
        {stacked ? (
          // One line of the title's style, so the symbol sits on the title's
          // first line at accessibility sizes.
          <View style={styles.symbolLine}>
            <Text accessibilityElementsHidden importantForAccessibility="no" variant="headline">
              {"\u200B"}
            </Text>
            {symbolView}
          </View>
        ) : (
          symbolView
        )}
      </View>
      <View style={styles.stepCopy}>
        <View
          accessibilityLabel={spoken(title, done ? "Done" : null, subtitle)}
          accessible
          style={styles.stepText}
        >
          <Text variant="headline">{title}</Text>
          <Text color="secondaryLabel" variant="subheadline">
            {subtitle}
          </Text>
        </View>
        {stacked ? button : null}
      </View>
      {stacked ? null : button}
    </Cell>
  );
}

const styles = StyleSheet.create({
  wordmark: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    marginTop: space.xs,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  headline: {
    marginTop: space.m,
  },
  step: {
    paddingVertical: space.s,
  },
  /** At accessibility sizes the symbol stays by the title instead of the middle. */
  stepStacked: {
    alignItems: "flex-start",
  },
  symbolLine: {
    flexDirection: "row",
    alignItems: "center",
  },
  stepSymbol: {
    width: metrics.rowSymbolColumn,
    alignItems: "center",
  },
  stepCopy: {
    minWidth: 0,
    flex: 1,
    gap: space.s,
  },
  stepText: {
    gap: 2,
  },
  stackedButton: {
    alignSelf: "flex-start",
  },
  loadingCell: {
    justifyContent: "center",
  },
});
