import type { CriticalAlertState } from "@hark/contracts";
import { StyleSheet, View } from "react-native";
import type { OncallMeDto } from "../../lib/api";
import { currentShift, formatHandoff } from "../../lib/teams";
import { spoken } from "../../ui/a11y";
import { Cell, Chevron } from "../../ui/list";
import { Text } from "../../ui/text";
import { colors, metrics } from "../../ui/tokens";
import { FactLine } from "./fact-line";
import { LeadingDot } from "./page-row";

const DOT = 10;

export interface OncallStatus {
  onCall: boolean;
  title: string;
  /** Short facts of the shift ("Platform primary", "Northwind Platform"), one line. */
  facts: string[];
  /** The rest as its own line ("Until Sat 6:00 PM", "No shifts scheduled for you."). */
  detail: string;
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
      facts: [shift.groupName, shift.teamName],
      detail: `Until ${formatHandoff(shift.endsAt, now)}`,
    };
  }
  const next = shifts
    .filter((item) => Date.parse(item.startsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  return {
    onCall: false,
    title: "You're Not On Call",
    facts: [],
    detail: next
      ? `Next: ${next.groupName}, ${formatHandoff(next.startsAt, now)}`
      : "No shifts scheduled for you.",
  };
}

/**
 * The on-call status row: a dot (accent on shift), "You're On Call", the
 * shift's group and team on one line and the handoff on the next, so no "·"
 * ends a wrapped line (V-06). On Teams it navigates to On Call; on On Call
 * it is the status itself and takes the accent tint while you are on shift.
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
  return (
    <Cell
      accessibilityHint={onPress ? "Shows your shifts, pages and paging settings" : undefined}
      accessibilityLabel={spoken(status.title, ...status.facts, status.detail)}
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
        {status.facts.length > 0 ? (
          // The team gives way before the group you're on call for.
          <FactLine facts={status.facts} shrink={status.facts.length - 1} />
        ) : null}
        <Text color="secondaryLabel" variant="subheadline">
          {status.detail}
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
