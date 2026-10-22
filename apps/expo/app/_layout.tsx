import {
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter-tight";
import * as Notifications from "expo-notifications";
import { router, Stack, usePathname, useSegments } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { AppState } from "react-native";
import { trackAppEvent } from "../src/lib/analytics";
import { useSession } from "../src/lib/auth";
import {
  flushInteractionResponses,
  flushPageAcknowledgements,
  handleNotificationResponse,
  registerInteractionCategories,
} from "../src/lib/interactions";
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

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.paper },
      }}
    />
  );
}
