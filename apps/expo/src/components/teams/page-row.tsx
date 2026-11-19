import type { OncallPageDto } from "@hark/contracts";
import { Link } from "expo-router";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { pageStatusLabel, timeAgo } from "../../lib/teams";
import { spoken } from "../../ui/a11y";
import { Cell, Chevron, useStackedRows } from "../../ui/list";
import { StatusDot } from "../../ui/status-dot";
import { Text } from "../../ui/text";
import { type ColorName, metrics, type TextVariant } from "../../ui/tokens";

const DOT = 10;

/** Keeps a phrase on one line, so a wrapped subtitle breaks between phrases. */
export function unbroken(text: string): string {
  return text.replace(/ /g, "\u00A0");
}

/**
 * A status dot centered on the first line of the text beside it, at any
 * text size: an invisible one-line `Text` of the same variant sets the
 * column's height. Put it in a row with `alignItems: "flex-start"`.
 */
export function LeadingDot({
  color,
  variant = "body",
  size = DOT,
}: {
  color: ColorName;
  variant?: TextVariant;
  size?: number;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size }}
    >
      <Text variant={variant}>{"\u200B"}</Text>
      <View style={styles.dot}>
        <StatusDot color={color} size={size} />
      </View>
    </View>
  );
}

/** "Needs a responder" while open, "Acknowledged by Ana" once someone is on it. */
export function pageStateText(page: OncallPageDto): string {
  if (page.status === "triggered") return "Needs a responder";
  if (page.status === "acknowledged" && page.acknowledgedBy) {
    return `Acknowledged by ${page.acknowledgedBy.name}`;
  }
  if (page.status === "resolved" && page.resolvedBy) return `Resolved by ${page.resolvedBy.name}`;
  return pageStatusLabel(page);
}

/** "Platform primary · 4 min ago · Needs a responder", wrapping between phrases. */
export function pageSubtitle(page: OncallPageDto, now: number): string {
  return [page.groupName, timeAgo(page.createdAt, now), pageStateText(page)]
    .map(unbroken)
    .join(" · ");
}

/** Open pages first, newest first within each status. */
export function sortPages(pages: OncallPageDto[]): OncallPageDto[] {
  return [...pages].sort((a, b) => {
    const open = Number(b.status === "triggered") - Number(a.status === "triggered");
    return open || Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

/**
 * A page in Teams › Open Pages and On Call (DESIGN.md 5.12, 5.14): a status
 * dot (danger while it needs a responder, accent once acknowledged), the
 * title, and "{group} · {time ago} · {state}". Opens the page sheet. Open
 * pages get the heavier title, like unread mail, so they read first.
 */
export const PageRow = memo(function PageRow({ page, now }: { page: OncallPageDto; now: number }) {
  const stacked = useStackedRows();
  const open = page.status === "triggered";
  const ago = timeAgo(page.createdAt, now);
  const state = pageStateText(page);
  return (
    <Link asChild href={{ pathname: "/pages/[id]", params: { id: page.id } }}>
      <Cell
        accessibilityHint="Opens the page"
        accessibilityLabel={spoken(page.title, pageStatusLabel(page), page.groupName, ago, state)}
        accessibilityRole="button"
        accessible
        minHeight={metrics.rowMinHeightSubtitle}
        separatorInset={metrics.rowPaddingHorizontal + DOT + metrics.rowAccessoryGap}
        style={styles.row}
      >
        <LeadingDot color={open ? "danger" : "accent"} variant={open ? "headline" : "body"} />
        <View style={styles.copy}>
          <Text numberOfLines={stacked ? undefined : 1} variant={open ? "headline" : "body"}>
            {page.title}
          </Text>
          <Text
            color="secondaryLabel"
            numberOfLines={stacked ? undefined : 2}
            variant="subheadline"
          >
            {pageSubtitle(page, now)}
          </Text>
        </View>
        <View style={styles.chevron}>
          <Chevron />
        </View>
      </Cell>
    </Link>
  );
});

const styles = StyleSheet.create({
  row: {
    alignItems: "flex-start",
  },
  dot: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  chevron: {
    alignSelf: "center",
  },
});
