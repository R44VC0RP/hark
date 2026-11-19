import {
  Text as NativeText,
  type TextProps as NativeTextProps,
  StyleSheet,
  type TextStyle,
} from "react-native";
import { type ColorName, colors, type TextVariant, type TypeRamp, typography } from "./tokens";

/**
 * The only text component in redesigned screens (DESIGN.md 3.1). Each
 * variant sets size, line height, weight and the matching Dynamic Type ramp,
 * so text scales on Apple's curve.
 *
 * - `color` takes a token name (`"secondaryLabel"`), never a raw colour.
 * - `weight` overrides the variant's weight ("600" for button labels).
 * - `tabular` for numbers that change (counts, times, percentages).
 * - Badges and pills pass `maxFontSizeMultiplier={1.3}`.
 */
export interface TextProps extends NativeTextProps {
  variant?: TextVariant;
  color?: ColorName;
  weight?: "400" | "500" | "600" | "700";
  tabular?: boolean;
  align?: "left" | "center" | "right";
}

export function Text({
  variant = "body",
  color = "label",
  weight,
  tabular,
  align,
  style,
  maxFontSizeMultiplier,
  ...props
}: TextProps) {
  const ramp: TypeRamp = typography[variant];
  return (
    <NativeText
      dynamicTypeRamp={ramp.dynamicTypeRamp}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? ramp.maxFontSizeMultiplier}
      style={[
        variantStyles[variant],
        colorStyles[color],
        weight ? weightStyles[weight] : null,
        tabular ? styles.tabular : null,
        align ? alignStyles[align] : null,
        style,
      ]}
      {...props}
    />
  );
}

function variantStyle({ dynamicTypeRamp: _ramp, maxFontSizeMultiplier: _max, ...style }: TypeRamp) {
  return style;
}

const variantStyles = StyleSheet.create(
  Object.fromEntries(
    (Object.keys(typography) as TextVariant[]).map((name) => [
      name,
      variantStyle(typography[name]),
    ]),
  ) as Record<TextVariant, TextStyle>,
);

const colorStyles = StyleSheet.create(
  Object.fromEntries(
    (Object.keys(colors) as ColorName[]).map((name) => [name, { color: colors[name] }]),
  ) as Record<ColorName, TextStyle>,
);

const weightStyles = StyleSheet.create({
  "400": { fontWeight: "400" },
  "500": { fontWeight: "500" },
  "600": { fontWeight: "600" },
  "700": { fontWeight: "700" },
});

const alignStyles = StyleSheet.create({
  left: { textAlign: "left" },
  center: { textAlign: "center" },
  right: { textAlign: "right" },
});

const styles = StyleSheet.create({
  tabular: { fontVariant: ["tabular-nums"] },
});
