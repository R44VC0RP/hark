import { type ReactNode, useCallback, useState } from "react";
import {
  ActionSheetIOS,
  type ActionSheetIOSOptions,
  StyleSheet,
  View,
} from "react-native";

/**
 * Shows an action sheet and, while it is up, a transparent view over the
 * screen's content (`shield`, render it last). On iPad the sheet is a
 * popover, and a tap outside it closes it and also reaches whatever is under
 * the finger (checked on iPadOS 27.2: a row under it opened; the system's own
 * menus behave the same). The shield takes that tap, so nothing underneath
 * reacts. The sheet's callback, which runs for every way it closes, removes
 * the shield.
 */
export function useActionSheet(): {
  show: (options: ActionSheetIOSOptions, onSelect: (index: number) => void) => void;
  shield: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const show = useCallback(
    (options: ActionSheetIOSOptions, onSelect: (index: number) => void) => {
      setOpen(true);
      ActionSheetIOS.showActionSheetWithOptions(options, (index) => {
        setOpen(false);
        onSelect(index);
      });
    },
    [],
  );
  const shield = open ? (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.shield}
    />
  ) : null;
  return { show, shield };
}

const styles = StyleSheet.create({
  shield: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
  },
});
