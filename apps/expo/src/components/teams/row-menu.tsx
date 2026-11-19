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
import { type ReactNode, useRef } from "react";
import {
  type GestureResponderEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useDismissShield } from "../../ui/dismiss-shield";

/** Larger than any row: the menu's hit area fills whatever the host is given. */
const FILL = 100_000;
/** A touch that moves farther than this was a scroll, not a tap on the menu. */
const TAP_SLOP = 10;

export interface RowMenuProps {
  /** What VoiceOver reads for the control ("Repeat Every", "Manage Priya Shah"). */
  label: string;
  hint?: string;
  /** The current value of a pop-up button ("Group Default"). */
  value?: string;
  disabled?: boolean;
  /** The row or control as it is drawn; it never receives the touch. */
  children: ReactNode;
  /**
   * The menu's items (`Button`, `Toggle`, `Section`, `Divider` from
   * `@expo/ui/swift-ui`). Every item calls `done` first, so the screen's
   * `DismissShield` goes away with the menu.
   */
  menu: (done: () => void) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A native menu (a SwiftUI `Menu`, which UIKit presents as a `UIMenu`) that
 * opens from a row or control in content, like a pop-up button or a "⋯"
 * button, instead of an anchored action sheet (a popover on iPad). The React
 * Native view underneath only draws; a clear SwiftUI menu label covers it and
 * takes the touch. React Native still sees that tap, which raises the
 * screen's `DismissShield` (`src/ui/dismiss-shield.tsx`) until the menu is
 * used or dismissed.
 */
export function RowMenu({ label, hint, value, disabled, children, menu, style }: RowMenuProps) {
  const shield = useDismissShield();
  const start = useRef<{ x: number; y: number } | null>(null);
  const done = shield.lower;
  const ended = (event: GestureResponderEvent) => {
    const from = start.current;
    start.current = null;
    if (!from || disabled) return;
    const { pageX, pageY } = event.nativeEvent;
    if (Math.abs(pageX - from.x) <= TAP_SLOP && Math.abs(pageY - from.y) <= TAP_SLOP) {
      shield.raise();
    }
  };
  return (
    <View
      onTouchCancel={ended}
      onTouchEnd={ended}
      onTouchStart={(event) => {
        start.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      }}
      style={style}
    >
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
          {menu(done)}
        </Menu>
      </Host>
    </View>
  );
}
