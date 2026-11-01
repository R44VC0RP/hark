import {
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter-tight";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router, Stack, usePathname, useSegments } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { KeyboardShortcuts, Sidebar } from "../src/components/sidebar";
import { trackAppEvent } from "../src/lib/analytics";
import { useSession } from "../src/lib/auth";
import {
  flushInteractionResponses,
  flushPageAcknowledgements,
  handleNotificationResponse,
  registerInteractionCategories,
} from "../src/lib/interactions";
import { SidebarProvider, useSidebar } from "../src/lib/layout";
import { startLiveActivityTokenSync } from "../src/lib/live-activities";
import { PENDING_JOIN_CODE_KEY } from "../src/lib/teams";
import { colors } from "../src/lib/theme";

void SplashScreen.preventAutoHideAsync();
void registerInteractionCategories().catch((error) => {
  console.warn("Could not register notification actions", error);
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const segments = useSegments();
  // Analytics gets the route pattern (`/join/:code`), never invite codes or
  // IDs; `:` keeps it within the server's path character set.
  const routePattern = `/${segments
    .filter((segment) => segment !== "index" && !segment.startsWith("("))
    .map((segment) => segment.replace(/^\[(?:\.\.\.)?(.+)\]$/, ":$1"))
    .join("/")}`;
  const [fontsLoaded, fontError] = useFonts({
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    void trackAppEvent("app_open");
    // Handle both a cold launch from a notification and taps while the app is running.
    const initialResponse = Notifications.getLastNotificationResponse();
    if (initialResponse) {
      void handleNotificationResponse(initialResponse);
      void Notifications.clearLastNotificationResponseAsync();
    }
    void flushInteractionResponses();
    void flushPageAcknowledgements();

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotificationResponse(response);
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void flushInteractionResponses();
        void flushPageAcknowledgements();
        void trackAppEvent("app_open");
      }
    });
    const retryTimer = setInterval(() => {
      void flushInteractionResponses();
      void flushPageAcknowledgements();
    }, 30_000);
    return () => {
      subscription.remove();
      appState.remove();
      clearInterval(retryTimer);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: each navigation is a view, even within one pattern.
  useEffect(() => {
    void trackAppEvent("screen_view", { path: routePattern });
  }, [pathname, routePattern]);

  useEffect(() => {
    if (!session) return;
    return startLiveActivityTokenSync();
  }, [session]);

  // An invite opened while signed out resumes once sign-in completes.
  const signedIn = Boolean(session);
  useEffect(() => {
    if (!signedIn) return;
    void SecureStore.getItemAsync(PENDING_JOIN_CODE_KEY).then(async (code) => {
      if (!code) return;
      await SecureStore.deleteItemAsync(PENDING_JOIN_CODE_KEY);
      setTimeout(() => {
        try {
          router.push({ pathname: "/join/[code]", params: { code } });
        } catch {
          // The invite link can be opened again.
        }
      }, 600);
    });
  }, [signedIn]);

  if (!fontsLoaded && !fontError) return null;

  // The iPad sidebar belongs to the signed-in app, not sign-in or setup.
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const sidebarRoute = !["/", "/home", "/la-lab"].includes(pathname);
  const inApp = Boolean(session || simulatorPreview) && sidebarRoute;

  return (
    <SidebarProvider enabled={inApp}>
      {inApp ? <KeyboardShortcuts /> : null}
      <Shell />
    </SidebarProvider>
  );
}

/** The stack, with the sidebar beside it when the window is wide enough. */
function Shell() {
  const { open, docked, dismiss } = useSidebar();
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.paper }}>
      {docked ? <Sidebar /> : null}
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={({ route }) => ({
            headerShown: false,
            contentStyle: { backgroundColor: colors.paper },
            // Switching from the sidebar swaps the screen in place, like a tab.
            animation:
              (route.params as { via?: string } | undefined)?.via === "sidebar"
                ? "none"
                : "default",
          })}
        />
      </View>
      {open && !docked ? (
        // Too narrow to dock: the sidebar slides over the content until a
        // choice is made or the dimmed content is tapped.
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            accessibilityLabel="Hide sidebar"
            onPress={dismiss}
            style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(23, 23, 19, 0.24)" }]}
          />
          <View
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              flexDirection: "row",
              ...overlayShadow,
            }}
          >
            <Sidebar />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const overlayShadow = {
  shadowColor: "#000000",
  shadowOpacity: 0.18,
  shadowRadius: 24,
  shadowOffset: { width: 8, height: 0 },
} as const;
