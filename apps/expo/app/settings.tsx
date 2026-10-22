import {
  getAppIconName,
  setAlternateAppIcon,
  supportsAlternateIcons,
} from "expo-alternate-app-icons";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Redirect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../src/lib/api";
import { type AppIconOption, appIconLabel, appIconOptions } from "../src/lib/app-icons";
import { authClient, useSession } from "../src/lib/auth";
import { previewTeams } from "../src/lib/inbox-preview";
import { clearInteractionResponses, DEVICE_ID_KEY } from "../src/lib/interactions";
import { isUnsupportedRoute } from "../src/lib/teams";
import { colors, fonts, tightTracking } from "../src/lib/theme";
import { clearAllWebsiteData } from "../src/lib/website-data";

const EXPO_TOKEN_KEY = "hark.device.expoPushToken";
const APNS_TOKEN_KEY = "hark.device.apnsToken";

export default function SettingsScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const [notificationsAllowed, setNotificationsAllowed] = useState<boolean | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [liveActivitiesCapable, setLiveActivitiesCapable] = useState<boolean | null>(null);
  const [currentAppIcon, setCurrentAppIcon] = useState<string | null>(() => getAppIconName());
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [changingAppIcon, setChangingAppIcon] = useState<string | null>(null);
  const [teamNames, setTeamNames] = useState<string[] | null>(null);
  const [teamsSupported, setTeamsSupported] = useState(true);

  useEffect(() => {
    if (simulatorPreview) {
      setTeamNames(previewTeams.map((team) => team.name));
      return;
    }
    void api
      .listTeams()
      .then((result) => setTeamNames(result.teams.map((team) => team.name)))
      .catch((cause: unknown) => {
        // Older servers don't have teams; hide the row there.
        if (isUnsupportedRoute(cause)) setTeamsSupported(false);
      });
  }, [simulatorPreview]);

  useEffect(() => {
    void Promise.all([
      Notifications.getPermissionsAsync(),
      SecureStore.getItemAsync(DEVICE_ID_KEY),
      api.listDevices().catch(() => ({ devices: [] })),
    ]).then(([permission, deviceId, result]) => {
      setNotificationsAllowed(permission.granted);
      setRegistered(Boolean(deviceId));
      setLiveActivitiesCapable(
        result.devices.find((registeredDevice) => registeredDevice.id === deviceId)
          ?.liveActivitiesCapable ?? false,
      );
    });
  }, []);

  if (!isPending && !session && !simulatorPreview) return <Redirect href="/" />;

  const clearDevice = async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(EXPO_TOKEN_KEY),
      SecureStore.deleteItemAsync(APNS_TOKEN_KEY),
      SecureStore.deleteItemAsync(DEVICE_ID_KEY),
      clearInteractionResponses(),
      Notifications.setBadgeCountAsync(0),
      clearAllWebsiteData(),
    ]);
  };

  const signOut = () => {
    Alert.alert("Sign out", "This device will stop receiving notifications.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void (async () => {
            const expoPushToken = await SecureStore.getItemAsync(EXPO_TOKEN_KEY);
            try {
              if (expoPushToken) await api.unregisterDevice({ expoPushToken });
            } catch {
              // Best effort; stale tokens are also deactivated server-side.
            }
            await clearDevice();
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
      "This permanently deletes your services, activity history, and registered devices.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                const expoPushToken = await SecureStore.getItemAsync(EXPO_TOKEN_KEY);
                if (expoPushToken) await api.unregisterDevice({ expoPushToken });
                const result = await authClient.deleteUser();
                if (result.error) {
                  throw new Error(result.error.message ?? "Account deletion was not completed");
                }
                await clearDevice();
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

  const changeAppIcon = async (option: AppIconOption) => {
    if (option.alternateName === currentAppIcon || changingAppIcon) return;
    setChangingAppIcon(option.id);
    try {
      const selected = await setAlternateAppIcon(option.alternateName);
      setCurrentAppIcon(selected);
    } catch (error) {
      Alert.alert(
        "Could not change app icon",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setChangingAppIcon(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <SymbolView name="chevron.left" size={18} tintColor={colors.ink} weight="semibold" />
          </Pressable>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={styles.iconButton} />
        </View>

        <SettingsRow
          icon="bell.fill"
          label="Notifications"
          value={
            notificationsAllowed === null ? "Checking…" : notificationsAllowed ? "Allowed" : "Off"
          }
          onPress={notificationsAllowed === false ? () => void Linking.openSettings() : undefined}
        />
        <SettingsRow
          icon="iphone"
          label="This iPhone"
          value={registered === null ? "Checking…" : registered ? "Registered" : "Not registered"}
          onPress={registered === false ? () => router.replace("/home") : undefined}
        />
        <SettingsRow
          icon="waveform.path.ecg"
          label="Live Activities"
          value={
            liveActivitiesCapable === null
              ? "Checking…"
              : liveActivitiesCapable
                ? "Available"
                : "Not available"
          }
        />
        <SettingsRow
          icon="app.fill"
          label="App icon"
          value={supportsAlternateIcons ? appIconLabel(currentAppIcon) : "Unavailable"}
          onPress={
            supportsAlternateIcons
              ? () => setIconPickerOpen((currentlyOpen) => !currentlyOpen)
              : undefined
          }
        />
        {iconPickerOpen && supportsAlternateIcons ? (
          <View style={styles.appIconGrid}>
            {appIconOptions.map((option) => {
              const selected = option.alternateName === currentAppIcon;
              const changing = changingAppIcon === option.id;
              return (
                <Pressable
                  accessibilityLabel={`${option.label} app icon`}
                  accessibilityRole="button"
                  accessibilityState={{ selected, disabled: changingAppIcon !== null }}
                  disabled={changingAppIcon !== null}
                  key={option.id}
                  onPress={() => void changeAppIcon(option)}
                  style={({ pressed }) => [
                    styles.appIconOption,
                    selected && styles.appIconOptionSelected,
                    pressed && styles.appIconOptionPressed,
                  ]}
                >
                  <View style={styles.appIconPreviewFrame}>
                    <Image source={option.image} style={styles.appIconPreview} />
                    {changing ? (
                      <View style={styles.appIconSpinner}>
                        <ActivityIndicator color="#FFFFFF" />
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.appIconName, selected && styles.appIconNameSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {teamsSupported ? (
          <SettingsRow
            icon="person.2.fill"
            label="Teams"
            value={
              teamNames === null
                ? ""
                : teamNames.length === 0
                  ? "Create or join"
                  : teamNames.length === 1
                    ? (teamNames[0] ?? "")
                    : `${teamNames.length} teams`
            }
            onPress={() => router.push("/teams")}
          />
        ) : null}
        <SettingsRow icon="person.fill" label="Signed in as" value={session?.user.email ?? ""} />
        <Pressable accessibilityRole="button" onPress={signOut} style={styles.accountAction}>
          <Text style={styles.accountActionText}>Sign out</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={deleteAccount} style={styles.accountAction}>
          <Text style={styles.deleteText}>Delete account</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: Parameters<typeof SymbolView>[0]["name"];
  label: string;
  value: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <SymbolView name={icon} size={16} tintColor={colors.accent} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
      {onPress ? <SymbolView name="chevron.right" size={12} tintColor={colors.soft} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: 24, paddingBottom: 48 },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  headerTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 17,
    letterSpacing: tightTracking(17),
  },
  row: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  rowPressed: { opacity: 0.65 },
  rowIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: colors.accentSoft,
  },
  rowLabel: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  rowValue: {
    minWidth: 0,
    flex: 1,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    textAlign: "right",
    letterSpacing: tightTracking(13),
  },
  appIconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  appIconOption: {
    flexBasis: "30%",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 14,
  },
  appIconOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  appIconOptionPressed: {
    opacity: 0.65,
    transform: [{ scale: 0.96 }],
  },
  appIconPreviewFrame: {
    width: 44,
    height: 44,
    borderRadius: 10,
    overflow: "hidden",
  },
  appIconPreview: {
    width: 44,
    height: 44,
  },
  appIconSpinner: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.28)",
  },
  appIconName: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  appIconNameSelected: {
    color: colors.accent,
  },
  accountAction: {
    minHeight: 52,
    justifyContent: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  accountActionText: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  deleteText: {
    color: colors.danger,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  pressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.96 }],
  },
});
