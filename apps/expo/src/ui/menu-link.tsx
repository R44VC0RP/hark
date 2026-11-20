import { type Href, Link } from "expo-router";
import type { SFSymbol } from "expo-symbols";
import { cloneElement, type ReactElement } from "react";
import type { AccessibilityActionEvent, AccessibilityActionInfo } from "react-native";
import { useScreenReader } from "./a11y";

export interface MenuLinkAction {
  /** The accessibility action's name; unique within the menu. */
  name: string;
  /** Title case, also what VoiceOver reads in the Actions rotor. */
  label: string;
  icon?: SFSymbol;
  destructive?: boolean;
  onPress: () => void;
}

/** The props `MenuLink` adds to its child. */
interface TriggerProps {
  accessibilityActions?: readonly AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}

export interface MenuLinkProps {
  href: Href;
  /** Always push a new screen (`Link push`), e.g. app tiles. */
  push?: boolean;
  /** Touch and hold also previews the destination (notification rows, 3.6). */
  preview?: boolean;
  /** The context menu: two actions at most, most common first (3.6). */
  actions: MenuLinkAction[];
  /**
   * One pressable element (`Cell`, `Pressable`, `Row`) with its own label,
   * role and hint. `Link asChild` hands it `onPress`, so its `style` must be
   * a single object, never an array.
   */
  children: ReactElement<TriggerProps>;
}

/**
 * A row or tile that opens `href` and has a context menu (DESIGN.md 3.6).
 * Sighted: the native menu, with a lift or a preview of the destination. The
 * menu's actions are always also the element's accessibility actions. While
 * VoiceOver runs it renders a plain link instead: `Link.Menu` mounts its
 * trigger under a zero-size native view that iOS leaves out of the
 * accessibility tree, so VoiceOver could not reach the row at all.
 */
export function MenuLink({ href, push, preview, actions, children }: MenuLinkProps) {
  const screenReader = useScreenReader();
  const trigger = cloneElement(children, {
    accessibilityActions: actions.map(({ name, label }) => ({ name, label })),
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      actions.find((action) => action.name === event.nativeEvent.actionName)?.onPress();
    },
  });
  if (screenReader) {
    return (
      <Link asChild href={href} push={push}>
        {trigger}
      </Link>
    );
  }
  return (
    <Link asChild href={href} push={push}>
      <Link.Trigger>{trigger}</Link.Trigger>
      {preview ? <Link.Preview /> : null}
      <Link.Menu>
        {actions.map((action) => (
          <Link.MenuAction
            destructive={action.destructive}
            icon={action.icon}
            key={action.name}
            onPress={action.onPress}
          >
            {action.label}
          </Link.MenuAction>
        ))}
      </Link.Menu>
    </Link>
  );
}
