import { type SFSymbol, SymbolView } from "expo-symbols";
import {
  Children,
  createContext,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  RefreshControl,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  StyleSheet,
  Switch,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "../lib/layout";
import { spoken } from "./a11y";
import { Text } from "./text";
import { type ColorName, colors, metrics, palette, radius, space } from "./tokens";

/**
 * Lists and rows (DESIGN.md 3.6, 3.11). Grouped screens are
 * `List` › `Section` › rows; long feeds use a plain `FlatList` with the same
 * rows. Rows are flat paper: no shadows, gradients or side rules.
 */

/** 16 pt on compact widths, 20 pt on regular (iPad) widths. */
export function useScreenMargin(): number {
  return useLayout().regular ? metrics.marginRegular : metrics.marginCompact;
}

/**
 * The horizontal safe area as content padding. On iPad the docked sidebar
 * floats over the content and reports its width as a leading safe-area
 * inset, which a vertical scroll view does not apply by itself, so content
 * would sit under the sidebar. `List` applies it; a plain `FlatList` passes
 * it as `contentContainerStyle` (its rows add the screen margin).
 */
export function useHorizontalSafeArea(): { paddingLeft: number; paddingRight: number } {
  const { left, right } = useSafeAreaInsets();
  return useMemo(() => ({ paddingLeft: left, paddingRight: right }), [left, right]);
}

/** True at accessibility text sizes, where rows stack their value under the label. */
export function useStackedRows(): boolean {
  return useWindowDimensions().fontScale >= metrics.accessibilityFontScale;
}

/** Centers detail-screen content at 680 pt on iPad; a no-op on iPhone widths. */
export const readingColumn = {
  width: "100%",
  maxWidth: metrics.readingWidth,
  alignSelf: "center",
} as const;

export interface ListProps extends ScrollViewProps {
  /** `grouped` (default): warm grey with inset sections. `plain`: paper. */
  variant?: "grouped" | "plain";
  /** Centers content at the 680-pt reading width (detail screens). */
  reading?: boolean;
  /** Adds the system refresh control. Keep showing the last data while refreshing. */
  onRefresh?: () => void;
  refreshing?: boolean;
  ref?: Ref<ScrollView>;
}

/**
 * A screen's scroll view. It must be the first native child of the screen
 * (3.11 rule 2): the large title, the scroll-edge effect under the glass
 * header and the tab bar's minimise all attach to it. Render `Stack.Screen`
 * and header `Stack.Toolbar`s next to it (they draw nothing); a bottom
 * `Stack.Toolbar` goes after it.
 */
export function List({
  variant = "grouped",
  reading,
  onRefresh,
  refreshing = false,
  style,
  contentContainerStyle,
  children,
  ref,
  ...props
}: ListProps) {
  const margin = useScreenMargin();
  const safeArea = useHorizontalSafeArea();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      ref={ref}
      refreshControl={
        onRefresh ? <RefreshControl onRefresh={onRefresh} refreshing={refreshing} /> : undefined
      }
      style={[variant === "grouped" ? styles.grouped : styles.plain, style]}
      contentContainerStyle={[
        reading
          ? safeArea
          : {
              paddingLeft: margin + safeArea.paddingLeft,
              paddingRight: margin + safeArea.paddingRight,
            },
        styles.content,
        contentContainerStyle,
      ]}
      {...props}
    >
      {/* The reading column centres in the area the sidebar leaves free. */}
      {reading ? (
        <View style={[readingColumn, { paddingHorizontal: margin }]}>{children}</View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/** Whether a row is the first in its section (it then draws no separator). */
const RowPosition = createContext<{ first: boolean }>({ first: true });

function flatten(children: ReactNode): ReactElement[] {
  const items: ReactElement[] = [];
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child)) continue;
    if (child.type === Fragment) {
      items.push(...flatten((child.props as { children?: ReactNode }).children));
    } else items.push(child);
  }
  return items;
}

const FIRST = { first: true };
const REST = { first: false };

export interface SectionProps {
  /** Header in title case. */
  title?: string;
  /** Trailing header detail, e.g. a count (prominent headers). */
  detail?: string;
  /** Content screens (Inbox, Teams, On Call, Apps teams): `headline` ink header. */
  prominent?: boolean;
  footer?: ReactNode;
  /** Rows. Each direct child (fragments are flattened) is one row. */
  children?: ReactNode;
  /** No container: for identity blocks and other content that sits on the background. */
  bare?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * An inset section: optional header, a white container with the section
 * radius, hairline separators between rows (drawn by the rows), optional
 * footer.
 */
export function Section({ title, detail, prominent, footer, children, bare, style }: SectionProps) {
  const rows = flatten(children);
  // At accessibility sizes the detail goes under the title instead of
  // squeezing it into several lines (3.6).
  const stacked = useStackedRows();
  return (
    <View style={[styles.section, style]}>
      {title ? (
        <View style={[styles.header, stacked && detail ? styles.headerStacked : null]}>
          <Text
            accessibilityRole="header"
            color={prominent ? "label" : "secondaryLabel"}
            style={stacked && detail ? null : styles.headerTitle}
            variant={prominent ? "headline" : "subheadline"}
            weight={prominent ? undefined : "500"}
          >
            {title}
          </Text>
          {detail ? (
            <Text color="secondaryLabel" tabular variant="subheadline">
              {detail}
            </Text>
          ) : null}
        </View>
      ) : null}
      {rows.length > 0 ? (
        <View style={bare ? null : styles.container}>
          {rows.map((row, index) => (
            <RowPosition.Provider key={row.key ?? index} value={index === 0 ? FIRST : REST}>
              {row}
            </RowPosition.Provider>
          ))}
        </View>
      ) : null}
      {footer ? (
        typeof footer === "string" ? (
          <Text color="secondaryLabel" style={styles.footer} variant="footnote">
            {footer}
          </Text>
        ) : (
          <View style={styles.footer}>{footer}</View>
        )
      ) : null}
    </View>
  );
}

export interface CellProps extends Omit<PressableProps, "children" | "style"> {
  children?: ReactNode;
  /** Where the separator above this row starts, from the row's leading edge. */
  separatorInset?: number;
  minHeight?: number;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<View>;
}

/**
 * The base of every row: separator, padding, minimum height and, when it has
 * `onPress`, the pressed and iPad-hover highlight (immediate in, 100 ms out).
 * Custom rows (requests, projects) are built on it; `Link asChild` can wrap
 * it directly.
 */
export function Cell({
  children,
  separatorInset = metrics.rowPaddingHorizontal,
  minHeight = metrics.rowMinHeight,
  style,
  ref,
  onPress,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  ...props
}: CellProps) {
  const { first } = useContext(RowPosition);
  const separator = first ? null : (
    <View pointerEvents="none" style={[styles.separator, { left: separatorInset }]} />
  );
  const rowStyle = [styles.cell, { minHeight }, style];

  if (!onPress) {
    return (
      <View ref={ref} style={rowStyle} {...(props as object)}>
        {separator}
        {children}
      </View>
    );
  }
  return (
    <PressableCell
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      ref={ref}
      style={rowStyle}
      {...props}
    >
      {separator}
      {children}
    </PressableCell>
  );
}

function PressableCell({
  children,
  style,
  ref,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  ...props
}: Omit<PressableProps, "style" | "children"> & {
  children: ReactNode;
  style: StyleProp<ViewStyle>;
  ref?: Ref<View>;
}) {
  const [highlight] = useState(() => new Animated.Value(0));
  const hovered = useRef(false);
  const pressed = useRef(false);
  const update = () => {
    if (hovered.current || pressed.current) {
      highlight.stopAnimation();
      highlight.setValue(1);
    } else {
      // JavaScript-driven on purpose: each frame is committed through React,
      // so the shadow tree always holds the current opacity. With the native
      // driver React kept the pressed value (1), and a row that changed
      // height on tap (History, Recent Deliveries) got it re-applied by the
      // 300 ms layout animation after the 100 ms fade: the row stayed grey.
      Animated.timing(highlight, {
        toValue: 0,
        duration: 100,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      onHoverIn={(event) => {
        hovered.current = true;
        update();
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        hovered.current = false;
        update();
        onHoverOut?.(event);
      }}
      onPressIn={(event: GestureResponderEvent) => {
        pressed.current = true;
        update();
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        pressed.current = false;
        update();
        onPressOut?.(event);
      }}
      ref={ref}
      style={style}
      // Like a table view: a touch that starts a scroll never flashes the row.
      unstable_pressDelay={80}
      {...props}
    >
      <Animated.View pointerEvents="none" style={[styles.highlight, { opacity: highlight }]} />
      {children}
    </Pressable>
  );
}

export interface RowProps extends Omit<CellProps, "children"> {
  title: string;
  subtitle?: string;
  /** Lines before the subtitle truncates (default 2). */
  subtitleLines?: number;
  titleVariant?: "body" | "headline";
  titleColor?: ColorName;
  /** A leading SF Symbol in the 32-pt column; accent when the row navigates. */
  symbol?: SFSymbol;
  symbolColor?: ColorName;
  /** A leading avatar or icon instead of a symbol; pass its width as `leadingWidth`. */
  leading?: ReactNode;
  leadingWidth?: number;
  /** Trailing value (`body`, `secondaryLabel`); stacks under the title at AX sizes. */
  value?: string;
  /** Extra trailing content (a badge, a button) before the chevron. */
  trailing?: ReactNode;
  /** Navigable rows end with a chevron. */
  chevron?: boolean;
}

/** The standard row: leading symbol or avatar, title, subtitle, value, chevron. */
export function Row({
  title,
  subtitle,
  subtitleLines = 2,
  titleVariant = "body",
  titleColor = "label",
  symbol,
  symbolColor,
  leading,
  leadingWidth,
  value,
  trailing,
  chevron,
  accessibilityLabel,
  ...props
}: RowProps) {
  const stacked = useStackedRows();
  const leadWidth = leading ? (leadingWidth ?? metrics.rowSymbolColumn) : metrics.rowSymbolColumn;
  const hasLeading = Boolean(symbol || leading);
  const navigates = Boolean(chevron || props.onPress);
  return (
    <Cell
      accessibilityLabel={accessibilityLabel ?? spoken(title, subtitle, value)}
      accessible
      minHeight={subtitle ? metrics.rowMinHeightSubtitle : metrics.rowMinHeight}
      separatorInset={
        metrics.rowPaddingHorizontal + (hasLeading ? leadWidth + metrics.rowAccessoryGap : 0)
      }
      {...props}
    >
      {hasLeading ? (
        <View style={[styles.leading, { width: leadWidth }]}>
          {leading ?? (
            <SymbolView
              name={symbol as SFSymbol}
              size={20}
              tintColor={colors[symbolColor ?? (navigates ? "accent" : "secondaryLabel")]}
            />
          )}
        </View>
      ) : null}
      <View style={styles.copy}>
        <Text color={titleColor} variant={titleVariant}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            color="secondaryLabel"
            numberOfLines={stacked ? undefined : subtitleLines}
            variant="subheadline"
          >
            {subtitle}
          </Text>
        ) : null}
        {value && stacked ? (
          <Text color="secondaryLabel" variant="body">
            {value}
          </Text>
        ) : null}
      </View>
      {value && !stacked ? (
        <Text color="secondaryLabel" numberOfLines={1} style={styles.value} variant="body">
          {value}
        </Text>
      ) : null}
      {trailing}
      {chevron ? <Chevron /> : null}
    </Cell>
  );
}

/**
 * The hairline between rows of a plain `FlatList` (`ItemSeparatorComponent`),
 * inset to the text's leading edge. Grouped sections draw their own.
 */
export function PlainSeparator({ inset }: { inset: number }) {
  return <View style={[styles.plainSeparator, { marginLeft: inset }]} />;
}

/** The disclosure chevron of navigable rows (13 pt, `placeholder`). */
export function Chevron() {
  return (
    <SymbolView name="chevron.right" size={13} tintColor={colors.placeholder} weight="semibold" />
  );
}

export interface LabeledRowProps extends Omit<CellProps, "children"> {
  label: string;
  value: string;
  /** Lets people copy the value. */
  selectable?: boolean;
}

/** A label with its value on the trailing edge ("Received", "Mar 3, 9:41 AM"). */
export function LabeledRow({ label, value, selectable, ...props }: LabeledRowProps) {
  const stacked = useStackedRows();
  return (
    <Cell accessibilityLabel={spoken(label, value)} accessible {...props}>
      <View style={[styles.labeled, stacked && styles.labeledStacked]}>
        <Text variant="body">{label}</Text>
        <Text
          color="secondaryLabel"
          selectable={selectable}
          style={stacked ? null : styles.labeledValue}
          variant="body"
        >
          {value}
        </Text>
      </View>
    </Cell>
  );
}

export interface SwitchRowProps {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

/** A native `UISwitch` row; the switch is the accessible element. */
export function SwitchRow({ title, subtitle, value, onValueChange, disabled }: SwitchRowProps) {
  return (
    <Cell minHeight={subtitle ? metrics.rowMinHeightSubtitle : metrics.rowMinHeight}>
      <View accessibilityElementsHidden importantForAccessibility="no" style={styles.copy}>
        <Text variant="body">{title}</Text>
        {subtitle ? (
          <Text color="secondaryLabel" variant="subheadline">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityHint={subtitle}
        accessibilityLabel={title}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: palette.accent }}
        value={value}
      />
    </Cell>
  );
}

export interface ActionRowProps extends Omit<CellProps, "children"> {
  title: string;
  /** Destructive actions are `danger`; everything else is `accent`. */
  destructive?: boolean;
  symbol?: SFSymbol;
  /** A trailing symbol, e.g. `arrow.up.forward.app` for rows that leave the app. */
  trailingSymbol?: SFSymbol;
  disabled?: boolean;
}

/** A row that does something ("Invite People…", "Sign Out"): tinted title, no chevron. */
export function ActionRow({
  title,
  destructive,
  symbol,
  trailingSymbol,
  disabled,
  accessibilityLabel,
  ...props
}: ActionRowProps) {
  const tint: ColorName = destructive ? "danger" : "accent";
  return (
    <Cell
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessible
      disabled={disabled}
      separatorInset={
        metrics.rowPaddingHorizontal +
        (symbol ? metrics.rowSymbolColumn + metrics.rowAccessoryGap : 0)
      }
      style={disabled ? styles.disabled : null}
      {...props}
    >
      {symbol ? (
        <View style={[styles.leading, { width: metrics.rowSymbolColumn }]}>
          <SymbolView name={symbol} size={20} tintColor={colors[tint]} />
        </View>
      ) : null}
      <Text color={tint} style={styles.copy} variant="body">
        {title}
      </Text>
      {trailingSymbol ? (
        <SymbolView name={trailingSymbol} size={17} tintColor={colors.placeholder} />
      ) : null}
    </Cell>
  );
}

const styles = StyleSheet.create({
  grouped: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  plain: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: space.xxl,
  },
  section: {
    marginTop: metrics.sectionGap,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space.xs,
    marginBottom: metrics.sectionInnerGap,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
  headerTitle: {
    flex: 1,
  },
  headerStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
  },
  container: {
    overflow: "hidden",
    borderRadius: radius.section,
    borderCurve: "continuous",
    backgroundColor: colors.cell,
  },
  footer: {
    marginTop: metrics.sectionInnerGap,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
  cell: {
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowAccessoryGap,
    paddingHorizontal: metrics.rowPaddingHorizontal,
    paddingVertical: 11,
  },
  highlight: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.fillPressed,
  },
  separator: {
    position: "absolute",
    top: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  plainSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  leading: {
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  value: {
    flexShrink: 1,
    maxWidth: "55%",
    textAlign: "right",
  },
  labeled: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.s,
  },
  labeledStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
  },
  labeledValue: {
    flexShrink: 1,
    textAlign: "right",
  },
  disabled: {
    opacity: 0.4,
  },
});
