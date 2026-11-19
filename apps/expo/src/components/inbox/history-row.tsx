import type { InboxActivityDto } from "@hark/contracts";
import { SymbolView } from "expo-symbols";
import { memo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { spoken } from "../../ui/a11y";
import { SourceAvatar } from "../../ui/avatar";
import { Cell, useStackedRows } from "../../ui/list";
import { animateListChange } from "../../ui/motion";
import { Text } from "../../ui/text";
import { colors, space } from "../../ui/tokens";
import { activityKindLabel, formatActivityTime } from "./format";

export const HISTORY_AVATAR = 30;

/**
 * One past notification, Live Activity or response (DESIGN.md 5.4). Rows
 * with a detail expand and collapse on tap; the others are not pressable.
 * At accessibility text sizes titles and meta wrap and the result stacks
 * under the text (3.6, 3.10).
 */
export const HistoryRow = memo(function HistoryRow({
  item,
  margin,
}: {
  item: InboxActivityDto;
  /** The plain list's screen margin, so rows line up with the title. */
  margin: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const stacked = useStackedRows();
  const expandable = Boolean(item.detail);
  const meta = `${item.sourceName} · ${activityKindLabel(item.kind)} · ${formatActivityTime(item.createdAt)}`;
  const result = item.result ? (
    <View style={styles.result}>
      <SymbolView name="checkmark" size={12} tintColor={colors.accent} weight="semibold" />
      <Text color="accent" numberOfLines={stacked ? undefined : 1} variant="footnote">
        {item.result}
      </Text>
    </View>
  ) : null;
  return (
    <Cell
      accessibilityHint={expandable ? (expanded ? "Shows less" : "Shows the full text") : undefined}
      accessibilityLabel={spoken(item.title, item.detail, meta, item.result)}
      accessibilityState={expandable ? { expanded } : undefined}
      accessible
      onPress={
        expandable
          ? () => {
              animateListChange();
              setExpanded((current) => !current);
            }
          : undefined
      }
      style={[styles.row, { paddingHorizontal: margin }]}
    >
      <SourceAvatar name={item.sourceName} size={HISTORY_AVATAR} url={item.sourceImageUrl} />
      <View style={styles.copy}>
        <Text
          numberOfLines={expanded || stacked ? undefined : 1}
          variant="subheadline"
          weight="600"
        >
          {item.title}
        </Text>
        {expandable ? (
          <Text
            color="secondaryLabel"
            numberOfLines={expanded ? undefined : stacked ? 2 : 1}
            variant="subheadline"
          >
            {item.detail}
          </Text>
        ) : null}
        <Text color="tertiaryLabel" numberOfLines={stacked ? undefined : 1} variant="footnote">
          {meta}
        </Text>
        {stacked ? result : null}
      </View>
      {stacked ? null : result}
    </Cell>
  );
});

const styles = StyleSheet.create({
  row: {
    alignItems: "flex-start",
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xxs,
    paddingTop: 2,
  },
});
