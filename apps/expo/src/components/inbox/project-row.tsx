import type { InboxProjectSummaryDto } from "@hark/contracts";
import { Link } from "expo-router";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { useLayout } from "../../lib/layout";
import { spoken } from "../../ui/a11y";
import { Thumbnail } from "../../ui/avatar";
import { Cell, useStackedRows } from "../../ui/list";
import { Text } from "../../ui/text";
import { colors, metrics, radius, space } from "../../ui/tokens";
import { relativeTime } from "./format";

const THUMB = 40;
const BADGE = 20;

/**
 * A project in the Inbox (DESIGN.md 5.3): its latest notification and unread
 * count, opening the project's notifications. Rows without a chevron, like
 * Mail's mailboxes; unread projects have a heavier title.
 */
export const ProjectRow = memo(function ProjectRow({
  item,
  now,
}: {
  item: InboxProjectSummaryDto;
  now: number;
}) {
  const stacked = useStackedRows();
  const wide = useLayout().regular && !stacked;
  const unread = item.unreadCount > 0;
  const preview = item.latestPreview ?? "No notifications yet";
  const count = item.unreadCount > 99 ? "99+" : String(item.unreadCount);
  return (
    <Link
      asChild
      href={{
        pathname: "/project/[project]",
        params: { project: item.projectId ?? "unfiled", name: item.name },
      }}
    >
      <Cell
        accessibilityHint="Shows the project's notifications"
        accessibilityLabel={spoken(
          unread ? `${item.name}, ${item.unreadCount} unread` : item.name,
          preview,
        )}
        accessibilityRole="button"
        accessible
        minHeight={metrics.rowMinHeightSubtitle}
        separatorInset={metrics.rowPaddingHorizontal + THUMB + metrics.rowAccessoryGap}
      >
        <Thumbnail name={item.name} size={THUMB} url={item.latestImageUrl} />
        <View style={[styles.copy, wide && styles.copyWide]}>
          <Text numberOfLines={stacked ? undefined : 1} variant={unread ? "headline" : "body"}>
            {item.name}
          </Text>
          <Text color="secondaryLabel" numberOfLines={stacked ? 2 : 1} variant="subheadline">
            {preview}
          </Text>
        </View>
        <View style={[styles.trailing, wide && styles.trailingWide]}>
          {item.latestAt ? (
            <Text color="tertiaryLabel" tabular variant="footnote">
              {relativeTime(item.latestAt, now)}
            </Text>
          ) : null}
          {unread ? (
            <View style={styles.badge}>
              <Text
                color="onAccent"
                maxFontSizeMultiplier={1.3}
                tabular
                variant="caption1"
                weight="600"
              >
                {count}
              </Text>
            </View>
          ) : null}
        </View>
      </Cell>
    </Link>
  );
});

const styles = StyleSheet.create({
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  /** iPad: the Inbox's reading measure; time and badge stay on the trailing edge. */
  copyWide: {
    flexGrow: 0,
    flexBasis: metrics.measureWidth,
  },
  /**
   * The time lines up with the title's first line whether or not a badge
   * follows (centred, a read row's time sat lower than an unread row's).
   */
  trailing: {
    alignSelf: "flex-start",
    alignItems: "flex-end",
    gap: space.xxs,
    paddingTop: 2,
  },
  trailingWide: {
    marginLeft: "auto",
  },
  badge: {
    minWidth: BADGE,
    height: BADGE,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderRadius: radius.capsule(BADGE),
    borderCurve: "continuous",
    backgroundColor: colors.accent,
  },
});
