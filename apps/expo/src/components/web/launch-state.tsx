import type { AppDto } from "@hark/contracts";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { spoken } from "../../ui/a11y";
import { Button } from "../../ui/button";
import { Text } from "../../ui/text";
import { colors, space } from "../../ui/tokens";
import { AppIcon } from "../app-icon";

/**
 * The web app screen before its page shows (DESIGN.md 5.11): signing in
 * with a Hark pass, or why it couldn't open. Centered on paper, with the
 * same icon the page will replace.
 */

export function SigningInView({ app }: { app: AppDto | null }) {
  const detail = app ? `Getting your Hark pass for ${new URL(app.origin).host}` : "Opening app";
  return (
    <View style={styles.screen}>
      <View
        accessibilityLabel={spoken("Signing you in…", detail)}
        accessibilityLiveRegion="polite"
        accessible
        style={styles.column}
      >
        {app ? <AppIcon iconUrl={app.iconUrl} name={app.name} size={64} /> : null}
        <Text align="center" style={styles.title} variant="title3">
          Signing you in…
        </Text>
        <Text align="center" color="secondaryLabel" variant="subheadline">
          {detail}
        </Text>
        <ActivityIndicator style={styles.spinner} />
      </View>
    </View>
  );
}

export function LaunchErrorView({
  app,
  message,
  onRetry,
  onClose,
}: {
  app: AppDto | null;
  message: string;
  /** Absent when trying again can't help (the app was removed). */
  onRetry?: () => void;
  onClose: () => void;
}) {
  const title = `Couldn't Open ${app?.name ?? "This App"}`;
  return (
    <View style={styles.screen}>
      <View style={styles.column}>
        <View accessibilityLabel={spoken(title, message)} accessible style={styles.copy}>
          {app ? <AppIcon iconUrl={app.iconUrl} name={app.name} size={56} /> : null}
          <Text accessibilityRole="header" align="center" style={styles.title} variant="title2">
            {title}
          </Text>
          <Text align="center" color="secondaryLabel" variant="subheadline">
            {message}
          </Text>
        </View>
        <View style={styles.actions}>
          {onRetry ? (
            <Button onPress={onRetry} size="large" title="Try Again" variant="prominent" />
          ) : null}
          <Button
            onPress={onClose}
            size="large"
            title="Back to Hark"
            variant={onRetry ? "plain" : "prominent"}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xxl,
    backgroundColor: colors.background,
  },
  column: {
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
  },
  copy: {
    alignItems: "center",
  },
  title: {
    marginTop: space.m,
    marginBottom: space.xxs,
  },
  spinner: {
    marginTop: space.l,
  },
  actions: {
    alignSelf: "stretch",
    gap: space.xxs,
    marginTop: space.xl,
  },
});
