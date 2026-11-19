import * as Haptics from "expo-haptics";

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
