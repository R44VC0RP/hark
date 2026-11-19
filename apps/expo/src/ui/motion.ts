import { useSyncExternalStore } from "react";
import { AccessibilityInfo, LayoutAnimation } from "react-native";

/**
 * Motion helpers (DESIGN.md 3.9). The system animates navigation, sheets,
 * menus and scrolling; the app adds one thing: list mutations, where the
 * removed row fades and its neighbours slide into the gap. Never on scroll,
 * never on first paint.
 */

let reduceMotion = false;
const listeners = new Set<() => void>();

void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
  reduceMotion = enabled;
  for (const listener of listeners) listener();
});
AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
  reduceMotion = enabled;
  for (const listener of listeners) listener();
});

/**
 * Call right before the state change that adds, removes or reorders rows
 * (request answered, invite revoked, member removed), from the screen that
 * shows them. With Reduce Motion the row only fades and nothing travels.
 *
 * Never call it from a sheet or screen that is closing in the same tick
 * (`router.back()`): Fabric's LayoutAnimation aborts the app when the next
 * commit also removes that screen (checked in the simulator).
 */
export function animateListChange(): void {
  if (reduceMotion) {
    LayoutAnimation.configureNext({
      duration: 200,
      delete: { type: "linear", property: "opacity" },
    });
    return;
  }
  LayoutAnimation.configureNext({
    duration: 300,
    delete: { type: "easeOut", property: "opacity" },
    update: { type: "spring", springDamping: 1 },
  });
}

/** Whether Reduce Motion is on, for the rare custom highlight that must go static. */
export function useReduceMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => reduceMotion,
  );
}
