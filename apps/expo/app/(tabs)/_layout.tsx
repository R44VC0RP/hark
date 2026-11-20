import * as Device from "expo-device";
import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { KeyboardShortcuts } from "../../src/components/keyboard-shortcuts";
import { PagesAccessory } from "../../src/components/pages-accessory";
import { useDirectory, useDirectoryRefresh } from "../../src/lib/app-directory";
import { useSession } from "../../src/lib/auth";
import { DEVICE_ID_KEY } from "../../src/lib/interactions";
import { pagesNeedingResponse } from "../../src/lib/teams";
import { colors, palette } from "../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;

/**
 * Badge text, or nothing at zero: expo-router 57 shows any badge that has
 * children, even with `hidden` (checked in the simulator: "0" appeared).
 */
function countLabel(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? "99+" : String(count);
}

/**
 * The signed-in app (DESIGN.md 5.0). Native tabs mount every tab at once, so
 * nothing renders until the session and this device's registration are
 * known; signed out goes to Sign In, unregistered to Set Up.
 */
export default function TabsLayout() {
  const { data: session, isPending } = useSession();
  const [deviceId, setDeviceId] = useState<string | undefined>();
  // A session that ended stays ended for this instance: signing in again
  // builds fresh tabs, so nothing from the old account stays mounted.
  const signedOut = useRef(false);

  useEffect(() => {
    void SecureStore.getItemAsync(DEVICE_ID_KEY).then((value) =>
      setDeviceId(value ?? (simulatorPreview ? "preview-device" : "")),
    );
  }, []);

  const sessionKnown = simulatorPreview || Boolean(session) || !isPending;
  if (!simulatorPreview && sessionKnown && !session) signedOut.current = true;

  if (signedOut.current) return <Redirect href="/" />;
  if (!sessionKnown || deviceId === undefined) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
  if (deviceId === "") return <Redirect href="/home" />;
  return <SignedInTabs />;
}

function SignedInTabs() {
  useDirectoryRefresh();
  const directory = useDirectory();
  const inboxCount = (directory?.unread ?? 0) + (directory?.waiting ?? 0);
  const pages = directory?.oncall ? pagesNeedingResponse(directory.oncall.pages) : [];

  return (
    <>
      <KeyboardShortcuts />
      <NativeTabs
        minimizeBehavior="onScrollDown"
        sidebarAdaptable
        tintColor={palette.accent}
        unstable_nativeProps={{ ios: { bottomAccessoryHidden: pages.length === 0 } }}
      >
        <NativeTabs.BottomAccessory>
          <PagesAccessory pages={pages} />
        </NativeTabs.BottomAccessory>
        <NativeTabs.Trigger name="(inbox)">
          <NativeTabs.Trigger.Icon sf={{ default: "tray", selected: "tray.fill" }} />
          <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Badge hidden={inboxCount === 0}>
            {countLabel(inboxCount)}
          </NativeTabs.Trigger.Badge>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(apps)">
          <NativeTabs.Trigger.Icon
            sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }}
          />
          <NativeTabs.Trigger.Label>Apps</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(teams)">
          <NativeTabs.Trigger.Icon sf={{ default: "person.2", selected: "person.2.fill" }} />
          <NativeTabs.Trigger.Label>Teams</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Badge hidden={pages.length === 0}>
            {countLabel(pages.length)}
          </NativeTabs.Trigger.Badge>
        </NativeTabs.Trigger>
      </NativeTabs>
    </>
  );
}
