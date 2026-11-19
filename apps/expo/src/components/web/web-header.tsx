import type { AppDto } from "@hark/contracts";
import { type NativeStackNavigationOptions, Stack } from "expo-router";
import { memo } from "react";
import { useDirectory } from "../../lib/app-directory";
import { openWebApp } from "../../lib/navigation";
import { isDarkColor } from "../../lib/web-apps";
import { palette, stackScreenOptions } from "../../ui/tokens";
import { orderedApps } from "../keyboard-shortcuts";

/**
 * What the web app screen shows above the page (DESIGN.md 5.11):
 * - `none`: iPhone and compact windows, the chromeless contract.
 * - `close`: a transparent header with only a Close button (consent, and
 *   iPad while the app signs in or failed).
 * - `bar`: iPad regular width, the native navigation bar in the page's own
 *   colour with glass items.
 */
export type WebChrome = "none" | "close" | "bar";

/**
 * The screen's header options for one chrome. Each sets every key it uses,
 * because in-page options persist until something overwrites them.
 */
export function webHeaderOptions(
  chrome: WebChrome,
  bar: { color: string; title: string },
): NativeStackNavigationOptions {
  if (chrome === "none") return { headerShown: false };
  if (chrome === "close") {
    return {
      headerShown: true,
      headerTransparent: true,
      headerStyle: {},
      headerTintColor: palette.label,
      headerBackVisible: false,
      title: "",
      scrollEdgeEffects: stackScreenOptions.scrollEdgeEffects,
    };
  }
  return {
    headerShown: true,
    // Opaque on purpose: pages with fixed headers never slide under the bar.
    headerTransparent: false,
    headerStyle: { backgroundColor: bar.color },
    headerTintColor: isDarkColor(bar.color) ? "#FFFFFF" : palette.label,
    headerBackVisible: false,
    title: bar.title,
    scrollEdgeEffects: stackScreenOptions.scrollEdgeEffects,
  };
}

export interface WebBarItemsProps {
  app: AppDto | null;
  /** False while signing in or after a failure: only Close is offered. */
  ready: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onClose: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSafari: () => void;
  onInfo: () => void;
  onStopSigningIn: () => void;
}

/**
 * The iPad bar's glass items: Close on its own, then Back, Forward and
 * Reload; on the right Open in Safari, App Info and More (Switch App, Stop
 * Signing In). Memoized with stable callbacks: every new toolbar element
 * re-configures the native bar.
 */
export const WebBarItems = memo(function WebBarItems({
  app,
  ready,
  canGoBack,
  canGoForward,
  onClose,
  onBack,
  onForward,
  onReload,
  onSafari,
  onInfo,
  onStopSigningIn,
}: WebBarItemsProps) {
  const apps = orderedApps(useDirectory());
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          accessibilityLabel="Back to Hark"
          icon="xmark"
          onPress={onClose}
          separateBackground
        />
        <Stack.Toolbar.Button
          accessibilityLabel="Back"
          disabled={!canGoBack}
          hidden={!ready}
          icon="chevron.backward"
          onPress={onBack}
        />
        <Stack.Toolbar.Button
          accessibilityLabel="Forward"
          disabled={!canGoForward}
          hidden={!ready}
          icon="chevron.forward"
          onPress={onForward}
        />
        <Stack.Toolbar.Button
          accessibilityLabel="Reload"
          hidden={!ready}
          icon="arrow.clockwise"
          onPress={onReload}
        />
      </Stack.Toolbar>
      {ready && app ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityLabel="Open in Safari"
            icon="safari"
            onPress={onSafari}
          />
          <Stack.Toolbar.Button accessibilityLabel="App Info" icon="info.circle" onPress={onInfo} />
          {/* Inline: the toolbar reads its items by element type, so no wrapper components. */}
          <Stack.Toolbar.Menu accessibilityLabel="More" icon="ellipsis">
            {/* Every app stays two taps away (the native sidebar can't list them). */}
            {apps.length > 1 ? (
              <Stack.Toolbar.Menu icon="square.grid.2x2" title="Switch App">
                {apps.map((item) => (
                  <Stack.Toolbar.MenuAction
                    isOn={item.id === app.id}
                    key={item.id}
                    onPress={() => {
                      if (item.id !== app.id) openWebApp(item.id);
                    }}
                  >
                    {item.name}
                  </Stack.Toolbar.MenuAction>
                ))}
              </Stack.Toolbar.Menu>
            ) : null}
            <Stack.Toolbar.MenuAction
              destructive
              icon="person.crop.circle.badge.xmark"
              onPress={onStopSigningIn}
            >
              Stop Signing In
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
    </>
  );
});
