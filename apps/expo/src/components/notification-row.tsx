import type { InboxNotificationSummaryDto } from "@hark/contracts";
import { Link } from "expo-router";
import { memo, useMemo } from "react";
import { type AccessibilityActionEvent, StyleSheet, View } from "react-native";
import { spoken } from "../ui/a11y";
import { Cell, useStackedRows } from "../ui/list";
import { Text } from "../ui/text";
import { colors, space } from "../ui/tokens";
import { formatActivityTime } from "./inbox/format";

/** The leading column that holds the unread dot (DESIGN.md 5.6). */
export const NOTIFICATION_DOT_COLUMN = 16;
/** Between the dot column and the text. */
export const NOTIFICATION_DOT_GAP = space.xs;
const DOT = 10;
const MIN_HEIGHT = 76;

export interface NotificationRowProps {
  item: InboxNotificationSummaryDto;
  /** The plain list's screen margin, so rows line up with the title. */
  margin: number;
  onToggleRead: (item: InboxNotificationSummaryDto) => void;
  onOpenLink: (item: InboxNotificationSummaryDto) => void;
  onOpenApp: (item: InboxNotificationSummaryDto) => void;
}

/**
 * One notification in a project (DESIGN.md 5.6), like a message in Mail:
 * unread dot, title and time, two lines of preview, the source. Pushes the
 * detail; touch and hold shows a preview of it and the row's actions (read
 * state, then the link or the app it opens).
 */
export const NotificationRow = memo(function NotificationRow({
  item,
  margin,
  onToggleRead,
  onOpenLink,
  onOpenApp,
}: NotificationRowProps) {
  const stacked = useStackedRows();
  const unread = item.readAt === null;
  const time = formatActivityTime(item.createdAt);
  const titleVariant = unread ? "headline" : "body";
  const toggleLabel = unread ? "Mark as Read" : "Mark as Unread";
  const linkOnly = Boolean(item.url && !item.app);
  // One object, never an array: `Link asChild` merges the child's style.
  const rowStyle = useMemo(() => ({ ...row, paddingHorizontal: margin }), [margin]);

  const timeText = (
    <Text color="tertiaryLabel" tabular variant="footnote">
      {time}
    </Text>
  );
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (name === "toggleRead") onToggleRead(item);
    else if (name === "openLink") onOpenLink(item);
    else if (name === "openApp") onOpenApp(item);
  };

  return (
    <Link asChild href={{ pathname: "/notification/[id]", params: { id: item.id } }}>
      <Link.Trigger>
        <Cell
          accessibilityActions={[
            { name: "toggleRead", label: toggleLabel },
            ...(linkOnly ? [{ name: "openLink", label: "Open Link" }] : []),
            ...(item.app ? [{ name: "openApp", label: `Open ${item.app.name}` }] : []),
          ]}
          accessibilityHint="Shows the notification"
          accessibilityLabel={spoken(
            unread ? "Unread" : null,
            item.title,
            item.preview,
            item.sourceName,
            time,
          )}
          accessibilityRole="button"
          accessible
          minHeight={MIN_HEIGHT}
          onAccessibilityAction={onAccessibilityAction}
          separatorInset={margin + NOTIFICATION_DOT_COLUMN + NOTIFICATION_DOT_GAP}
          style={rowStyle}
        >
          <View style={styles.dotColumn}>
            {/* One line of the title's style, so the dot sits on the first line at every text size. */}
            <View style={styles.dotLine}>
              <Text
                accessibilityElementsHidden
                importantForAccessibility="no"
                variant={titleVariant}
              >
                {"​"}
              </Text>
              <View style={[styles.dot, unread ? null : styles.dotHidden]} />
            </View>
          </View>
          <View style={styles.copy}>
            <View style={styles.titleLine}>
              <Text
                numberOfLines={stacked ? undefined : 1}
                style={styles.title}
                variant={titleVariant}
              >
                {item.title}
              </Text>
              {stacked ? null : timeText}
            </View>
            {item.preview ? (
              <Text color="secondaryLabel" numberOfLines={stacked ? 4 : 2} variant="subheadline">
                {item.preview}
              </Text>
            ) : null}
            <Text color="tertiaryLabel" numberOfLines={stacked ? undefined : 1} variant="footnote">
              {item.sourceName}
            </Text>
            {/* At accessibility sizes the time stacks under the text (3.6). */}
            {stacked ? timeText : null}
          </View>
        </Cell>
      </Link.Trigger>
      <Link.Preview />
      <Link.Menu>
        <Link.MenuAction
          icon={unread ? "envelope.open" : "envelope.badge"}
          onPress={() => onToggleRead(item)}
        >
          {toggleLabel}
        </Link.MenuAction>
        {linkOnly ? (
          <Link.MenuAction icon="safari" onPress={() => onOpenLink(item)}>
            Open Link
          </Link.MenuAction>
        ) : null}
        {item.app ? (
          <Link.MenuAction icon="square.grid.2x2" onPress={() => onOpenApp(item)}>
            {`Open ${item.app.name}`}
          </Link.MenuAction>
        ) : null}
      </Link.Menu>
    </Link>
  );
});

const row = {
  alignItems: "flex-start",
  gap: NOTIFICATION_DOT_GAP,
  paddingVertical: space.s,
  // iOS lifts the row with rounded corners for the preview and menu.
  borderRadius: 12,
  borderCurve: "continuous",
  backgroundColor: colors.background,
} as const;

const styles = StyleSheet.create({
  dotColumn: {
    width: NOTIFICATION_DOT_COLUMN,
  },
  dotLine: {
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.accent,
  },
  dotHidden: {
    opacity: 0,
  },
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
    minWidth: 0,
    flex: 1,
  },
});
