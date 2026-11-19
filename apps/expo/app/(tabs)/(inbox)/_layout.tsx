import { Stack } from "expo-router";
import { stackScreenOptions } from "../../../src/ui/tokens";

export const unstable_settings = { initialRouteName: "inbox" };

/** Inbox tab: Inbox › Project › Notification, and History. */
export default function InboxLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="inbox" options={{ title: "Inbox", headerLargeTitleEnabled: true }} />
    </Stack>
  );
}
