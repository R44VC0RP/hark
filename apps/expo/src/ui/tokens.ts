import { DefaultTheme, type NativeStackNavigationOptions, type Theme } from "expo-router";
import { type ColorValue, DynamicColorIOS, type TextProps, type TextStyle } from "react-native";

/**
 * Design tokens for the signed-in app (DESIGN.md 3.1–3.4, 3.12, 5.0).
 * Screens never hard-code colours, sizes or radii; they read them here.
 */

/**
 * Brand hex values (3.2). Content uses `colors`, which adds the Increase
 * Contrast variants; these plain strings are for APIs that need a string.
 */
export const palette = {
  background: "#FAFAF9",
  groupedBackground: "#F2F1ED",
  cell: "#FFFFFF",
  label: "#171713",
  secondaryLabel: "#6B6A63",
  tertiaryLabel: "#85837B",
  placeholder: "#A3A199",
  separator: "#E7E5E0",
  fill: "#F0EEE9",
  fillPressed: "#E7E5E0",
  accent: "#035B49",
  accentPressed: "#02493B",
  accentSoft: "#E7F0ED",
  danger: "#C93B2C",
  dangerSoft: "#FBEAE7",
  warning: "#D48A16",
  onAccent: "#FFFFFF",
} as const;

/** The app is light-only: dark mirrors light, Increase Contrast gets `increased`. */
function withIncreasedContrast(light: string, increased: string): ColorValue {
  return DynamicColorIOS({
    light,
    dark: light,
    highContrastLight: increased,
    highContrastDark: increased,
  });
}

/** Semantic colours (3.2). `placeholder` is for non-text only. */
export const colors = {
  background: palette.background,
  groupedBackground: palette.groupedBackground,
  cell: palette.cell,
  label: withIncreasedContrast(palette.label, "#000000"),
  secondaryLabel: withIncreasedContrast(palette.secondaryLabel, "#4F4E48"),
  tertiaryLabel: withIncreasedContrast(palette.tertiaryLabel, "#6B6A63"),
  placeholder: withIncreasedContrast(palette.placeholder, "#85837B"),
  separator: withIncreasedContrast(palette.separator, "#C9C6BE"),
  fill: withIncreasedContrast(palette.fill, "#E4E1DA"),
  fillPressed: withIncreasedContrast(palette.fillPressed, "#D9D6CE"),
  accent: palette.accent,
  accentPressed: palette.accentPressed,
  accentSoft: palette.accentSoft,
  danger: withIncreasedContrast(palette.danger, "#A32A1E"),
  dangerSoft: palette.dangerSoft,
  warning: palette.warning,
  onAccent: palette.onAccent,
} as const satisfies Record<keyof typeof palette, ColorValue>;

export type ColorName = keyof typeof colors;

/** Spacing scale in points (3.3). */
export const space = {
  xxs: 4,
  xs: 8,
  s: 12,
  m: 16,
  l: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

/** Layout metrics (3.3). Screen margins come from `useScreenMargin()` in `src/ui/list.tsx`. */
export const metrics = {
  marginCompact: 16,
  marginRegular: 20,
  /** Above a section header. */
  sectionGap: 28,
  /** Header to container, and container to footer. */
  sectionInnerGap: 8,
  rowPaddingHorizontal: 16,
  rowMinHeight: 52,
  rowMinHeightSubtitle: 64,
  /** Leading column for symbols; avatars use their own size. */
  rowSymbolColumn: 32,
  rowAccessoryGap: 12,
  /** Detail screens (notification, page, consent, join, critical alerts) on iPad. */
  readingWidth: 680,
  /**
   * The longest text line in full-width lists on iPad (Inbox): about 88
   * characters per line at 15 pt. Times, badges and answers sit past it, in
   * the trailing column.
   */
  measureWidth: 600,
  /** The Inbox's trailing column on iPad: two 120-pt answer buttons. */
  trailingColumnWidth: 248,
  hitTarget: 44,
  /**
   * At or above this `fontScale` rows stack their value under the label
   * (3.6): the accessibility sizes (AX1 is 1.79 in React Native's scale),
   * as Apple does. xxxLarge (1.35) still lays rows out side by side.
   */
  accessibilityFontScale: 1.6,
  /** xxxLarge and up: for layouts that must check whether text still fits. */
  largeFontScale: 1.35,
} as const;

/** Radii (3.4). Always pair with `borderCurve: "continuous"`. */
export const radius = {
  section: 26,
  /** Anything nested in a section with an inset: `section − inset`. */
  inner: (inset: number) => 26 - inset,
  thumb: 10,
  code: 12,
  icon: (size: number) => size * 0.225,
  /** Buttons, pills, badges. */
  capsule: (height: number) => height / 2,
} as const;

export type TypeRamp = Pick<
  TextStyle,
  "fontFamily" | "fontSize" | "lineHeight" | "fontWeight" | "letterSpacing"
> & {
  dynamicTypeRamp: NonNullable<TextProps["dynamicTypeRamp"]>;
  maxFontSizeMultiplier?: number;
};

/**
 * Type scale (3.1). System font inside the app; Inter Tight only for the
 * `brand*` variants on Sign In and Set Up. Rendered through `Text`
 * (`src/ui/text.tsx`), which applies `dynamicTypeRamp` so text follows
 * Apple's Dynamic Type curve. Named `typography` because `type` is a keyword.
 */
export const typography = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700", dynamicTypeRamp: "largeTitle" },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: "700", dynamicTypeRamp: "title1" },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: "700", dynamicTypeRamp: "title2" },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: "600", dynamicTypeRamp: "title3" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600", dynamicTypeRamp: "headline" },
  body: { fontSize: 17, lineHeight: 22, fontWeight: "400", dynamicTypeRamp: "body" },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: "400", dynamicTypeRamp: "callout" },
  subheadline: { fontSize: 15, lineHeight: 20, fontWeight: "400", dynamicTypeRamp: "subheadline" },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: "400", dynamicTypeRamp: "footnote" },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: "400", dynamicTypeRamp: "caption1" },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: "400", dynamicTypeRamp: "caption2" },
  brandHero: {
    fontFamily: "InterTight_600SemiBold",
    fontSize: 40,
    lineHeight: 42,
    letterSpacing: -0.4,
    dynamicTypeRamp: "largeTitle",
    maxFontSizeMultiplier: 1.5,
  },
  brandDisplay: {
    fontFamily: "InterTight_600SemiBold",
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.34,
    dynamicTypeRamp: "largeTitle",
    maxFontSizeMultiplier: 1.6,
  },
  brandMark: {
    fontFamily: "InterTight_600SemiBold",
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.18,
    dynamicTypeRamp: "headline",
  },
} as const satisfies Record<string, TypeRamp>;

