import * as AppleAuthentication from "expo-apple-authentication";
import { Redirect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { trackAppEvent } from "../src/lib/analytics";
import { signInWithApple } from "../src/lib/apple-auth";
import { authClient, useSession } from "../src/lib/auth";
import { colors, fonts, tightTracking } from "../src/lib/theme";

export default function SignInScreen() {
  const { data: session, isPending } = useSession();
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep the sign-in screen mounted until the native authorization code is
  // exchanged and its revocation token is safely stored server-side.
  if (session && busy !== "apple") return <Redirect href="/home" />;

  const signInWithGoogle = async () => {
    setBusy("google");
    setError(null);
    try {
      void trackAppEvent("auth_started", { path: "/", properties: { provider: "google" } });
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/home" });
      if (result.error) throw new Error(result.error.message ?? "Google sign-in failed");
      void trackAppEvent("auth_completed", { path: "/home", properties: { provider: "google" } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
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
      setError(err instanceof Error ? err.message : "Apple sign-in failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.brandMark} />
        <Text style={styles.brand}>Hark</Text>
      </View>

      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Webhooks to iPhone</Text>
        <Text style={styles.title}>Let the important things find you.</Text>
        <Text style={styles.subtitle}>
          Sign in to receive source-branded notifications from every service you connect.
        </Text>
      </View>

      <View style={styles.footer}>
        {isPending ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <AppleAuthentication.AppleAuthenticationButton
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              cornerRadius={26}
              onPress={() => {
                if (!busy) void continueWithApple();
              }}
              style={[styles.appleButton, busy && styles.buttonDisabled]}
            />
            {busy === "apple" ? (
              <ActivityIndicator color={colors.ink} style={styles.appleSpinner} />
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={signInWithGoogle}
              disabled={busy !== null}
              style={({ pressed }) => [
                styles.googleButton,
                (pressed || busy !== null) && styles.googleButtonPressed,
              ]}
            >
              {busy === "google" ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.googleButtonText}>Continue with Google</Text>
              )}
            </Pressable>
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    backgroundColor: colors.paper,
  },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandMark: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  brand: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 18,
    letterSpacing: tightTracking(18),
  },
  hero: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  eyebrow: {
    marginBottom: 14,
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tightTracking(12),
    textTransform: "uppercase",
  },
  title: {
    maxWidth: 330,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: tightTracking(40),
  },
  subtitle: {
    maxWidth: 330,
    marginTop: 20,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: tightTracking(16),
  },
  footer: {
    paddingBottom: 16,
    gap: 10,
  },
  googleButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 26,
    backgroundColor: colors.accent,
  },
  appleButton: {
    width: "100%",
    height: 52,
  },
  appleSpinner: {
    position: "absolute",
    top: 17,
    alignSelf: "center",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  googleButtonPressed: {
    backgroundColor: colors.accentPressed,
    transform: [{ scale: 0.98 }],
  },
  googleButtonText: {
    color: "#FFFFFF",
    fontFamily: fonts.medium,
    fontSize: 16,
    letterSpacing: tightTracking(16),
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
});
