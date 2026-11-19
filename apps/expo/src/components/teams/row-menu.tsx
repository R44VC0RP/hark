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
export function RowMenu({ label, hint, value, disabled, children, menu, style }: RowMenuProps) {
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
                frame({ maxWidth: FILL, maxHeight: FILL }),
              ]}
            />
          }
          modifiers={[
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
