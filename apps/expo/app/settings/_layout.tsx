import { Stack } from "expo-router";
import { stackScreenOptions } from "../../src/ui/tokens";

export const unstable_settings = { initialRouteName: "index" };

/** The Settings sheet's own stack: Settings › App Icon, Recent Deliveries. */
export default function SettingsLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" options={{ title: "Settings" }} />
    </Stack>
  );
}
