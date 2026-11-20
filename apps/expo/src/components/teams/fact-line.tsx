import { Fragment, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { useStackedRows } from "../../ui/list";
import { Text, useFontScale } from "../../ui/text";
import type { ColorName, TextVariant } from "../../ui/tokens";

/**
 * Short facts on one line joined by " · " (`Platform primary · 4 min ago`).
 * The line never wraps, so a separator can't end or start a line (V-06).
 * When the facts don't fit side by side (accessibility sizes, or a narrow
 * iPhone at larger text, where a cut name or time was the fact that mattered:
 * "Member · from Maya Lindq…", SS-09), each fact gets its own line instead,
 * without separators, and nothing is cut. Invisible copies of the facts
 * report their widths to decide. Until they have, `shrink` (the first by
 * default) is the fact that gives way with "…". Put anything long or a
 * sentence ("Acknowledged by Priya Shah") on its own line, not in here.
 */
export function FactLine({
  facts,
  shrink = 0,
  variant = "subheadline",
  color = "secondaryLabel",
}: {
  facts: string[];
  shrink?: number;
  variant?: TextVariant;
  color?: ColorName;
}) {
  const stacked = useStackedRows();
  const fontScale = useFontScale();
  const parts = facts.map((fact, index) => (index === 0 ? fact : ` · ${fact}`));
  const [room, setRoom] = useState(0);
  // Widths of the parts as measured for this text size; a new size measures again.
  const [widths, setWidths] = useState<{ scale: number; values: Record<string, number> }>({
    scale: fontScale,
    values: {},
  });
  const onPartLayout = (part: string) => (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setWidths((current) =>
      current.scale !== fontScale
        ? { scale: fontScale, values: { [part]: width } }
        : current.values[part] === width
          ? current
          : { scale: fontScale, values: { ...current.values, [part]: width } },
    );
  };
  let needed = 0;
  for (const part of parts) needed += widths.values[part] ?? Number.POSITIVE_INFINITY;
  const measured = room > 0 && widths.scale === fontScale && Number.isFinite(needed);
  const overflows = measured && needed > room + 0.5;

  if (stacked || overflows) {
    return (
      <Fragment>
        {facts.map((fact) => (
          <Text color={color} key={fact} variant={variant}>
            {fact}
          </Text>
        ))}
        {stacked ? null : measure(parts, variant, color, onPartLayout, setRoom)}
      </Fragment>
    );
  }
  return (
    <View style={styles.line}>
      {parts.map((part, index) => (
        <Text
          color={color}
          key={part}
          numberOfLines={1}
          style={index === shrink ? styles.shrink : styles.whole}
          variant={variant}
        >
          {part}
        </Text>
      ))}
      {measure(parts, variant, color, onPartLayout, setRoom)}
    </View>
  );
}

/**
 * The invisible copies: one line each, laid out without a width limit, plus
 * a full-width probe for the room the line has.
 */
function measure(
  parts: string[],
  variant: TextVariant,
  color: ColorName,
  onPartLayout: (part: string) => (event: LayoutChangeEvent) => void,
  setRoom: (width: number) => void,
) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setRoom(event.nativeEvent.layout.width)}
      pointerEvents="none"
      style={styles.measure}
    >
      <View style={styles.measureRow}>
        {parts.map((part) => (
          <Text
            color={color}
            key={part}
            numberOfLines={1}
            onLayout={onPartLayout(part)}
            variant={variant}
          >
            {part}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: "row",
    minWidth: 0,
  },
  shrink: {
    minWidth: 0,
    flexShrink: 1,
  },
  whole: {
    flexShrink: 0,
  },
  measure: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 0,
    overflow: "hidden",
    opacity: 0,
  },
  measureRow: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 4096,
    flexDirection: "row",
    alignItems: "flex-start",
  },
});
