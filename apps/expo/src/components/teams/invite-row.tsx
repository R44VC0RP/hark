import type { TeamInviteDto } from "@hark/contracts";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { formatUpcoming } from "../../lib/dates";
import { roleLabel } from "../../lib/teams";
import { spoken } from "../../ui/a11y";
import { Cell, useBreakable, useLargeText, useStackedRows, useTextMeasure } from "../../ui/list";
import { breakableText, Text } from "../../ui/text";
import { colors, metrics, space } from "../../ui/tokens";
import { FactLine } from "./fact-line";

/**
 * A pending invite (DESIGN.md 5.13): who it is for, its role and who sent it
 * on one line, when it expires on the next (no "·" ending a wrapped line,
 * V-06). The row itself does nothing (tapping it used to revoke it, P9);
 * revoking is the explicit trailing "Revoke".
 */
export const InviteRow = memo(function InviteRow({
  invite,
  onRevoke,
}: {
  invite: TeamInviteDto;
  onRevoke: (invite: TeamInviteDto) => void;
}) {
  const stacked = useStackedRows();
  // From xxxLarge the invite's email wraps instead of being cut
  // ("lena@example.c…"): an admin reads the whole address before revoking (R-01).
  const largeText = useLargeText();
  const measure = useTextMeasure();
  // An address breaks after "@", not inside a word, at accessibility sizes (SS-02).
  const breakable = useBreakable();
  const title = invite.email ?? "Invite Link";
  const facts = [roleLabel(invite.role), `from ${invite.invitedBy}`];
  const expires = `Expires ${formatUpcoming(invite.expiresAt)}`;
  return (
    <Cell
      minHeight={metrics.rowMinHeightSubtitle}
      separatorInset={
        metrics.rowPaddingHorizontal + metrics.rowSymbolColumn + metrics.rowAccessoryGap
      }
      style={stacked ? styles.rowStacked : styles.row}
    >
      <View
        accessibilityLabel={spoken(title, ...facts, expires)}
        accessible
        style={styles.identity}
      >
        <View style={styles.leading}>
          <SymbolView name="link" size={20} tintColor={colors.secondaryLabel} />
        </View>
        <View style={[styles.copy, measure]}>
          <Text numberOfLines={stacked || largeText ? undefined : 1} variant="body">
            {invite.email && largeText && !stacked
              ? // From xxxLarge an address may break after "@" or before ".",
                // never inside a word ("ben@example.co / m").
                breakableText(invite.email, 0)
              : breakable(title)}
          </Text>
          {/* The inviter's name gives way before the role. */}
          <FactLine facts={facts} shrink={1} />
          <Text color="secondaryLabel" variant="subheadline">
            {expires}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityHint="The link stops working"
        accessibilityLabel={`Revoke ${title}`}
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8 }}
        onPress={() => onRevoke(invite)}
        // At accessibility sizes "Revoke" goes under the text, which then
        // keeps the row's width instead of breaking inside words.
        style={({ pressed }) => [
          styles.revoke,
          stacked && styles.revokeStacked,
          pressed && styles.pressed,
        ]}
      >
        <Text color="danger" variant="subheadline" weight="600">
          Revoke
        </Text>
      </Pressable>
    </Cell>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingRight: space.xs,
    gap: space.xxs,
  },
  rowStacked: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 0,
  },
  identity: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowAccessoryGap,
  },
  leading: {
    width: metrics.rowSymbolColumn,
    alignItems: "center",
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  revoke: {
    minHeight: metrics.hitTarget,
    justifyContent: "center",
    paddingHorizontal: space.xs,
  },
  revokeStacked: {
    alignSelf: "flex-start",
    marginLeft: metrics.rowSymbolColumn + metrics.rowAccessoryGap - space.xs,
  },
  pressed: {
    opacity: 0.5,
  },
});