export type TextVariant = keyof typeof typography;

/**
 * React Navigation theme (3.2). Also gives native tabs the right background,
 * so switching tabs never flashes white.
 */
export const navigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: palette.accent,
    background: palette.background,
    card: palette.cell,
    text: palette.label,
    border: palette.separator,
    notification: palette.danger,
  },
};

/**
 * Navigation titles in UIKit's own title fonts, which follow Dynamic Type
 * like Settings' and Mail's. expo-router always sends a title colour and a
 * weight (the theme's), and react-native-screens then sets a fixed 17- and
 * 34-pt font, so titles stayed the same size at AX5. No colour or family
 * and an empty weight reach native as nil and leave the bar's default fonts
 * in place (same size and weight at the default text size; the system's
 * label colour instead of our near-black ink).
 */
const systemTitleStyle: { color?: ColorValue; fontFamily?: string; fontWeight?: "normal" } = {
  color: undefined,
  fontFamily: undefined,
  // Typed as a weight; native reads "" as no weight at all.
  fontWeight: "" as unknown as "normal",
};

/**
 * Every native-stack screen (3.12): transparent header so content scrolls
 * under the glass bar with the system's soft scroll-edge effect, minimal
 * back button, ink bar items. Never add `headerStyle.backgroundColor`,
 * `headerBlurEffect` or `headerShadowVisible`.
 */
export const stackScreenOptions = {
  headerTransparent: true,
  headerBackButtonDisplayMode: "minimal",
  headerTintColor: palette.label,
  headerTitleStyle: systemTitleStyle,
  headerLargeTitleStyle: systemTitleStyle,
  // The soft edges are explicit: "automatic" drew nothing under the iPad top
  // tab bar (rows ran crisp under the status bar) or above the floating tab
  // bar and pages accessory (rows ran crisp behind them and green buttons
  // tinted the tab bar). Both checked in the simulator.
  scrollEdgeEffects: { top: "soft", bottom: "soft", left: "automatic", right: "automatic" },
  contentStyle: { backgroundColor: palette.background },
} satisfies NativeStackNavigationOptions;

/**
 * Root-level form sheets (3.12, 5.0). Header visibility is fixed here; never
 * toggle it from a screen: react-native-screens remounts the sheet and keeps
 * the header (checked in the simulator). Screens set `title` in-page; the
 * default is none. Never set `sheetCornerRadius`.
 */
export const sheetOptions = {
  presentation: "formSheet",
  headerShown: true,
  title: "",
  headerTransparent: true,
  headerBackButtonDisplayMode: "minimal",
  headerTintColor: palette.label,
  headerTitleStyle: systemTitleStyle,
  // Same soft edges as stacks. With "automatic" the Reply sheet drew the hard
  // style (opaque band and divider) under its header even at rest, because
  // its list starts under the header, and content ran crisp under bottom
  // toolbars (checked in the simulator).
  scrollEdgeEffects: { top: "soft", bottom: "soft", left: "automatic", right: "automatic" },
  sheetAllowedDetents: [1],
  contentStyle: { backgroundColor: palette.groupedBackground },
} satisfies NativeStackNavigationOptions;
