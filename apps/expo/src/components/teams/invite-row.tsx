import type { TeamInviteDto } from "@hark/contracts";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { roleLabel } from "../../lib/teams";
import { spoken } from "../../ui/a11y";
import { Cell, useStackedRows } from "../../ui/list";
import { Text } from "../../ui/text";
import { colors, metrics, space } from "../../ui/tokens";
import { unbroken } from "./page-row";

function expiryLabel(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * A pending invite (DESIGN.md 5.13): who it is for, its role, who sent it and
 * when it expires. The row itself does nothing (tapping it used to revoke
 * it, P9); revoking is the explicit trailing "Revoke".
 */
export const InviteRow = memo(function InviteRow({
  invite,
  onRevoke,
}: {
  invite: TeamInviteDto;
  onRevoke: (invite: TeamInviteDto) => void;
}) {
  const stacked = useStackedRows();
  const title = invite.email ?? "Invite Link";
  const subtitle = [
    roleLabel(invite.role),
    `from ${invite.invitedBy}`,
    `expires ${expiryLabel(invite.expiresAt)}`,
  ]
    .map(unbroken)
    .join(" · ");
  return (
    <Cell
      minHeight={metrics.rowMinHeightSubtitle}
      separatorInset={
        metrics.rowPaddingHorizontal + metrics.rowSymbolColumn + metrics.rowAccessoryGap
      }
      style={styles.row}
    >
      <View accessibilityLabel={spoken(title, subtitle)} accessible style={styles.identity}>
        <View style={styles.leading}>
          <SymbolView name="link" size={20} tintColor={colors.secondaryLabel} />
        </View>
        <View style={styles.copy}>
          <Text numberOfLines={stacked ? undefined : 1} variant="body">
            {title}
          </Text>
          <Text
            color="secondaryLabel"
            numberOfLines={stacked ? undefined : 2}
            variant="subheadline"
          >
            {subtitle}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityHint="The link stops working"
        accessibilityLabel={`Revoke ${title}`}
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8 }}
        onPress={() => onRevoke(invite)}
        style={({ pressed }) => [styles.revoke, pressed && styles.pressed]}
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
  identity: {
    minWidth: 0,
    flex: 1,
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
  pressed: {
    opacity: 0.5,
  },
});
