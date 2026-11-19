import { StyleSheet, View } from "react-native";
import { type ColorName, colors } from "./tokens";

/**
 * A small status dot (DESIGN.md 3.10): on call, open page, delivery status.
 * Decorative only: the text next to it always says the status too.
 */
export function StatusDot({ color, size = 10 }: { color: ColorName; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors[color] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    flexShrink: 0,
  },
});
