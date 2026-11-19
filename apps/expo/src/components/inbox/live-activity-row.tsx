import type { InboxLiveActivityDto } from "@hark/contracts";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { spoken } from "../../ui/a11y";
import { SourceAvatar } from "../../ui/avatar";
import { Cell, useStackedRows, useTextMeasure } from "../../ui/list";
import { ProgressBar } from "../../ui/progress-bar";
import { Text } from "../../ui/text";
import { metrics, space } from "../../ui/tokens";

const AVATAR = 32;

/** A Live Activity in progress (DESIGN.md 5.3): who, what, how far. Not pressable. */
export const LiveActivityRow = memo(function LiveActivityRow({
  item,
}: {
  item: InboxLiveActivityDto;
}) {
  const stacked = useStackedRows();
  // Wide windows: the text keeps the measure, and the bar runs on under it to
  // the percent on the row's trailing edge, where requests and projects keep
  // theirs (3.6). A bar capped at the measure left "62%" 450 pt from its end
  // (V2-04).
  const measure = useTextMeasure();
  const wide = measure !== null;
  const progress = item.props.progress;
  const percent = progress !== undefined ? Math.round(progress * 100) : null;
  const detail = `${item.sourceName} · ${item.props.detail ?? item.props.status}`;
  const percentText = (
    <Text color="accent" tabular variant="subheadline" weight="600">
      {`${percent}%`}
    </Text>
  );
  return (
    <Cell
      accessibilityLabel={spoken(
        item.props.title,
        detail,
        percent !== null && `${percent} percent`,
      )}
      accessible
      minHeight={metrics.rowMinHeightSubtitle}
      separatorInset={metrics.rowPaddingHorizontal + AVATAR + metrics.rowAccessoryGap}
    >
      <SourceAvatar name={item.sourceName} size={AVATAR} url={item.sourceImageUrl} />
      <View style={styles.copy}>
        <View style={[styles.text, measure]}>
          <View style={styles.titleLine}>
            <Text
              numberOfLines={stacked ? undefined : 2}
              style={styles.title}
              variant="body"
              weight="600"
            >
              {item.props.title}
            </Text>
            {percent !== null && !wide ? percentText : null}
          </View>
          <Text color="secondaryLabel" numberOfLines={stacked ? 2 : 1} variant="subheadline">
            {detail}
          </Text>
        </View>
        {progress !== undefined ? (
          <View style={styles.progress}>
            <View style={styles.bar}>
              <ProgressBar value={progress} />
            </View>
            {percent !== null && wide ? percentText : null}
          </View>
        ) : null}
      </View>
    </Cell>
  );
});

const styles = StyleSheet.create({
  copy: {
    minWidth: 0,
    flex: 1,
  },
  text: {
    gap: 2,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space.xs,
  },
  title: {
    flex: 1,
  },
  progress: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    marginTop: space.xs,
  },
  bar: {
    flex: 1,
  },
});
