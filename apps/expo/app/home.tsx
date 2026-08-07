import type { EventDto } from "@hark/contracts";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Redirect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { trackAppEvent, trackOnboardingCompleted } from "../src/lib/analytics";
import { api } from "../src/lib/api";
import { authClient, useSession } from "../src/lib/auth";
import {
  clearInteractionResponses,
  DEVICE_ID_KEY,
  flushInteractionResponses,
  registerInteractionCategories,
} from "../src/lib/interactions";
import { refreshLiveActivityTokenSync } from "../src/lib/live-activities";
import { colors, fonts, tightTracking } from "../src/lib/theme";

type PermissionState = "unknown" | "undetermined" | "granted" | "denied";
type RegistrationState = "idle" | "working" | "registered" | "error";

const EXPO_TOKEN_KEY = "hark.device.expoPushToken";
const APNS_TOKEN_KEY = "hark.device.apnsToken";

export default function HomeScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [registration, setRegistration] = useState<RegistrationState>("idle");
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const autoRegistrationAttempted = useRef(false);

  const refreshPermission = useCallback(async () => {
    const current = await Notifications.getPermissionsAsync();
    setPermission(current.granted ? "granted" : current.canAskAgain ? "undetermined" : "denied");
  }, []);

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  useEffect(() => {
    void SecureStore.getItemAsync(EXPO_TOKEN_KEY)
      .then((storedExpoToken) => {
        if (storedExpoToken) {
          setExpoPushToken(storedExpoToken);
          setRegistration("registered");
        }
      })
      .finally(() => setStorageHydrated(true));
  }, []);

  const requestPermission = async () => {
    void trackAppEvent("notification_permission_prompted", { path: "/home" });
    const result = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    setPermission(result.granted ? "granted" : result.canAskAgain ? "undetermined" : "denied");
    void trackAppEvent("notification_permission_resolved", {
      path: "/home",
      outcome: result.granted ? "granted" : result.canAskAgain ? "undetermined" : "denied",
      properties: {
        permission: result.granted ? "granted" : result.canAskAgain ? "undetermined" : "denied",
      },
    });
  };

  const registerDevice = useCallback(async (preserveReadyState = false) => {
    void trackAppEvent("device_registration_started", { path: "/home" });
    if (!preserveReadyState) setRegistration("working");
    setLastError(null);
    try {
      if (!Device.isDevice) {
        throw new Error("Push notifications require a physical iPhone.");
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
      const registered = await api.registerDevice({
        expoPushToken: expoToken,
        ...(apns ? { apnsToken: apns } : {}),
        platform: "ios",
        deviceName: Device.deviceName ?? undefined,
        interactionSchemaVersion: 1,
        ...(Number.parseFloat(String(Platform.Version)) >= 17
          ? { liveActivityInteractionVersion: 1 as const }
          : {}),
      });

      await SecureStore.setItemAsync(EXPO_TOKEN_KEY, expoToken);
      await SecureStore.setItemAsync(DEVICE_ID_KEY, registered.device.id);
      if (apns) {
        await SecureStore.setItemAsync(APNS_TOKEN_KEY, apns);
      } else {
        await SecureStore.deleteItemAsync(APNS_TOKEN_KEY);
      }

      setExpoPushToken(expoToken);
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
        setLastError(err instanceof Error ? err.message : "Registration failed");
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
      setEvents(activity.events);
    } catch {
      // Keep the last successful activity snapshot visible while offline.
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshEvents();
    const interval = setInterval(() => void refreshEvents(), 10_000);
    const notificationSubscription = Notifications.addNotificationReceivedListener(() => {
      void refreshEvents();
    });
    return () => {
      clearInterval(interval);
      notificationSubscription.remove();
    };
  }, [session, refreshEvents]);

  const signOut = () => {
    Alert.alert("Sign out", "This device will stop receiving notifications.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              if (expoPushToken) {
                await api.unregisterDevice({ expoPushToken });
              }
            } catch {
              // Best effort — the server also deactivates stale tokens.
            }
            await Promise.all([
              SecureStore.deleteItemAsync(EXPO_TOKEN_KEY),
              SecureStore.deleteItemAsync(APNS_TOKEN_KEY),
              SecureStore.deleteItemAsync(DEVICE_ID_KEY),
              clearInteractionResponses(),
            ]);
            await authClient.signOut();
            router.replace("/");
          })();
        },
      },
    ]);
  };

  const deleteAccount = () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your services, webhook history, and registered devices. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                if (expoPushToken) await api.unregisterDevice({ expoPushToken });
                const result = await authClient.deleteUser();
                if (result.error) {
                  throw new Error(result.error.message ?? "Account deletion was not completed");
                }
                await Promise.all([
                  SecureStore.deleteItemAsync(EXPO_TOKEN_KEY),
                  SecureStore.deleteItemAsync(APNS_TOKEN_KEY),
                  SecureStore.deleteItemAsync(DEVICE_ID_KEY),
                  clearInteractionResponses(),
                ]);
                router.replace("/");
              } catch (error) {
                Alert.alert(
                  "Could not delete account",
                  error instanceof Error ? error.message : "Please try again.",
                );
              }
            })();
          },
        },
      ],
    );
  };

  if (!isPending && !session) {
    return <Redirect href="/" />;
  }

  const ready = permission === "granted" && registration === "registered";

  if (__DEV__ && !Device.isDevice) return <Redirect href="/inbox" />;
  if (ready) return <Redirect href="/inbox" />;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={styles.brandGroup}>
            <View style={styles.brandMark} />
            <Text style={styles.brand}>Hark</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={signOut} hitSlop={8}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>

        <Text style={styles.greeting}>
          {ready
            ? "This iPhone is ready to receive notifications."
            : "Two steps and this iPhone starts receiving your webhooks."}
        </Text>

        {ready ? (
          <View style={styles.completedSteps}>
            <CompactStep title="Notifications allowed" />
            <CompactStep title="Device registered" />
          </View>
        ) : (
          <>
            <StepCard
              index={1}
              title="Allow notifications"
              done={permission === "granted"}
              body={
                permission === "denied"
                  ? "Notifications are turned off. Enable them for Hark in the iOS Settings app."
                  : "Hark shows each webhook as a communication notification with your service's name and avatar."
              }
              actionLabel={permission === "granted" ? undefined : "Allow notifications"}
              onAction={permission === "denied" ? undefined : requestPermission}
            />

            <StepCard
              index={2}
              title="Register this device"
              done={registration === "registered"}
              body={
                registration === "registered"
                  ? "This device is registered and ready when notifications are enabled."
                  : "Links this iPhone to your account so your services can reach it."
              }
              actionLabel={
                registration === "registered"
                  ? undefined
                  : registration === "working"
                    ? "Registering…"
                    : "Register device"
              }
              onAction={registration === "working" ? undefined : () => registerDevice(false)}
              disabled={permission !== "granted"}
            />
          </>
        )}

        {lastError ? <Text style={styles.error}>{lastError}</Text> : null}
        <ActivityLog events={events} onRefresh={refreshEvents} />
        <Pressable accessibilityRole="button" onPress={deleteAccount} style={styles.deleteAccount}>
          <Text style={styles.deleteAccountText}>Delete account</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function CompactStep({ title }: { title: string }) {
  return (
    <View style={styles.compactStep}>
      <View style={styles.compactCheck}>
        <Text style={styles.compactCheckText}>✓</Text>
      </View>
      <Text style={styles.compactStepText}>{title}</Text>
    </View>
  );
}

