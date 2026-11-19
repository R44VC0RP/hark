import { router, Stack } from "expo-router";
import type { ReactNode } from "react";

/**
 * The trailing toolbar of every tab root (DESIGN.md 5.0): optional extra
 * items first (e.g. Teams' "New Team"), then the glass Account button that
 * opens the Settings sheet, the iOS 26 pattern for rare account things.
 * A screen renders at most one right-placement toolbar, so tab roots use
 * this instead of their own.
 */
export function TabRootToolbar({ children }: { children?: ReactNode }) {
  return (
    <Stack.Toolbar placement="right">
      {children}
      <Stack.Toolbar.Button
        accessibilityLabel="Account"
        icon="person.crop.circle"
        onPress={() => router.push("/settings")}
        separateBackground
      />
    </Stack.Toolbar>
  );
}
