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

/** Letters kept together at the start and the end of a hyphenated word. */
const HYPHEN_START = 3;
const HYPHEN_END = 4;
const SOFT_HYPHEN = "\u00AD";
const ZERO_WIDTH_SPACE = "\u200B";
const WORD = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
const VOWEL = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüý]/i;
/** Consonant pairs that stay together, so a break goes before or after both. */
const DIGRAPHS = new Set(["ch", "ck", "gh", "ph", "qu", "sh", "th", "wh"]);

function isVowel(word: string, index: number): boolean {
  const letter = word[index];
  if (letter === undefined) return false;
  return VOWEL.test(letter) && !(index === 0 && letter.toLowerCase() === "y");
}

/**
 * Soft hyphens between the syllables of one long word: before a single
 * consonant between vowels ("Noti-fi-ca-tions"), after the first of two or
 * three ("Regis-tra-tion"), never inside "ck", "th" and the like
 * ("Ack-now-ledge"), and at least three letters from the start and four from the end
 * ("Unre-gis-tered"). Text
 * layout breaks a line at one only when the word doesn't fit, and then
 * draws the hyphen.
 */
function hyphenateWord(word: string): string {
  const breaks: number[] = [];
  let index = 1;
  while (index < word.length) {
    if (isVowel(word, index) || !isVowel(word, index - 1)) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < word.length && !isVowel(word, end)) end += 1;
    if (end < word.length) {
      const run = end - index;
      const pair = word.slice(index, index + 2).toLowerCase();
      const at =
        run === 1
          ? index
          : run === 2
            ? DIGRAPHS.has(pair)
              ? index
              : index + 1
            : index + (DIGRAPHS.has(pair) ? 2 : 1);
      if (at >= HYPHEN_START && at <= word.length - HYPHEN_END) breaks.push(at);
    }
    index = end;
  }
  let result = "";
  let last = 0;
  for (const at of breaks) {
    result += word.slice(last, at) + SOFT_HYPHEN;
    last = at;
  }
  return result + word.slice(last);
}

/**
 * Text whose words may be wider than its line (accessibility sizes on a
 * narrow iPhone, SS-02). React Native's iOS text can't hyphenate by itself
 * and breaks such a word anywhere, without a hyphen ("Notificatio / ns",
 * "jordan@exa / mple.com"). Words longer than `maxLetters` get soft
 * hyphens between syllables, and shorter words are left alone, so a word
 * that fits its own line moves down whole instead of being hyphenated.
 * Addresses and hosts longer than half that get invisible break points
 * after "@" and "/" and before ".", where a hyphen would change them (their
 * digits and punctuation are wider than letters, so a 14-character host
 * broke inside a number at the length a word still fit). Only for display: keep the original
 * for accessibility labels, and don't use it on selectable text (a copy
 * would carry the invisible characters).
 */
export function breakableText(text: string, maxLetters: number): string {
  return text.replace(/\S+/g, (token) => {
    // "@", "/" or a dot inside the token; a sentence's final period isn't one.
    const address = /[@/]|\.(?=\S)/.test(token);
    if (token.length <= (address ? maxLetters / 2 : maxLetters)) return token;
    if (address) {
      let result = "";
      for (let index = 0; index < token.length; index += 1) {
        const character = token[index];
        if (character === "." && index > 0 && index < token.length - 1) result += ZERO_WIDTH_SPACE;
        result += character;
        if ((character === "@" || character === "/") && index < token.length - 1) {
          result += ZERO_WIDTH_SPACE;
        }
      }
      return result;
    }
    return token.replace(WORD, (word) => (word.length > maxLetters ? hyphenateWord(word) : word));
  });
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
