import { Button as MenuButton } from "@expo/ui/swift-ui";
import type { TeamMemberDto } from "@hark/contracts";
import { type SFSymbol, SymbolView } from "expo-symbols";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { roleLabel } from "../../lib/teams";
import { spoken } from "../../ui/a11y";
import { Avatar } from "../../ui/avatar";
import { Cell, useBreakable, useLeadingAbove, useStackedRows, useTextMeasure } from "../../ui/list";
import { Text } from "../../ui/text";
import { colors, metrics, radius, space } from "../../ui/tokens";
import { RowMenu } from "./row-menu";

const AVATAR = 36;
const PILL = 22;

/** A role capsule ("Owner", "Admin", "Member") on `fill`. */
export function RolePill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text color="secondaryLabel" maxFontSizeMultiplier={1.3} variant="caption1" weight="600">
        {label}
      </Text>
    </View>
  );
}

/** One item of a member's menu ("Make Admin", "Remove from Team"). */
export interface MemberAction {
  label: string;
  icon: SFSymbol;
  destructive?: boolean;
  run: () => void;
}

/**
 * A trailing `ellipsis` button (44 pt) with the member's actions in a native
 * menu that opens from it (I-07: not an action sheet, whose iPad popover let
 * the dismissing tap through to the row under it).
 */
function MoreMenu({ label, actions }: { label: string; actions: MemberAction[] }) {
  return (
    <RowMenu
      label={label}
      menu={actions.map((action) => (
        <MenuButton
          key={action.label}
          label={action.label}
          onPress={action.run}
          role={action.destructive ? "destructive" : "default"}
          systemImage={action.icon}
        />
      ))}
    >
      <View style={styles.more}>
        <SymbolView name="ellipsis" size={17} tintColor={colors.secondaryLabel} weight="semibold" />
      </View>
    </RowMenu>
  );
}

/**
 * A team member (DESIGN.md 5.13): avatar, name (" · You" for you), email and
 * role. Members you can manage get a trailing More menu; rows that can't
 * keep its width (`reserveAction`) so the role pills line up.
 */
export const MemberRow = memo(function MemberRow({
  member,
  self,
  actions,
  reserveAction,
}: {
  member: TeamMemberDto;
  self: boolean;
  /** What you can do to this member; none when you can't manage them. */
  actions: MemberAction[];
  reserveAction: boolean;
}) {
  const stacked = useStackedRows();
  const measure = useTextMeasure();
  // At accessibility sizes on iPhone the avatar goes above the name, as in `Row`, and
  // the address breaks after "@", not inside a word (SS-02).
  const breakable = useBreakable();
  const above = useLeadingAbove();
  const role = roleLabel(member.role);
  const pill = <RolePill label={role} />;
  const manageable = actions.length > 0;
  return (
    <Cell
      minHeight={metrics.rowMinHeightSubtitle}
      separatorInset={metrics.rowPaddingHorizontal + AVATAR + metrics.rowAccessoryGap}
      style={manageable || reserveAction ? styles.withAction : null}
    >
      <View
        accessibilityLabel={spoken(self ? `${member.name}, you` : member.name, role, member.email)}
        accessible
        style={[styles.identity, above && styles.identityStacked]}
      >
        <Avatar image={member.image} name={member.name} size={AVATAR} />
        <View style={[styles.copy, measure, above && styles.copyStacked]}>
          <Text numberOfLines={stacked ? undefined : 1} variant="body">
            {breakable(member.name)}
            {self ? (
              <Text color="secondaryLabel" variant="body">
                {" · You"}
              </Text>
            ) : null}
          </Text>
          <Text
            color="secondaryLabel"
            numberOfLines={stacked ? undefined : 1}
            variant="subheadline"
          >
            {breakable(member.email)}
          </Text>
          {stacked ? <View style={styles.stackedPill}>{pill}</View> : null}
        </View>
        {stacked ? null : pill}
      </View>
      {manageable ? (
        <MoreMenu actions={actions} label={`Manage ${member.name}`} />
      ) : reserveAction ? (
        <View style={styles.reserved} />
      ) : null}
    </Cell>
  );
});

const styles = StyleSheet.create({
  withAction: {
    // The More button brings its own 44-pt hit area to the trailing edge.
    paddingRight: space.xxs,
    gap: space.xxs,
  },
  identity: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowAccessoryGap,
  },
  identityStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  copyStacked: {
    alignSelf: "stretch",
  },
  pill: {
    minHeight: PILL,
    justifyContent: "center",
    paddingHorizontal: space.xs,
    borderRadius: radius.capsule(PILL),
    borderCurve: "continuous",
    backgroundColor: colors.fill,
  },
  stackedPill: {
    alignItems: "flex-start",
    marginTop: space.xxs,
  },
  more: {
    width: metrics.hitTarget,
    height: metrics.hitTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  reserved: {
    width: metrics.hitTarget,
  },
});
