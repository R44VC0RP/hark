import {
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter-tight";
import * as Notifications from "expo-notifications";
import {
  router,
  Stack,
  ThemeProvider,
  usePathname,
  useRootNavigationState,
  useSegments,
} from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { AppState, Settings } from "react-native";
import { trackAppEvent } from "../src/lib/analytics";
import { useSession } from "../src/lib/auth";
import { setHourCycle } from "../src/lib/dates";
import {
  flushInteractionResponses,
  flushPageAcknowledgements,
  handleNotificationResponse,
  registerInteractionCategories,
  setNotificationNavigationGate,
} from "../src/lib/interactions";
import { startLiveActivityTokenSync } from "../src/lib/live-activities";
import {
  afterSheets,
  rootTransitionEnded,
  setCurrentPath,
  useNavigationForLinks,
} from "../src/lib/navigation";
import { PENDING_JOIN_CODE_KEY } from "../src/lib/teams";
import { useLargeText } from "../src/ui/list";
import { navigationTheme, palette, sheetOptions, stackScreenOptions } from "../src/ui/tokens";

void SplashScreen.preventAutoHideAsync();

// iOS keeps the 24-Hour Time switch outside the locale Hermes formats with
// ("3:29 AM" stayed with it on), so times read it from the global defaults.
setHourCycle(
  Settings.get("AppleICUForce24HourTime")
    ? "h23"
    : Settings.get("AppleICUForce12HourTime")
      ? "h12"
      : undefined,
);
// Notification taps open screens by the same rule as links: never inside
// or under a sheet (src/lib/navigation.ts).
setNotificationNavigationGate(afterSheets);
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

  const navigatorReady = fontsLoaded || Boolean(fontError);
  useNavigationForLinks();
  const largeText = useLargeText();
  useEffect(() => {
    if (navigatorReady) void SplashScreen.hideAsync();
  }, [navigatorReady]);

  useEffect(() => {
    void trackAppEvent("app_open");
    // Taps while the app is running.
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

  useEffect(() => {
    setCurrentPath(pathname);
  }, [pathname]);

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

  if (!navigatorReady) return null;

  return (
    <ThemeProvider value={navigationTheme}>
      <LaunchNotificationResponse />
      <Stack
        screenListeners={{
          // A link waits for the sheet it closed to be gone (navigation.ts).
          transitionEnd: (event) => rootTransitionEnded(event.target, event.data.closing),
        }}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen
          name="home"
          options={{ ...stackScreenOptions, headerShown: true, title: "" }}
        />
        {/*
          Nothing belongs behind the tabs, so the edge swipe never pops them
          (it popped a second tab bar that a launch-chain link had stacked).
          They replace Sign In or Set Up without a slide: a launch opens
          straight into them.
        */}
        <Stack.Screen name="(tabs)" options={{ gestureEnabled: false, animation: "none" }} />
        <Stack.Screen name="web/[id]" />
        <Stack.Screen name="apps/[id]" options={sheetOptions} />
        {/*
          A page sheet, not a form sheet: on iPad a form sheet is about
          570 × 650 pt, which put the toolbar over the details and the
          timeline below the fold.
        */}
        <Stack.Screen name="pages/[id]" options={{ ...sheetOptions, presentation: "pageSheet" }} />
        <Stack.Screen name="join/[code]" options={sheetOptions} />
        <Stack.Screen name="critical-alerts" options={sheetOptions} />
        <Stack.Screen
          name="reply/[id]"
          options={{
            ...sheetOptions,
            sheetAllowedDetents: [0.5, 1],
            // From xxxLarge up the request and the focused field don't fit
            // at half height: iOS scrolls the caret into view and
            // the title ends up under the header (checked in the simulator).
            sheetInitialDetentIndex: largeText ? 1 : 0,
            sheetGrabberVisible: true,
            // The sheets' warm grey (from `sheetOptions`) at both heights: on
            // glass at half height the composer sat on blurred thumbnails and
            // green buttons, and at full height the sheet turned white.
          }}
        />
        <Stack.Screen
          name="settings"
          options={{ presentation: "formSheet", sheetAllowedDetents: [1], headerShown: false }}
        />
        <Stack.Screen name="la-lab" />
      </Stack>
    </ThemeProvider>
  );
}

/** The parts of a navigator state this file reads. */
type StackState = { index?: number; routes?: { name: string; state?: unknown }[] } | undefined;

/**
 * True once whatever is on top of the root stack can take a push: the tabs
 * mount their navigators only after their gate passes, and a push into the
 * Inbox stack before that would add a second copy of the tabs.
 */
function rootReady(stack: StackState): boolean {
  const top = stack?.routes?.[stack.index ?? 0];
  if (!top) return false;
  return top.name !== "(tabs)" || Boolean(top.state);
}

/**
 * A cold launch from a notification tap, delivered once there is somewhere
 * to deliver it (each step checked in the simulator): after the Stack has
 * mounted (earlier navigation re-mounts the root layout in a loop), after
 * Sign In's redirects to Set Up and the Inbox (their queued `replace` would
 * replace the pushed screen), and after the tabs' navigators exist. Signed
 * out it goes at once; those screens handle it. Taps while running use the
 * listener in the root layout.
 */
function LaunchNotificationResponse() {
  const { data: session, isPending } = useSession();
  const pathname = usePathname();
  const stack = useRootNavigationState()?.routes?.[0]?.state as StackState;
  const pending = useRef<Notifications.NotificationResponse | null | undefined>(undefined);
  if (pending.current === undefined) {
    pending.current = Notifications.getLastNotificationResponse() ?? null;
    if (pending.current) void Notifications.clearLastNotificationResponseAsync();
  }
  const signedOut = !isPending && !session;
  const ready = signedOut || (pathname !== "/" && pathname !== "/home" && rootReady(stack));
  useEffect(() => {
    const response = pending.current;
    if (!ready || !response) return;
    pending.current = null;
    void handleNotificationResponse(response);
  }, [ready]);
  return null;
}