function StepCard({
  index,
  title,
  body,
  done,
  actionLabel,
  onAction,
  disabled,
}: {
  index: number;
  title: string;
  body: string;
  done: boolean;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  disabled?: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.stepBadge, done && styles.stepBadgeDone]}>
          <Text style={[styles.stepBadgeText, done && styles.stepBadgeTextDone]}>
            {done ? "✓" : index}
          </Text>
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <Text style={styles.cardBody}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void onAction()}
          disabled={disabled}
          style={({ pressed }) => [
            styles.cardButton,
            done && styles.cardButtonSecondary,
            (pressed || disabled) && styles.pressed,
          ]}
        >
          <Text style={[styles.cardButtonText, done && styles.cardButtonTextSecondary]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ActivityLog({
  events,
  onRefresh,
}: {
  events: EventDto[] | null;
  onRefresh: () => Promise<void>;
}) {
  return (
    <View style={styles.activitySection}>
      <View style={styles.activityHeader}>
        <Text style={styles.activityTitle}>Recent activity</Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void onRefresh()}>
          <Text style={styles.activityRefresh}>Refresh</Text>
        </Pressable>
      </View>
      {events === null ? <Text style={styles.emptyActivity}>Loading…</Text> : null}
      {events?.length === 0 ? (
        <Text style={styles.emptyActivity}>No webhook activity yet.</Text>
      ) : null}
      {events?.map((activityEvent) => (
        <ActivityLogRow activityEvent={activityEvent} key={activityEvent.id} />
      ))}
    </View>
  );
}

