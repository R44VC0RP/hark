import * as Haptics from "expo-haptics";
import { Alert } from "react-native";

/**
 * The app's three haptics (DESIGN.md 3.9). `success` after a request answer,
 * a sent reply, a page acknowledged, escalated or resolved, a team joined or
 * an invite link created; `warning` on "Already acknowledged"; `error` with
 * any failure alert. Never on navigation, scrolling or menus: the system
 * already does those.
 */
function notify(type: Haptics.NotificationFeedbackType): void {
  void Haptics.notificationAsync(type).catch(() => {});
}

export const haptic = {
  success: () => notify(Haptics.NotificationFeedbackType.Success),
  warning: () => notify(Haptics.NotificationFeedbackType.Warning),
  error: () => notify(Haptics.NotificationFeedbackType.Error),
};

/** What went wrong: the server's message, else the network fallback. */
export function failureText(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : "Check your connection, then try again.";
}

/** A failed action: the error haptic and an alert saying what went wrong (3.9). */
export function alertFailure(title: string, cause: unknown): void {
  haptic.error();
  Alert.alert(title, failureText(cause));
}
