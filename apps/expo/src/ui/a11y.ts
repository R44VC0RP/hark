import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Builds a row's VoiceOver label from its visible parts (DESIGN.md 3.10):
 * parts become sentences without doubling the punctuation they already have,
 * and the label itself ends without a period, like system labels.
 * `spoken("Deploy?", "Staging is green.", "GitHub Actions")` →
 * "Deploy? Staging is green. GitHub Actions"
 */
export function spoken(...parts: (string | null | undefined | false)[]): string {
  const sentences = parts.map((part) => (part ? part.trim() : "")).filter(Boolean);
  return sentences
    .map((part, index) =>
      index === sentences.length - 1 || /[.!?…:]$/.test(part) ? part : `${part}.`,
    )
    .join(" ");
}

let screenReader = false;
const screenReaderListeners = new Set<() => void>();
function setScreenReader(enabled: boolean) {
  if (enabled === screenReader) return;
  screenReader = enabled;
  for (const listener of screenReaderListeners) listener();
}
void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);

/** Whether VoiceOver is running; re-renders when it is turned on or off. */
export function useScreenReader(): boolean {
  return useSyncExternalStore(
    (listener) => {
      screenReaderListeners.add(listener);
      return () => {
        screenReaderListeners.delete(listener);
      };
    },
    () => screenReader,
  );
}
