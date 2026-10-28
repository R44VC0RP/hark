import { TEAM_SEAT_PRICE_MONTHLY } from "@hark/contracts";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { ReactNode } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { initialOf, TEAM_BILLING_URL } from "../lib/teams";
import { colors, fonts, tightTracking } from "../lib/theme";

/** Back button, centered title and an optional trailing action, as in Settings. */
export function ScreenHeader({
  title,
  fallback = "/apps",
  right,
}: {
  title?: string;
  fallback?: "/apps" | "/settings" | "/teams";
  right?: ReactNode;
}) {
  const router = useRouter();
  return (
    <View style={ui.header}>
      <Pressable
        accessibilityLabel="Back"
        accessibilityRole="button"
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
        style={({ pressed }) => [ui.iconButton, pressed && ui.iconButtonPressed]}
      >
        <SymbolView name="chevron.left" size={18} tintColor={colors.ink} weight="semibold" />
      </Pressable>
      {title ? (
        <Text accessibilityRole="header" numberOfLines={1} style={ui.headerTitle}>
          {title}
        </Text>
      ) : null}
      {right ?? <View style={ui.iconButton} />}
    </View>
  );
}

export function SectionLabel({ children, detail }: { children: string; detail?: string }) {
  return (
    <View style={ui.sectionLabelRow}>
      <Text accessibilityRole="header" style={ui.sectionLabel}>
        {children}
      </Text>
      {detail ? <Text style={ui.sectionDetail}>{detail}</Text> : null}
    </View>
  );
}

/** Profile photo or a letter tile in the accent tint. */
export function PersonAvatar({
  name,
  image,
  size = 32,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  if (image) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: image }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View style={[ui.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[ui.avatarLetter, { fontSize: Math.round(size * 0.42) }]}>
        {initialOf(name)}
      </Text>
    </View>
  );
}

export function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={ui.metaRow}>
      <Text style={ui.metaLabel}>{label}</Text>
      <Text selectable style={ui.metaValue}>
        {value}
      </Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        ui.primaryButton,
        (disabled || busy) && ui.disabled,
        pressed && ui.primaryButtonPressed,
      ]}
    >
      <Text style={ui.primaryButtonText}>{busy ? `${label}…` : label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  destructive,
  disabled,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.secondaryButton,
        disabled && ui.disabled,
        pressed && ui.secondaryButtonPressed,
      ]}
    >
      <Text style={[ui.secondaryButtonText, destructive && ui.dangerText]}>{label}</Text>
    </Pressable>
  );
}

/** Explains the Team plan when a team doesn't have it; billing lives on the web. */
export function SeatLimitNotice({ teamName, owner }: { teamName: string; owner: boolean }) {
  return (
    <View accessibilityRole="summary" style={ui.notice}>
      <Text style={ui.noticeTitle}>{`${teamName} needs the Team plan`}</Text>
      <Text style={ui.muted}>
        Adding people, sharing apps and paging need the Team plan: ${TEAM_SEAT_PRICE_MONTHLY} per
        seat per month, every member including the owner.{" "}
        {owner
          ? "Start it from the Hark dashboard, then invite again."
          : "Ask the team owner to start it from the Hark dashboard."}
      </Text>
      <Pressable
        accessibilityHint="Opens hark.fyi in Safari"
        accessibilityLabel="Open the Hark dashboard"
        accessibilityRole="link"
        hitSlop={8}
        onPress={() => void Linking.openURL(TEAM_BILLING_URL).catch(() => {})}
      >
        <Text style={ui.link}>hark.fyi/dashboard ↗</Text>
      </Pressable>
    </View>
  );
}

export const ui = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 64,
  },
  header: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
  },
  headerTitle: {
    minWidth: 0,
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 17,
    textAlign: "center",
    letterSpacing: tightTracking(17),
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  iconButtonPressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.96 }],
  },
  loading: {
    paddingVertical: 40,
  },
  message: {
    paddingVertical: 24,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: tightTracking(14),
  },
  sectionLabelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 26,
    paddingBottom: 8,
  },
  sectionLabel: {
    color: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  sectionDetail: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  lastRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowPressed: {
    opacity: 0.65,
  },
  rowCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  rowValue: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: tightTracking(12),
  },
  rowTrailing: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: tightTracking(22),
  },
  body: {
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: tightTracking(15),
  },
  muted: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  metaBlock: {
    gap: 6,
    marginTop: 18,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  metaRow: {
    flexDirection: "row",
    gap: 12,
  },
  metaLabel: {
    width: 84,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  metaValue: {
    minWidth: 0,
    flex: 1,
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  primaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: colors.accent,
  },
  primaryButtonPressed: {
    backgroundColor: colors.accentPressed,
    transform: [{ scale: 0.98 }],
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontFamily: fonts.medium,
    fontSize: 15,
    letterSpacing: tightTracking(15),
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  secondaryButtonPressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.98 }],
  },
  secondaryButtonText: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  dangerText: {
    color: colors.danger,
  },
  disabled: {
    opacity: 0.5,
  },
  action: {
    minHeight: 52,
    justifyContent: "center",
    gap: 3,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  actionLabel: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  actionDetail: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: tightTracking(12),
  },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "#F2F1ED",
  },
  rolePillText: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: tightTracking(11),
  },
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  avatarLetter: {
    color: colors.accent,
    fontFamily: fonts.semibold,
  },
  notice: {
    gap: 8,
    marginTop: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  noticeTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  link: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  input: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
});
