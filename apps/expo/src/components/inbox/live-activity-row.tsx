import type { InboxLiveActivityDto } from "@hark/contracts";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { spoken } from "../../ui/a11y";
import { SourceAvatar } from "../../ui/avatar";
import { Cell } from "../../ui/list";
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
  const progress = item.props.progress;
  const percent = progress !== undefined ? Math.round(progress * 100) : null;
  const detail = `${item.sourceName} · ${item.props.detail ?? item.props.status}`;
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
        <View style={styles.titleLine}>
          <Text numberOfLines={2} style={styles.title} variant="body" weight="600">
            {item.props.title}
          </Text>
          {percent !== null ? (
            <Text color="accent" tabular variant="subheadline" weight="600">
              {`${percent}%`}
            </Text>
          ) : null}
        </View>
        <Text color="secondaryLabel" numberOfLines={1} variant="subheadline">
          {detail}
        </Text>
        {progress !== undefined ? (
          <View style={styles.progress}>
            <ProgressBar value={progress} />
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
    marginTop: space.xs,
  },
});
