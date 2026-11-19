import type { OncallPageDto } from "@hark/contracts";
import { StyleSheet, View } from "react-native";
import { pageStatusLabel } from "../../lib/teams";
import { Text } from "../../ui/text";
import { type ColorName, colors, radius, space } from "../../ui/tokens";

const HEIGHT = 24;

const PILL: Record<OncallPageDto["status"], { fill: ColorName; text: ColorName }> = {
  triggered: { fill: "dangerSoft", text: "danger" },
  acknowledged: { fill: "accentSoft", text: "accent" },
  resolved: { fill: "fill", text: "secondaryLabel" },
};

/**
 * A page's status capsule (DESIGN.md 5.18): "Open" in danger, "Acknowledged"
 * in accent, "Resolved" in grey. Flat content, never glass.
 */
export function PageStatusPill({ status }: { status: OncallPageDto["status"] }) {
  const tone = PILL[status];
  return (
    <View style={[styles.pill, { backgroundColor: colors[tone.fill] }]}>
      <Text color={tone.text} maxFontSizeMultiplier={1.3} variant="footnote" weight="600">
        {pageStatusLabel({ status })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: HEIGHT,
    justifyContent: "center",
    paddingHorizontal: space.s - 2,
    borderRadius: radius.capsule(HEIGHT),
    borderCurve: "continuous",
  },
});
