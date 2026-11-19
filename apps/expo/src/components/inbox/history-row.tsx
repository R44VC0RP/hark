import type { InboxActivityDto } from "@hark/contracts";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { memo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { formatListDate } from "../../lib/dates";
import { spoken } from "../../ui/a11y";
import { SourceAvatar } from "../../ui/avatar";
import { Cell, Chevron, useLargeText, useStackedRows, useTextMeasure } from "../../ui/list";
import { animateListChange } from "../../ui/motion";
import { Text, useFontScale } from "../../ui/text";
import { colors, space } from "../../ui/tokens";
import { activityKindLabel, isRefusal } from "./format";

export const HISTORY_AVATAR = 30;

/**
 * One past notification, Live Activity or response (DESIGN.md 5.4).
 * Notifications open their detail screen (chevron); Live Activities and
 * responses with a detail expand and collapse on tap; the others are not
 * pressable. At accessibility text sizes titles and meta wrap and the result
 * stacks under the text (3.6, 3.10). On wide windows the text keeps the
 * measure and the result stays on the trailing edge (3.6).
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
  // From xxxLarge the meta line wraps: one line cut its only date (V2-07).
  const largeText = useLargeText();
  const measure = useTextMeasure();
  const scale = useFontScale();
  // A notification's ID is the detail screen's ("event:…", "notification:…").
  const opens = item.kind === "notification";
  const expandable = !opens && Boolean(item.detail);
  const source = `${item.sourceName} · ${activityKindLabel(item.kind)}`;
  const time = formatListDate(item.createdAt);
  const meta = `${source} · ${time}`;
  // Only answers wear a mark: ✓ in accent, or ✕ in grey for Denied and No.
  // A Live Activity's "Started" or "Updated" is plain grey text (V2-10).
  const answer = item.kind === "response";
  const refusal = item.result ? isRefusal(item.result) : false;
  const result = item.result ? (
    <View style={styles.result}>
      {answer ? (
        <SymbolView
          name={refusal ? "xmark" : "checkmark"}
          size={Math.round(12 * scale)}
          tintColor={refusal ? colors.secondaryLabel : colors.accent}
          weight="semibold"
        />
      ) : null}
      <Text
        color={answer && !refusal ? "accent" : "secondaryLabel"}
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
      <View style={[styles.copy, measure]}>
        <Text
          // Two lines from xxxLarge (R-02: titles beside the result were cut).
          numberOfLines={expanded || stacked ? undefined : largeText ? 2 : 1}
          variant="subheadline"
          weight="600"
        >
          {item.title}
        </Text>
        {item.detail ? (
          <Text
            color="secondaryLabel"
            numberOfLines={expanded ? undefined : stacked || largeText ? 2 : 1}
            variant="subheadline"
          >
            {item.detail}
          </Text>
        ) : null}
        {stacked || largeText ? (
          <Text color="tertiaryLabel" variant="footnote">
            {meta}
          </Text>
        ) : (
          // One line: the source and kind give way, the time never does
          // (on a 375-pt iPhone a trailing result cut it to "11:2…", V2-07).
          <View style={styles.metaLine}>
            <Text
              color="tertiaryLabel"
              numberOfLines={1}
              style={styles.metaSource}
              variant="footnote"
            >
              {source}
            </Text>
            <Text color="tertiaryLabel" numberOfLines={1} tabular variant="footnote">
              {` · ${time}`}
            </Text>
          </View>
        )}
        {stacked ? result : null}
      </View>
      {stacked ? null : result}
      {opens ? (
        <View style={styles.chevron}>
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
  metaLine: {
    flexDirection: "row",
    minWidth: 0,
  },
  metaSource: {
    minWidth: 0,
    flexShrink: 1,
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xxs,
    paddingTop: 2,
  },
  chevron: {
    alignSelf: "center",
  },
});
