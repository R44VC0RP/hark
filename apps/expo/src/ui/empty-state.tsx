import { type SFSymbol, SymbolView } from "expo-symbols";
import { ActivityIndicator, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { ApiError } from "../lib/api-error";
import { spoken } from "./a11y";
import { Button } from "./button";
import { Text } from "./text";
import { colors, space } from "./tokens";

/**
 * Empty, loading and error states (DESIGN.md 3.8). They sit inside the
 * screen's `List`, never replace it, so the large title, refresh control and
 * glass header keep working. Titles are title case and name the thing
 * ("No Unread Notifications"); messages are sentences.
 */

export interface EmptyStateProps {
  symbol: SFSymbol;
  title: string;
  message?: string;
  /** One optional action, shown as a regular prominent button. */
  actionTitle?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Mirrors SwiftUI's `ContentUnavailableView`: symbol, title, message, optional action. */
export function EmptyState({
  symbol,
  title,
  message,
  actionTitle,
  onAction,
  style,
}: EmptyStateProps) {
  return (
    <View style={[styles.empty, style]}>
      <View accessible accessibilityLabel={spoken(title, message)}>
        <View style={styles.symbol}>
          <SymbolView
            name={symbol}
            size={44}
            tintColor={colors.secondaryLabel}
            type="hierarchical"
          />
        </View>
        <Text accessibilityRole="header" align="center" variant="title2">
          {title}
        </Text>
        {message ? (
          <Text align="center" color="secondaryLabel" style={styles.message} variant="subheadline">
            {message}
          </Text>
        ) : null}
      </View>
      {actionTitle && onAction ? (
        <Button onPress={onAction} style={styles.action} title={actionTitle} variant="prominent" />
      ) : null}
    </View>
  );
}

/** First load only: a grey system spinner 120 pt below the header. */
export function LoadingState() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator accessibilityLabel="Loading" />
    </View>
  );
}

/** True for failures to reach the server at all (no response). */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiError) return false;
  return error instanceof TypeError || (error instanceof Error && /network/i.test(error.message));
}

/** A load failed with nothing on screen: "Check your connection, then try again." */
export function ErrorState({
  title,
  network,
  onRetry,
  style,
}: {
  title: string;
  /** Network failures use `wifi.exclamationmark`. */
  network?: boolean;
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <EmptyState
      actionTitle="Try Again"
      message="Check your connection, then try again."
      onAction={onRetry}
      style={style}
      symbol={network ? "wifi.exclamationmark" : "exclamationmark.triangle"}
      title={title}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    paddingHorizontal: space.m,
    paddingVertical: 64,
  },
  symbol: {
    alignItems: "center",
    marginBottom: space.s,
  },
  message: {
    maxWidth: 320,
    marginTop: space.xxs,
    alignSelf: "center",
  },
  action: {
    marginTop: space.m,
  },
  loading: {
    alignItems: "center",
    paddingTop: 120,
  },
});
