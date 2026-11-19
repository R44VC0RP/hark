import { Fragment } from "react";
import { StyleSheet, View } from "react-native";
import { useStackedRows } from "../../ui/list";
import { Text } from "../../ui/text";
import type { ColorName, TextVariant } from "../../ui/tokens";

/**
 * Short facts on one line joined by " · " ("Platform primary · 4 min ago").
 * The line never wraps, so a separator can't end or start a line (V-06):
 * one fact (`shrink`, the first by default) gives way with "…" when the row
 * is too narrow and the others stay whole. At accessibility sizes each fact
 * gets its own line instead, without separators. Put anything long or a
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
  if (stacked) {
    return (
      <Fragment>
        {facts.map((fact) => (
          <Text color={color} key={fact} variant={variant}>
            {fact}
          </Text>
        ))}
      </Fragment>
    );
  }
  return (
    <View style={styles.line}>
      {facts.map((fact, index) => (
        <Text
          color={color}
          key={fact}
          numberOfLines={1}
          style={index === shrink ? styles.shrink : styles.whole}
          variant={variant}
        >
          {index === 0 ? fact : ` · ${fact}`}
        </Text>
      ))}
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
});
