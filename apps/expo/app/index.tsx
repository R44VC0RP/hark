import * as AppleAuthentication from "expo-apple-authentication";
import * as Device from "expo-device";
import { Redirect } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isDeviceSetUp, registerThisDevice } from "../src/lib/account";
import { trackAppEvent } from "../src/lib/analytics";
import { signInWithApple } from "../src/lib/apple-auth";
import { authClient, useSession } from "../src/lib/auth";
import { Text } from "../src/ui/text";
import { colors, radius, space } from "../src/ui/tokens";

/** Both sign-in buttons: 50 pt capsules, like the system's own. */
const BUTTON_HEIGHT = 50;
/**
 * Apple's button draws its capsule 1 pt inside its frame (measured: 48 pt in
 * a 50 pt frame), so its frame is 2 pt taller and overlaps its margins by
 * 1 pt: both buttons then show the same 50 pt capsule 12 pt apart.
 */
const APPLE_INSET = 1;
/**
 * Apple's label is about 19 pt medium at this height (measured); Google's
 * matches it so the pair reads as one set.
 */
const LABEL_SIZE = 19;
/** How far the "Hark" wordmark grows with Dynamic Type next to its fixed dot. */
const WORDMARK_MAX_SCALE = 1.4;
/** The sign-in column on iPad and other wide windows. */
const COLUMN_WIDTH = 480;
const simulatorPreview = __DEV__ && !Device.isDevice;

/**
 * What a failed sign-in says. Native errors (they carry an `ERR_…` code)
 * read like "RequestUnknownException: … (at …swift:61)", so they get a plain
 * sentence; messages from the server are already written for people.
 */
