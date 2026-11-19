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
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

/** Larger than any row: the menu's hit area fills whatever the host is given. */
const FILL = 100_000;
/** A touch that moves farther than this was a scroll, not a tap on the menu. */
const TAP_SLOP = 10;

type SetOpen = (open: boolean) => void;

const ShieldContext = createContext<SetOpen | null>(null);

/**
 * Wraps a screen's list. While one of its row menus is open, a clear view
 * over the screen takes the next touch. iOS 26 menus are not modal: the tap
 * that closes one also reaches whatever is under it (checked on iPhone and
 * iPad, for toolbar menus too), so tapping beside a member's menu opened
 * an on-call group, and could land on Revoke or Leave Team (I-07).
 */
export function MenuShield({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <ShieldContext.Provider value={setOpen}>
      {children}
      {open ? (
        <View
          onResponderRelease={() => setOpen(false)}
          onResponderTerminate={() => setOpen(false)}
          onStartShouldSetResponder={() => true}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </ShieldContext.Provider>
  );
}

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
   * shield goes away with the menu.
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
 * `MenuShield` of the screen until the menu is used or dismissed.
 */
export function RowMenu({ label, hint, value, disabled, children, menu, style }: RowMenuProps) {
  const setShield = useContext(ShieldContext);
  const start = useRef<{ x: number; y: number } | null>(null);
  const done = useCallback(() => setShield?.(false), [setShield]);
  const ended = (event: GestureResponderEvent) => {
    const from = start.current;
    start.current = null;
    if (!from || disabled) return;
    const { pageX, pageY } = event.nativeEvent;
    if (Math.abs(pageX - from.x) <= TAP_SLOP && Math.abs(pageY - from.y) <= TAP_SLOP) {
      setShield?.(true);
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
