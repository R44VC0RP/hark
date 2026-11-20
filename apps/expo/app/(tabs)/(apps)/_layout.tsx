import { Stack } from "expo-router";
import { stackScreenOptions } from "../../../src/ui/tokens";

export const unstable_settings = { initialRouteName: "apps/index" };

/** Apps tab. */
export default function AppsLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="apps/index" options={{ title: "Apps", headerLargeTitleEnabled: true }} />
    </Stack>
  );
}