function ActivityLogRow({ activityEvent }: { activityEvent: EventDto }) {
  const [expanded, setExpanded] = useState(false);
  const expandable = activityEvent.body.length > 0;
  return (
    <Pressable
      accessibilityRole={expandable ? "button" : undefined}
      disabled={!expandable}
      onPress={() => setExpanded((current) => !current)}
      style={styles.activityRow}
    >
      <View style={styles.activityAvatarWrap}>
        {activityEvent.imageUrl ? (
          <Image source={{ uri: activityEvent.imageUrl }} style={styles.activityAvatar} />
        ) : (
          <View style={styles.activityAvatarFallback}>
            <Text style={styles.activityAvatarFallbackText}>
              {activityEvent.serviceTitle.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.activityStatusBadge}>
          <View style={[styles.activityDot, activityDotStyle(activityEvent.status)]} />
        </View>
      </View>
      <View style={styles.activityCopy}>
        <View style={styles.activityTopLine}>
          <Text style={styles.activityName} numberOfLines={expanded ? undefined : 1}>
            {activityEvent.serviceTitle} · {activityEvent.title}
          </Text>
          <Text style={styles.activityTime}>
            {new Date(activityEvent.createdAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
        </View>
        <Text style={styles.activityBody} numberOfLines={expanded ? undefined : 1}>
          {activityEvent.body}
        </Text>
        <Text style={styles.activityStatus}>{activityStatus(activityEvent)}</Text>
      </View>
      {expandable ? (
        <SymbolView
          name={expanded ? "chevron.up" : "chevron.down"}
          size={11}
          style={styles.activityChevron}
          tintColor={colors.soft}
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}

function activityDotStyle(status: string) {
  if (status === "accepted" || status === "delivered") return { backgroundColor: colors.accent };
  if (status === "withdrawn") return { backgroundColor: colors.soft };
  if (status === "failed") return { backgroundColor: colors.danger };
  if (status === "partial" || status === "withdraw_partial") {
    return { backgroundColor: "#D48A16" };
  }
  return { backgroundColor: colors.line };
}

function activityStatus(activityEvent: EventDto): string {
  if (activityEvent.status === "accepted" || activityEvent.status === "delivered") {
    return `Accepted for ${activityEvent.deliveredCount} ${activityEvent.deliveredCount === 1 ? "device" : "devices"}`;
  }
  if (activityEvent.status === "withdrawn") return "Withdrawal requested";
  if (activityEvent.status === "withdraw_partial") return "Withdrawal partially accepted";
  if (activityEvent.status === "partial") return "Partially accepted";
  if (activityEvent.status === "no_devices") return "No active devices";
  if (activityEvent.status === "processing") return "Processing";
  return activityEvent.error ? `Failed · ${activityEvent.error}` : "Failed";
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: 24, paddingBottom: 48, gap: 14 },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandGroup: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandMark: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  brand: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 18,
    letterSpacing: tightTracking(18),
  },
  signOut: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  greeting: {
    maxWidth: 340,
    marginTop: 18,
    marginBottom: 10,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 26,
    lineHeight: 31,
    letterSpacing: tightTracking(26),
  },
  card: {
    padding: 16,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  stepBadgeDone: { backgroundColor: colors.accent },
  stepBadgeText: {
    color: colors.accent,
    fontFamily: fonts.semibold,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  stepBadgeTextDone: { color: "#FFFFFF" },
  cardTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 16,
    letterSpacing: tightTracking(16),
  },
  cardBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: tightTracking(14),
  },
  cardButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    borderRadius: 22,
    backgroundColor: colors.accent,
  },
  cardButtonSecondary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  cardButtonText: {
    color: "#FFFFFF",
    fontFamily: fonts.medium,
    fontSize: 15,
    letterSpacing: tightTracking(15),
  },
  cardButtonTextSecondary: { color: colors.accent },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  error: {
    paddingHorizontal: 4,
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  completedSteps: {
    flexDirection: "row",
    gap: 8,
  },
  compactStep: {
    minHeight: 40,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  compactCheck: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: colors.accent,
  },
  compactCheckText: {
    color: "#FFFFFF",
    fontFamily: fonts.semibold,
    fontSize: 10,
  },
  compactStepText: {
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  activitySection: {
    marginTop: 18,
  },
  activityHeader: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activityTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 18,
    letterSpacing: tightTracking(18),
  },
  activityRefresh: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  emptyActivity: {
    paddingVertical: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  activityRow: {
    flexDirection: "row",
    gap: 9,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  activityAvatarWrap: {
    position: "relative",
    width: 32,
    height: 32,
  },
  activityAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  activityAvatarFallback: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
  },
  activityAvatarFallbackText: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  activityStatusBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 13,
    height: 13,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    backgroundColor: colors.paper,
  },
  activityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  activityCopy: {
    minWidth: 0,
    flex: 1,
  },
  activityTopLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  activityName: {
    minWidth: 0,
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: tightTracking(13),
  },
  activityTime: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 11,
    letterSpacing: tightTracking(11),
  },
  activityBody: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: tightTracking(12),
  },
  activityChevron: {
    marginTop: 4,
  },
  activityStatus: {
    marginTop: 1,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: tightTracking(10),
  },
  deleteAccount: {
    alignSelf: "flex-start",
    marginTop: 18,
    paddingVertical: 8,
  },
  deleteAccountText: {
    color: colors.danger,
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
});
