import type { CriticalAlertState } from "@hark/contracts";
import { StyleSheet, View } from "react-native";
import type { OncallMeDto } from "../../lib/api";
import { currentShift, formatHandoff } from "../../lib/teams";
import { spoken } from "../../ui/a11y";
import { Cell, Chevron, useStackedRows } from "../../ui/list";
import { Text } from "../../ui/text";
import { colors, metrics } from "../../ui/tokens";
import { LeadingDot, phrases } from "./page-row";

const DOT = 10;

export interface OncallStatus {
  onCall: boolean;
  title: string;
  /** The shift line; `phrases` keeps its parts together except at AX sizes. */
  parts: string[];
}

/**
 * Where you stand (DESIGN.md 5.12): on call now with the handoff time, your
 * next shift, or nothing scheduled.
 */
export function oncallStatus(me: OncallMeDto | null | undefined, now: number): OncallStatus {
  const shifts = me?.shifts ?? [];
  const shift = currentShift(shifts, now);
  if (shift) {
    return {
      onCall: true,
      title: "You're On Call",
      parts: [shift.groupName, shift.teamName, `until ${formatHandoff(shift.endsAt, now)}`],
    };
  }
  const next = shifts
    .filter((item) => Date.parse(item.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return {
    onCall: false,
    title: "You're Not On Call",
    parts: next
      ? [`Next: ${next.groupName}, ${formatHandoff(next.startsAt, now)}`]
      : ["No shifts scheduled for you."],
  };
}

/**
 * The on-call status row: a dot (accent on shift), "You're On Call" and the
 * shift. On Teams it navigates to On Call; on On Call it is the status
 * itself and takes the accent tint while you are on shift.
 */
export function OncallStatusRow({
  status,
  onPress,
  tinted,
}: {
  status: OncallStatus;
  onPress?: () => void;
  /** Fill the row with `accentSoft` while on call (On Call's status section). */
  tinted?: boolean;
}) {
  const stacked = useStackedRows();
  const subtitle = phrases(status.parts, !stacked);
  return (
    <Cell
      accessibilityHint={onPress ? "Shows your shifts, pages and paging settings" : undefined}
      accessibilityLabel={spoken(status.title, status.parts.join(", "))}
      accessibilityRole={onPress ? "button" : "summary"}
      accessible
      minHeight={metrics.rowMinHeightSubtitle}
      onPress={onPress}
      separatorInset={metrics.rowPaddingHorizontal + DOT + metrics.rowAccessoryGap}
      style={[styles.row, tinted && status.onCall ? styles.tinted : null]}
    >
      <LeadingDot color={status.onCall ? "accent" : "placeholder"} variant="headline" />
      <View style={styles.copy}>
        <Text variant="headline">{status.title}</Text>
        <Text color="secondaryLabel" variant="subheadline">
          {subtitle}
        </Text>
      </View>
      {onPress ? (
        <View style={styles.chevron}>
          <Chevron />
        </View>
      ) : null}
    </Cell>
  );
}

/** Critical Alerts state as a settings value, title case (5.14). */
export function criticalAlertValue(state: CriticalAlertState | null | undefined): string {
  switch (state) {
    case "authorized":
      return "On";
    case "denied":
      return "Off";
    case "notDetermined":
      return "Not Set Up";
    default:
      return "Not Available Yet";
  }
}

const styles = StyleSheet.create({
  row: {
    alignItems: "flex-start",
  },
  chevron: {
    alignSelf: "center",
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  tinted: {
    backgroundColor: colors.accentSoft,
  },
});
