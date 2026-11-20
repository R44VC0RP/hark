import { Host, Menu, Rectangle } from "@expo/ui/swift-ui";
import {
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  contentShape,
  disabled as disabledModifier,
  foregroundStyle,
  frame,
  menuOrder,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

/** Larger than any row: the menu's hit area fills whatever the host is given. */
const FILL = 100_000;
/**
 * How much of a row the menu takes its touches on and grows from: a pop-up
 * button's value and chevrons at the trailing end, an action row's symbol
 * and title at the leading end.
 */
const ANCHOR_WIDTH = { trailing: 160, leading: 300 } as const;

export interface RowMenuProps {
  /** What VoiceOver reads for the control ("Repeat Every", "Manage Priya Shah"). */
  label: string;
  hint?: string;
  /** The current value of a pop-up button ("Group Default"). */
  value?: string;
  disabled?: boolean;
  /** The row or control as it is drawn; it never receives the touch. */
  children: ReactNode;
  /** The menu's items (`Button`, `Toggle`, `Section`, `Divider` from `@expo/ui/swift-ui`). */
  menu: ReactNode;
  /**
   * The end of a full row that is the control: `trailing` for a pop-up
   * button's value (as in Settings), `leading` for an action row's title.
   * Without it the whole control opens the menu (a small button such as ⋯).
   */
  anchor?: "leading" | "trailing";
  style?: StyleProp<ViewStyle>;
}

/**
 * A native menu (a SwiftUI `Menu`, which UIKit presents as a `UIMenu`) that
 * opens from a row or control in content, like a pop-up button or a "⋯"
 * button, instead of an anchored action sheet (a popover on iPad). The React
 * Native view underneath only draws; a clear SwiftUI menu label covers it and
 * takes the touch. The tap that closes the menu never reaches the content
 * under it (`modules/hark-menu-gate`).
 */
export function RowMenu({
  label,
  hint,
  value,
  disabled,
  children,
  menu,
  anchor,
  style,
}: RowMenuProps) {
  // A menu grows from its whole label, so a label covering the full row
  // opened it over the row's middle, on top of its title (V2-11). Anchored,
  // the label is only the value's (or the title's) end of the row, like a
  // pop-up button in Settings: the menu grows from there and the rest of
  // the row stays readable.
  return (
    <View style={style}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
      <Host style={StyleSheet.absoluteFill}>
        <Menu
          label={
            <Rectangle
              modifiers={[
                foregroundStyle("#00000000"),
                contentShape(shapes.rectangle()),
                frame({ maxWidth: anchor ? ANCHOR_WIDTH[anchor] : FILL, maxHeight: FILL }),
              ]}
            />
          }
          modifiers={[
            ...(anchor ? [frame({ maxWidth: FILL, maxHeight: FILL, alignment: anchor })] : []),
            menuOrder("fixed"),
            accessibilityLabel(label),
            ...(value ? [accessibilityValue(value)] : []),
            ...(hint ? [accessibilityHint(hint)] : []),
            disabledModifier(Boolean(disabled)),
          ]}
        >
          {menu}
        </Menu>
      </Host>
    </View>
  );
}
