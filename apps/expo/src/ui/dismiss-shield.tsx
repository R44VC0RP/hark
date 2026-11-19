import { useFocusEffect } from "expo-router";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { ActionSheetIOS, type ActionSheetIOSOptions, StyleSheet, View } from "react-native";

/**
 * The one guard for menus and popovers opened from a screen's content
 * (DESIGN.md 3.12, I-07). In Hark, the tap that closes a menu, a context
 * menu or an iPad popover also reaches the React Native view under the
 * finger (beside a member's menu it opened an on-call group). Apple's own
 * apps don't do that (Files on the same simulator: the tap only closes the
 * menu), so while a menu is up a clear view covers the screen's content and
 * takes that tap.
 *
 * Fail-safe: a tap on the shield always removes it, and leaving the screen
 * does too, so a close the app never hears about costs one tap, never a
 * covered screen. Menus also lower it when an item is chosen, action sheets
 * when their callback runs.
 *
 * Render `DismissShield` once per screen around its content (it adds no
 * wrapper view, so the list stays the screen's first child). Content menus
 * raise it through `RowMenu`, `MenuLink` and `useActionSheet`. Toolbar
 * menus open natively without telling JavaScript, so they can't.
 */
export interface Shield {
  raised: boolean;
  raise: () => void;
  lower: () => void;
}

/** A screen's shield state, for a screen that opens menus itself (`useActionSheet(shield)`). */
export function useShield(): Shield {
  const [raised, setRaised] = useState(false);
  // Stable, so the focus effect below never lowers it on a re-render.
  const raise = useCallback(() => setRaised(true), []);
  const lower = useCallback(() => setRaised(false), []);
  return useMemo(() => ({ raised, raise, lower }), [raised, raise, lower]);
}

const ShieldContext = createContext<Pick<Shield, "raise" | "lower"> | null>(null);

export function DismissShield({ shield, children }: { shield?: Shield; children: ReactNode }) {
  const own = useShield();
  const current = shield ?? own;
  const { raise, lower } = current;
  // Leaving the screen (a preview opened, a menu item pushed) takes it down.
  useFocusEffect(useCallback(() => lower, [lower]));
  const controls = useMemo(() => ({ raise, lower }), [raise, lower]);
  return (
    <ShieldContext.Provider value={controls}>
      {children}
      {current.raised ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onResponderRelease={lower}
          onResponderTerminate={lower}
          onStartShouldSetResponder={() => true}
          style={styles.shield}
        />
      ) : null}
    </ShieldContext.Provider>
  );
}

const NO_SHIELD = { raise: () => {}, lower: () => {} };

/** The enclosing screen's shield; does nothing outside `DismissShield`. */
export function useDismissShield(): Pick<Shield, "raise" | "lower"> {
  return useContext(ShieldContext) ?? NO_SHIELD;
}

/**
 * Shows an action sheet (an anchored popover on iPad) with the shield up
 * until its callback runs, which it does for every way it closes. Pass the
 * screen's own `useShield()` when the screen renders the `DismissShield`
 * itself; otherwise the enclosing one is used.
 */
export function useActionSheet(
  shield?: Pick<Shield, "raise" | "lower">,
): (options: ActionSheetIOSOptions, onSelect: (index: number) => void) => void {
  const enclosing = useDismissShield();
  const { raise, lower } = shield ?? enclosing;
  return useCallback(
    (options, onSelect) => {
      raise();
      ActionSheetIOS.showActionSheetWithOptions(options, (index) => {
        lower();
        onSelect(index);
      });
    },
    [lower, raise],
  );
}

const styles = StyleSheet.create({
  shield: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
  },
});
