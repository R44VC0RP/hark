import { getAppIconName } from "expo-alternate-app-icons";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, View } from "react-native";
import { confirmDeleteAccount, confirmSignOut } from "../../src/lib/account";
import { api } from "../../src/lib/api";
import { appIconLabel } from "../../src/lib/app-icons";
import { useSession } from "../../src/lib/auth";
import { previewViewer } from "../../src/lib/inbox-preview";
import { DEVICE_ID_KEY } from "../../src/lib/interactions";
import { deviceNoun, isPad } from "../../src/lib/layout";
import { leaveAppTo } from "../../src/lib/navigation";
import { spoken } from "../../src/ui/a11y";
import { Avatar } from "../../src/ui/avatar";
import { ActionRow, Cell, List, Row, Section } from "../../src/ui/list";
import { Text } from "../../src/ui/text";
import { colors, metrics, space } from "../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;
const AVATAR = 56;

/**
 * Settings (DESIGN.md 5.10): the Account sheet every tab root opens. Who is
 * signed in, how this device is set up, the app icon, recent deliveries,
 * and signing out. Teams moved to their own tab.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { data: session } = useSession();
  // Signing out ends the session while this sheet slides away: keep showing
  // who was signed in so the sheet's content doesn't jump as it leaves.
  const lastUser = useRef<{ name: string; email: string; image?: string | null } | null>(null);
  if (session?.user) lastUser.current = session.user;
  const user =
    lastUser.current ?? (simulatorPreview ? { name: previewViewer.name, email: "" } : null);
  const [notificationsAllowed, setNotificationsAllowed] = useState<boolean | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [liveActivitiesCapable, setLiveActivitiesCapable] = useState<boolean | null>(null);
  const [appIcon, setAppIcon] = useState(() => appIconLabel(getAppIconName()));

  const checkPermission = useCallback(() => {
    void Notifications.getPermissionsAsync().then((permission) =>
      setNotificationsAllowed(permission.granted),
    );
  }, []);

  useEffect(() => {
    checkPermission();
    void Promise.all([
      SecureStore.getItemAsync(DEVICE_ID_KEY),
      api.listDevices().catch(() => ({ devices: [] })),
    ]).then(([deviceId, result]) => {
      setRegistered(Boolean(deviceId));
      setLiveActivitiesCapable(
        result.devices.find((registeredDevice) => registeredDevice.id === deviceId)
          ?.liveActivitiesCapable ?? false,
      );
    });
    // Back from the Settings app, where notifications may have been turned on.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") checkPermission();
    });
    return () => appState.remove();
  }, [checkPermission]);

  // Back from App Icon: show the icon chosen there.
  useFocusEffect(
    useCallback(() => {
      setAppIcon(appIconLabel(getAppIconName()));
    }, []),
  );

  const liveActivities = isPad
    ? "iPhone Only"
    : liveActivitiesCapable === null
      ? undefined
      : liveActivitiesCapable
        ? "Available"
        : "Not Available";

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          accessibilityLabel="Close"
          icon="xmark"
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
      <List>
        {user ? (
          <Section>
            <Cell
              accessibilityLabel={spoken(user.name, user.email)}
              accessible
              minHeight={AVATAR + space.m}
              separatorInset={metrics.rowPaddingHorizontal + AVATAR + metrics.rowAccessoryGap}
            >
              <Avatar image={user.image} name={user.name} size={AVATAR} />
              <View style={styles.identity}>
                <Text variant="title3">{user.name}</Text>
                {user.email ? (
                  <Text color="secondaryLabel" variant="subheadline">
                    {user.email}
                  </Text>
                ) : null}
              </View>
            </Cell>
          </Section>
        ) : null}

        <Section title={`This ${deviceNoun}`}>
          <Row
            accessibilityHint={
              notificationsAllowed === false ? "Opens Hark in the Settings app" : undefined
            }
            onPress={notificationsAllowed === false ? () => void Linking.openSettings() : undefined}
            symbol="bell.badge"
            title="Notifications"
            trailing={
              notificationsAllowed === false ? (
                <SymbolView name="arrow.up.forward.app" size={17} tintColor={colors.placeholder} />
              ) : undefined
            }
            value={notificationsAllowed === null ? undefined : notificationsAllowed ? "On" : "Off"}
          />
          <Row
            accessibilityHint={registered === false ? `Sets up this ${deviceNoun}` : undefined}
            chevron={registered === false}
            onPress={registered === false ? () => leaveAppTo("/home") : undefined}
            symbol={isPad ? "ipad" : "iphone"}
            title="Registration"
            value={registered === null ? undefined : registered ? "Registered" : "Not Registered"}
          />
          <Row
            symbol="platter.filled.bottom.iphone"
            title="Live Activities"
            value={liveActivities}
          />
        </Section>

        <Section title="Appearance">
          <Row
            chevron
            onPress={() => router.push("/settings/app-icon")}
            symbol="app.badge.checkmark"
            title="App Icon"
            value={appIcon}
          />
        </Section>

        <Section title="Activity">
          <Row
            accessibilityHint="Shows the webhooks Hark received and where they went"
            chevron
            onPress={() => router.push("/settings/deliveries")}
            symbol="paperplane"
            title="Recent Deliveries"
          />
        </Section>

        <Section>
          <ActionRow destructive onPress={confirmSignOut} title="Sign Out" />
          <ActionRow destructive onPress={confirmDeleteAccount} title="Delete Account" />
        </Section>

        <Text align="center" color="tertiaryLabel" style={styles.version} variant="footnote">
          Hark {Constants.expoConfig?.version ?? ""}
        </Text>
      </List>
    </>
  );
}

const styles = StyleSheet.create({
  identity: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  version: {
    marginTop: metrics.sectionGap,
  },
});
