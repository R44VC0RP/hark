import { TEAM_SEAT_PRICE_MONTHLY } from "@hark/contracts";
import { Linking, StyleSheet } from "react-native";
import { TEAM_BILLING_URL } from "../../lib/teams";
import { ActionRow, Cell, Section } from "../../ui/list";
import { Text } from "../../ui/text";
import { space } from "../../ui/tokens";

/**
 * A team without the Team plan has no seat to fill (DESIGN.md 5.13, 5.19):
 * what is needed, who can start it, and the dashboard where billing lives.
 */
export function SeatLimitNotice({ teamName, owner }: { teamName: string; owner: boolean }) {
  return (
    <Section>
      <Cell accessibilityRole="summary" accessible style={styles.notice}>
        <Text variant="headline">{`${teamName} needs the Team plan`}</Text>
        <Text color="secondaryLabel" variant="subheadline">
          {`Adding people, sharing apps and paging need the Team plan: $${TEAM_SEAT_PRICE_MONTHLY} per seat per month, every member including the owner. `}
          {owner
            ? "Start it from the Hark dashboard, then invite again."
            : "Ask the team owner to start it from the Hark dashboard."}
        </Text>
      </Cell>
      <ActionRow
        accessibilityHint="Opens hark.fyi in Safari"
        onPress={() => void Linking.openURL(TEAM_BILLING_URL).catch(() => {})}
        title="Open the Hark Dashboard"
        trailingSymbol="arrow.up.forward.app"
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.xxs,
    paddingVertical: space.s,
  },
});
