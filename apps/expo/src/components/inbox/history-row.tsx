import type { InboxActivityDto } from "@hark/contracts";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { memo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLayout } from "../../lib/layout";
import { spoken } from "../../ui/a11y";
import { SourceAvatar } from "../../ui/avatar";
import { Cell, Chevron, useStackedRows } from "../../ui/list";
import { animateListChange } from "../../ui/motion";
import { Text, useFontScale } from "../../ui/text";
import { colors, metrics, space } from "../../ui/tokens";
import { activityKindLabel, formatActivityTime, isRefusal } from "./format";

export const HISTORY_AVATAR = 30;

/**
 * One past notification, Live Activity or response (DESIGN.md 5.4).
 * Notifications open their detail screen (chevron); Live Activities and
 * responses with a detail expand and collapse on tap; the others are not
 * pressable. At accessibility text sizes titles and meta wrap and the result
 * stacks under the text (3.6, 3.10). On iPad the text keeps the Inbox's
 * reading measure and the result stays on the trailing edge.
 */
export const HistoryRow = memo(function HistoryRow({
  item,
  margin,
}: {
  item: InboxActivityDto;
  /** The plain list's screen margin, so rows line up with the title. */
  margin: number;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const stacked = useStackedRows();
  const wide = useLayout().regular && !stacked;
  const scale = useFontScale();
  // A notification's ID is the detail screen's ("event:…", "notification:…").
  const opens = item.kind === "notification";
  const expandable = !opens && Boolean(item.detail);
  const meta = `${item.sourceName} · ${activityKindLabel(item.kind)} · ${formatActivityTime(item.createdAt)}`;
  // Denied and No are answers, not successes: grey, with a cross.
  const refusal = item.result ? isRefusal(item.result) : false;
  const result = item.result ? (
    <View style={[styles.result, wide && styles.trailingWide]}>
      <SymbolView
        name={refusal ? "xmark" : "checkmark"}
        size={Math.round(12 * scale)}
        tintColor={refusal ? colors.secondaryLabel : colors.accent}
        weight="semibold"
      />
      <Text
        color={refusal ? "secondaryLabel" : "accent"}
        numberOfLines={stacked ? undefined : 1}
        variant="footnote"
      >
        {item.result}
      </Text>
    </View>
  ) : null;
  return (
    <Cell
      accessibilityHint={
        opens
          ? "Shows the notification"
          : expandable
            ? expanded
              ? "Shows less"
              : "Shows the full text"
            : undefined
      }
      accessibilityLabel={spoken(item.title, item.detail, meta, item.result)}
      accessibilityState={expandable ? { expanded } : undefined}
      accessible
      onPress={
        opens
          ? () => router.push({ pathname: "/notification/[id]", params: { id: item.id } })
          : expandable
            ? () => {
                animateListChange();
                setExpanded((current) => !current);
              }
            : undefined
      }
      style={[styles.row, { paddingHorizontal: margin }]}
    >
      <SourceAvatar name={item.sourceName} size={HISTORY_AVATAR} url={item.sourceImageUrl} />
      <View style={[styles.copy, wide && styles.copyWide]}>
        <Text
          numberOfLines={expanded || stacked ? undefined : 1}
          variant="subheadline"
          weight="600"
        >
          {item.title}
        </Text>
        {item.detail ? (
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
      {opens ? (
        <View style={[styles.chevron, wide && !result && styles.trailingWide]}>
          <Chevron />
        </View>
      ) : null}
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
  copyWide: {
    flexGrow: 0,
    flexBasis: metrics.measureWidth,
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xxs,
    paddingTop: 2,
  },
  trailingWide: {
    marginLeft: "auto",
  },
  chevron: {
    alignSelf: "center",
  },
});
