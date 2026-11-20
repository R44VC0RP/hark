import { Stack } from "expo-router";
import { stackScreenOptions } from "../../../src/ui/tokens";

export const unstable_settings = { initialRouteName: "teams/index" };

/** Teams tab: Teams › Team › On Call, and your own On Call. */
export default function TeamsLayout() {
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="teams/index"
        options={{ title: "Teams", headerLargeTitleEnabled: true }}
      />
    </Stack>
  );
}
