import { useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Dimensions,
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

/**
 * The text size (`fontScale`), shared by every `Text`: they re-render only
 * when it changes, not on rotation or window resizes.
 */
let fontScale = Dimensions.get("window").fontScale;
const fontScaleListeners = new Set<() => void>();
Dimensions.addEventListener("change", ({ window }) => {
  if (window.fontScale === fontScale) return;
  fontScale = window.fontScale;
  for (const listener of fontScaleListeners) listener();
});

/**
 * The current text size as a multiplier (1 at the default size). Inline
 * symbols next to text scale by it, like SF Symbols in UIKit text.
 */
export function useFontScale(): number {
  return useSyncExternalStore(
    (listener) => {
      fontScaleListeners.add(listener);
      return () => {
        fontScaleListeners.delete(listener);
      };
    },
    () => fontScale,
  );
}

/**
 * Bold Text (Settings › Accessibility › Display & Text Size). Switching it
 * while Hark runs only reached text that re-rendered (ticking times turned
 * bold, titles beside them did not, V2-06), so every `Text` re-renders when
 * it changes, with a font keyed to it (`boldKeyedSize`).
 */
let boldText = false;
const boldTextListeners = new Set<() => void>();
function setBoldText(enabled: boolean) {
  if (enabled === boldText) return;
  boldText = enabled;
  for (const listener of boldTextListeners) listener();
}
void AccessibilityInfo.isBoldTextEnabled().then(setBoldText);
AccessibilityInfo.addEventListener("boldTextChanged", setBoldText);

function useBoldText(): boolean {
  return useSyncExternalStore(
    (listener) => {
      boldTextListeners.add(listener);
      return () => {
        boldTextListeners.delete(listener);
      };
    },
    () => boldText,
  );
}

/**
 * Re-measures every text after a live text-size change. React Native measures
 * Dynamic Type text as soon as the size changes, while UIFontMetrics still
 * reports the old size, and caches that height under the new size, so text
 * that doesn't re-render kept a stale frame (a 22-pt header drawing AX5
 * glyphs) until relaunch. A letter spacing unique to each text size makes
 * the settled measurement a new cache entry: 0 at the default size and at
 * most about 0.2 pt (AX5), which doesn't show. The cache treats differences
 * under 0.005 as equal; text sizes are at least 0.06 apart in `fontScale`.
 */
function sizeKeyedSpacing(variant: TextVariant, scale: number): TextStyle | null {
  if (scale === 1) return null;
  const ramp: TypeRamp = typography[variant];
  return { letterSpacing: (ramp.letterSpacing ?? 0) + (scale - 1) * 0.1 };
}

/**
 * With Bold Text on, text is 0.1 pt larger, which doesn't show. React
 * Native caches fonts by size and weight only, so text re-rendered after
 * the switch kept the font (and the widths) made before it: it drew bold
 * in widths measured for the regular weight and truncated ("2 Pa…").
 * Another size is another cache entry, made under the current setting.
 */
function boldKeyedSize(variant: TextVariant, bold: boolean): TextStyle | null {
  return bold ? { fontSize: typography[variant].fontSize + 0.1 } : null;
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
  const scale = useFontScale();
  const bold = useBoldText();
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
        sizeKeyedSpacing(variant, scale),
        boldKeyedSize(variant, bold),
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
