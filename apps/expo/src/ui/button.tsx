import { type SFSymbol, SymbolView } from "expo-symbols";
import type { Ref } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type View,
  type ViewStyle,
} from "react-native";
import { Text } from "./text";
import { type ColorName, colors, radius, space } from "./tokens";

/**
 * Content-layer buttons (DESIGN.md 3.7): flat capsules, never glass. The
 * primary actions of a sheet are native toolbar buttons instead.
 *
 * - `prominent`: the one primary action in a block (Approve, Allow).
 * - `bordered`: secondary (Deny, Reply…, Open).
 * - `destructive`: destructive in content (rare).
 * - `plain`: tertiary text action.
 *
 * `regular` is 36 pt high with a 44-pt hit area; `large` is 50 pt and full
 * width. While `busy` the label reads `busyTitle` and the button is disabled.
 * Labels wrap at large text sizes instead of truncating.
 */
export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  title: string;
  variant?: "prominent" | "bordered" | "destructive" | "plain";
  size?: "regular" | "large";
  symbol?: SFSymbol;
  busy?: boolean;
  /** Label while busy, e.g. "Sending…". */
  busyTitle?: string;
  /** Shows a spinner instead of the symbol while busy. */
  spinner?: boolean;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<View>;
}

const HEIGHT = { regular: 36, large: 50 } as const;

const LABEL_COLOR: Record<NonNullable<ButtonProps["variant"]>, ColorName> = {
  prominent: "onAccent",
  bordered: "label",
  destructive: "danger",
  plain: "accent",
};

export function Button({
  title,
  variant = "bordered",
  size = "regular",
  symbol,
  busy = false,
  busyTitle,
  spinner,
  disabled,
  style,
  ref,
  accessibilityLabel,
  accessibilityState,
  ...props
}: ButtonProps) {
  const inactive = Boolean(disabled || busy);
  const label = busy && busyTitle ? busyTitle : title;
  const labelColor = LABEL_COLOR[variant];
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ ...accessibilityState, disabled: inactive, busy }}
      disabled={inactive}
      hitSlop={size === "regular" ? 4 : undefined}
      ref={ref}
      style={({ pressed }) => [
        styles.button,
        size === "large" ? styles.large : styles.regular,
        variantStyles[variant],
        pressed && pressedStyles[variant],
        inactive && styles.disabled,
        style,
      ]}
      {...props}
    >
      {busy && spinner ? (
        <ActivityIndicator color={colors[labelColor]} size="small" />
      ) : symbol ? (
        <SymbolView
          name={symbol}
          size={size === "large" ? 17 : 15}
          tintColor={colors[labelColor]}
          weight="semibold"
        />
      ) : null}
      <Text
        align="center"
        color={labelColor}
        style={styles.label}
        variant={size === "large" ? "headline" : "subheadline"}
        weight="600"
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderCurve: "continuous",
  },
  regular: {
    minHeight: HEIGHT.regular,
    paddingHorizontal: space.m,
    paddingVertical: 7,
    borderRadius: radius.capsule(HEIGHT.regular),
  },
  large: {
    alignSelf: "stretch",
    minHeight: HEIGHT.large,
    paddingHorizontal: space.l,
    paddingVertical: 12,
    borderRadius: radius.capsule(HEIGHT.large),
  },
  label: {
    flexShrink: 1,
  },
  disabled: {
    opacity: 0.4,
  },
});

const variantStyles = StyleSheet.create({
  prominent: { backgroundColor: colors.accent },
  bordered: { backgroundColor: colors.fill },
  destructive: { backgroundColor: colors.fill },
  plain: { paddingHorizontal: space.xs },
});

const pressedStyles = StyleSheet.create({
  prominent: { backgroundColor: colors.accentPressed },
  bordered: { backgroundColor: colors.fillPressed },
  destructive: { backgroundColor: colors.fillPressed },
  plain: { opacity: 0.6 },
});
