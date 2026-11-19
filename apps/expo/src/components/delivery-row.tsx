import type { EventDto } from "@hark/contracts";
import { memo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { formatListDate } from "../lib/dates";
import { spoken } from "../ui/a11y";
import { SourceAvatar } from "../ui/avatar";
import { Cell, useStackedRows } from "../ui/list";
import { animateListChange } from "../ui/motion";
import { StatusDot } from "../ui/status-dot";
import { Text } from "../ui/text";
import { type ColorName, colors, metrics, space } from "../ui/tokens";

export const DELIVERY_AVATAR = 32;
const DOT = 9;
/** The paper ring that separates the status dot from the avatar. */
const DOT_RING = 2;

/** The status dot's colour (DESIGN.md 5.17); the status line says it in words too. */
function statusColor(status: string): ColorName {
  if (status === "accepted" || status === "delivered") return "accent";
  if (status === "failed") return "danger";
  if (status === "partial" || status === "withdraw_partial") return "warning";
  return "placeholder";
}

/** "Delivered to 2 devices", "Failed · {error}", … */
export function deliveryStatus(event: EventDto): string {
  if (event.status === "accepted" || event.status === "delivered") {
    return `Delivered to ${event.deliveredCount} ${event.deliveredCount === 1 ? "device" : "devices"}`;
  }
  if (event.status === "withdrawn") return "Withdrawal requested";
  if (event.status === "withdraw_partial") return "Withdrawal partially accepted";
  if (event.status === "partial") return "Partially delivered";
  if (event.status === "no_devices") return "No active devices";
  if (event.status === "processing") return "Processing";
  return event.error ? `Failed · ${event.error}` : "Failed";
}

/**
 * One webhook Hark received and what happened to it (DESIGN.md 5.17), in Set
 * Up's grouped section and in Settings › Recent Deliveries' plain list. Rows
 * with a body expand on tap to show all of it.
 */
export const DeliveryRow = memo(function DeliveryRow({
  event,
  margin,
  ringColor = "cell",
}: {
  event: EventDto;
  /** A plain list's screen margin; grouped sections use the row padding. */
  margin?: number;
  /** The row's background, which the dot's ring matches. */
  ringColor?: ColorName;
}) {
  const [expanded, setExpanded] = useState(false);
  const stacked = useStackedRows();
  const expandable = event.body.length > 0;
  const status = deliveryStatus(event);
  const time = formatListDate(event.createdAt);
  const lines = expanded || stacked ? undefined : 1;
  const timeText = (
    <Text color="tertiaryLabel" tabular variant="footnote">
      {time}
    </Text>
  );
  return (
    <Cell
      accessibilityHint={expandable ? (expanded ? "Shows less" : "Shows the full text") : undefined}
      accessibilityLabel={spoken(`${event.serviceTitle}. ${event.title}`, event.body, status, time)}
      accessibilityState={expandable ? { expanded } : undefined}
      accessible
      minHeight={metrics.rowMinHeightSubtitle}
      onPress={
        expandable
          ? () => {
              animateListChange();
              setExpanded((current) => !current);
            }
          : undefined
      }
      separatorInset={
        (margin ?? metrics.rowPaddingHorizontal) + DELIVERY_AVATAR + metrics.rowAccessoryGap
      }
      style={[styles.row, margin !== undefined ? { paddingHorizontal: margin } : null]}
    >
      <View style={styles.avatar}>
        <SourceAvatar name={event.serviceTitle} size={DELIVERY_AVATAR} url={event.imageUrl} />
        <View style={[styles.dotRing, { backgroundColor: colors[ringColor] }]}>
          <StatusDot color={statusColor(event.status)} size={DOT} />
        </View>
      </View>
      <View style={styles.copy}>
        <View style={styles.titleLine}>
          {/*
            The title alone beside the time: with the service in front, a
            375-pt iPhone kept 10–14 of its characters (SS-06). The service
            leads the status line instead.
          */}
          <Text numberOfLines={lines} style={styles.title} variant="subheadline" weight="600">
            {event.title}
          </Text>
          {stacked ? null : timeText}
        </View>
        {expandable ? (
          <Text color="secondaryLabel" numberOfLines={lines} variant="subheadline">
            {event.body}
          </Text>
        ) : null}
        {stacked ? (
          <Text color="tertiaryLabel" variant="footnote">
            {`${event.serviceTitle} · ${status}`}
          </Text>
        ) : (
          <View style={styles.statusLine}>
            <Text color="tertiaryLabel" numberOfLines={1} style={styles.source} variant="footnote">
              {event.serviceTitle}
            </Text>
            <Text color="tertiaryLabel" numberOfLines={1} style={styles.status} variant="footnote">
              {` · ${status}`}
            </Text>
          </View>
        )}
        {stacked ? timeText : null}
      </View>
    </Cell>
  );
});

const styles = StyleSheet.create({
  row: {
    alignItems: "flex-start",
  },
  avatar: {
    width: DELIVERY_AVATAR,
    height: DELIVERY_AVATAR,
  },
  dotRing: {
    position: "absolute",
    right: -DOT_RING,
    bottom: -DOT_RING,
    padding: DOT_RING,
    borderRadius: (DOT + DOT_RING * 2) / 2,
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
  statusLine: {
    flexDirection: "row",
    minWidth: 0,
  },
  // The service gives way first; a long failure gives way only after it.
  source: {
    minWidth: 0,
    flexShrink: 1,
  },
  status: {
    minWidth: 0,
    flexShrink: 0.01,
  },
});