function signInError(error: unknown, provider: "Apple" | "Google"): string {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  if (typeof code === "string" && code.startsWith("ERR_")) {
    return `Couldn’t sign in with ${provider}. Try again.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return `Couldn’t sign in with ${provider}. Try again.`;
}

/**
 * Where a signed-in launch goes: straight to the Inbox when this device
 * finished Set Up (registered, notifications allowed), refreshing its
 * registration in the background as Set Up did on every launch; to Set Up
 * otherwise. `undefined` while it reads the device's state.
 */
function useSignedInRoute(signedIn: boolean): "/inbox" | "/home" | undefined {
  const [route, setRoute] = useState<"/inbox" | "/home">();
  useEffect(() => {
    if (!signedIn) return;
    if (simulatorPreview) {
      setRoute("/inbox");
      return;
    }
    let current = true;
    void isDeviceSetUp()
      .catch(() => false)
      .then((setUp) => {
        if (!current) return;
        if (setUp) void registerThisDevice().catch(() => {});
        setRoute(setUp ? "/inbox" : "/home");
      });
    return () => {
      current = false;
    };
  }, [signedIn]);
  return signedIn ? route : undefined;
}

/**
 * Sign In (DESIGN.md 5.1), the first screen anyone sees: the wordmark, one
 * line about what Hark does, and Apple and Google sign-in at the bottom.
 * Apple's button leads; Google is the bordered secondary button. Inter Tight
 * is Hark's voice here; everything else is the system font.
 */
export default function SignInScreen() {
  const { data: session, isPending } = useSession();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollView = useRef<ScrollView>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // The message runs under the pinned buttons (the largest text sizes on
  // small iPhones): a hairline marks the edge and the indicator flashes once.
  const scrollable = viewportHeight > 0 && contentHeight > viewportHeight + 1;
  useEffect(() => {
    if (scrollable) scrollView.current?.flashScrollIndicators();
  }, [scrollable]);

  // VoiceOver reads a failure without moving focus (iOS ignores
  // `accessibilityLiveRegion`, which only Android supports).
  useEffect(() => {
    if (error) AccessibilityInfo.announceForAccessibility(error);
  }, [error]);

  const signedInRoute = useSignedInRoute(Boolean(session));

  // Keep the sign-in screen mounted until the native authorization code is
  // exchanged and its revocation token is safely stored server-side.
  if (session && busy !== "apple") {
    // Nothing is drawn while the route is decided (a few milliseconds).
    return signedInRoute ? <Redirect href={signedInRoute} /> : <View style={styles.screen} />;
  }

  const signInWithGoogle = async () => {
    setBusy("google");
    setError(null);
    try {
      void trackAppEvent("auth_started", { path: "/", properties: { provider: "google" } });
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/home" });
      if (result.error) throw new Error(result.error.message ?? "");
      void trackAppEvent("auth_completed", { path: "/home", properties: { provider: "google" } });
    } catch (err) {
      setError(signInError(err, "Google"));
    } finally {
      setBusy(null);
    }
  };

  const continueWithApple = async () => {
    setBusy("apple");
    setError(null);
    try {
      void trackAppEvent("auth_started", { path: "/", properties: { provider: "apple" } });
      const result = await signInWithApple();
      if (result === "signed-in") {
        void trackAppEvent("auth_completed", { path: "/home", properties: { provider: "apple" } });
      }
    } catch (err) {
      setError(signInError(err, "Apple"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.screen}>
      {/*
        Only the wordmark and the message scroll; the sign-in buttons stay
        pinned above the bottom safe area, as on Apple's own welcome screens,
        so at the largest text sizes they are never below the first screen
        with nothing hinting they are there (SS-01).
      */}
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        contentInsetAdjustmentBehavior="never"
        onContentSizeChange={(_, height) => setContentHeight(height)}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        ref={scrollView}
        style={styles.scroll}
      >
        <View
          accessibilityLabel="Hark"
          accessibilityRole="header"
          accessible
          style={styles.wordmark}
        >
          <View style={styles.dot} />
          {/* The dot doesn't scale, so the wordmark grows only so far. */}
          <Text maxFontSizeMultiplier={WORDMARK_MAX_SCALE} variant="brandMark">
            Hark
          </Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.headline} variant="brandHero">
            Let the important things find you.
          </Text>
          <Text
            color="secondaryLabel"
            lineBreakStrategyIOS="standard"
            style={styles.message}
            variant="body"
          >
            Sign in to receive source-branded notifications from every service you connect.
          </Text>
        </View>
      </ScrollView>
      <View
        style={[
          styles.footer,
          scrollable && styles.footerEdge,
          { paddingBottom: insets.bottom + space.m },
        ]}
      >
        {/*
          The error sits above the buttons, where the hero's flexible space
          absorbs it, so the buttons never move under a finger.
        */}
        {error ? (
          <Text
            accessibilityLiveRegion="polite"
            align="center"
            color="danger"
            lineBreakStrategyIOS="standard"
            style={styles.error}
            variant="footnote"
          >
            {error}
          </Text>
        ) : null}
        {isPending ? (
          <View style={styles.pending}>
            <ActivityIndicator accessibilityLabel="Loading" />
          </View>
        ) : (
          <>
            <View style={busy !== null && busy !== "apple" ? styles.disabled : null}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                cornerRadius={radius.capsule(BUTTON_HEIGHT)}
                onPress={() => {
                  if (!busy) void continueWithApple();
                }}
                style={styles.appleButton}
              />
              {busy === "apple" ? (
                // The native button can't show progress: cover its label
                // with the same black capsule and a white spinner.
                <View
                  accessibilityLabel="Signing in with Apple"
                  accessible
                  pointerEvents="none"
                  style={styles.appleBusy}
                >
                  <ActivityIndicator color={colors.onAccent} />
                </View>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel={busy === "google" ? "Signing in with Google" : undefined}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy !== null, busy: busy === "google" }}
              disabled={busy !== null}
              onPress={() => void signInWithGoogle()}
              style={({ pressed }) => [
                styles.googleButton,
                pressed && styles.googlePressed,
                busy !== null && busy !== "google" && styles.disabled,
              ]}
            >
              {busy === "google" ? (
                <ActivityIndicator />
              ) : (
                <Text
                  align="center"
                  maxFontSizeMultiplier={1.3}
                  style={styles.googleLabel}
                  variant="headline"
                  weight="500"
                >
                  Continue with Google
                </Text>
              )}
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const column = {
  width: "100%",
  maxWidth: COLUMN_WIDTH,
  alignSelf: "center",
} as const;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
  },
  wordmark: {
    ...column,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  hero: {
    ...column,
    flex: 1,
    justifyContent: "center",
    paddingVertical: space.xxxl,
  },
  headline: {
    maxWidth: 340,
  },
  message: {
    marginTop: space.m,
  },
  footer: {
    ...column,
    maxWidth: COLUMN_WIDTH + space.xl * 2,
    gap: space.s,
    paddingTop: space.m,
    paddingHorizontal: space.xl,
  },
  footerEdge: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  pending: {
    minHeight: BUTTON_HEIGHT * 2 + space.s,
    alignItems: "center",
    justifyContent: "center",
  },
  appleButton: {
    width: "100%",
    height: BUTTON_HEIGHT + APPLE_INSET * 2,
    marginVertical: -APPLE_INSET,
  },
  appleBusy: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.capsule(BUTTON_HEIGHT),
    borderCurve: "continuous",
    backgroundColor: "#000000",
  },
  googleButton: {
    minHeight: BUTTON_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.l,
    paddingVertical: space.s,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: radius.capsule(BUTTON_HEIGHT),
    borderCurve: "continuous",
    backgroundColor: colors.cell,
  },
  googleLabel: {
    fontSize: LABEL_SIZE,
    lineHeight: LABEL_SIZE + 5,
  },
  googlePressed: {
    backgroundColor: colors.fillPressed,
  },
  disabled: {
    opacity: 0.4,
  },
  error: {
    paddingHorizontal: space.m,
  },
});
