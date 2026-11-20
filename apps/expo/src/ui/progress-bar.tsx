import { StyleSheet, View } from "react-native";
import { colors } from "./tokens";

const HEIGHT = 4;

/** A flat 4-pt progress track (DESIGN.md 4): accent fill on `fill`, no motion. */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    overflow: "hidden",
    borderRadius: HEIGHT / 2,
    backgroundColor: colors.fill,
  },
  fill: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    backgroundColor: colors.accent,
  },
});
