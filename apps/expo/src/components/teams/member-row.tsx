import type { TeamMemberDto } from "@hark/contracts";
import { SymbolView } from "expo-symbols";
import { memo, useRef } from "react";
import { findNodeHandle, Pressable, StyleSheet, View } from "react-native";
import { roleLabel } from "../../lib/teams";
import { spoken } from "../../ui/a11y";
import { Avatar } from "../../ui/avatar";
import { Cell, useStackedRows } from "../../ui/list";
import { Text } from "../../ui/text";
import { colors, metrics, radius, space } from "../../ui/tokens";

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

/**
 * A trailing `ellipsis` button (44 pt) that hands its own node to `onPress`,
 * so the action sheet it opens grows out of it (iOS 26; a popover on iPad).
 */
export function MoreButton({
  accessibilityLabel,
  onPress,
}: {
  accessibilityLabel: string;
  onPress: (anchor: number | undefined) => void;
}) {
  const ref = useRef<View>(null);
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={() => onPress(findNodeHandle(ref.current) ?? undefined)}
      ref={ref}
      style={({ pressed }) => [styles.more, pressed && styles.pressed]}
    >
      <SymbolView name="ellipsis" size={17} tintColor={colors.secondaryLabel} weight="semibold" />
    </Pressable>
  );
}

/**
 * A team member (DESIGN.md 5.13): avatar, name (" · You" for you), email and
 * role. Members you can manage get a trailing More button; rows that can't
 * keep its width (`reserveAction`) so the role pills line up.
 */
export const MemberRow = memo(function MemberRow({
  member,
  self,
  manageable,
  reserveAction,
  onManage,
}: {
  member: TeamMemberDto;
  self: boolean;
  manageable: boolean;
  reserveAction: boolean;
  onManage: (member: TeamMemberDto, anchor: number | undefined) => void;
}) {
  const stacked = useStackedRows();
  const role = roleLabel(member.role);
  const pill = <RolePill label={role} />;
  return (
    <Cell
      minHeight={metrics.rowMinHeightSubtitle}
      separatorInset={metrics.rowPaddingHorizontal + AVATAR + metrics.rowAccessoryGap}
      style={manageable || reserveAction ? styles.withAction : null}
    >
      <View
        accessibilityLabel={spoken(self ? `${member.name}, you` : member.name, role, member.email)}
        accessible
        style={styles.identity}
      >
        <Avatar image={member.image} name={member.name} size={AVATAR} />
        <View style={styles.copy}>
          <Text numberOfLines={stacked ? undefined : 1} variant="body">
            {member.name}
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
            {member.email}
          </Text>
          {stacked ? <View style={styles.stackedPill}>{pill}</View> : null}
        </View>
        {stacked ? null : pill}
      </View>
      {manageable ? (
        <MoreButton
          accessibilityLabel={`Manage ${member.name}`}
          onPress={(anchor) => onManage(member, anchor)}
        />
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
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
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
  pressed: {
    opacity: 0.5,
  },
});
