import type { AppDto } from "@hark/contracts";
import { Link, router } from "expo-router";
import { memo, type Ref, useSyncExternalStore } from "react";
import {
  type AccessibilityActionEvent,
  AccessibilityInfo,
  Linking,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from "react-native";
import { useHover, useLayout } from "../../lib/layout";
import { Row, useHorizontalSafeArea, useScreenMargin, useStackedRows } from "../../ui/list";
import { Text } from "../../ui/text";
import { colors, space } from "../../ui/tokens";
import { AppIcon } from "../app-icon";

/**
 * The Apps tab's launcher tiles (DESIGN.md 3.3, 5.8). iPhone: four columns,
 * 60-pt icons, `caption1` labels. Regular width (iPad): fixed 104-pt tiles
 * that wrap, 72-pt icons, `footnote` labels. Rows are 24 pt apart. Either
 * way the first icon sits 16 pt inside the content margin, where section
 * headers start. At accessibility text sizes the grid becomes a list, so
 * names are never cut to a few letters.
 */

const COMPACT_COLUMNS = 4;
const COMPACT_ICON = 60;
const REGULAR_TILE = 104;
const REGULAR_ICON = 72;
/** Visible gap between a label and the next row's icon (3.3). */
const ROW_GAP = 24;
/** Room around each tile for the pressed lift and the hover plate. */
const TILE_PADDING = space.xxs;
const LIST_ICON = 44;
const TILE_RADIUS = 16;

export interface GridGeometry {
  /** True at accessibility text sizes: apps are rows, not tiles. */
  list: boolean;
  regular: boolean;
  tileWidth: number;
  iconSize: number;
}

/** Tile size for the current window (narrow iPad windows get the iPhone grid). */
export function useGridGeometry(): GridGeometry {
  const { width, regular } = useLayout();
  const margin = useScreenMargin();
  // `List` pads the content by the margin and the horizontal safe area.
  const safeArea = useHorizontalSafeArea();
  const list = useStackedRows();
  if (regular) {
    return { list, regular, tileWidth: REGULAR_TILE, iconSize: REGULAR_ICON };
  }
  const content = width - 2 * margin - safeArea.paddingLeft - safeArea.paddingRight;
  return { list, regular, tileWidth: content / COMPACT_COLUMNS, iconSize: COMPACT_ICON };
}

/**
 * VoiceOver state, shared by every tile. `Link.Menu` mounts its trigger
 * under a zero-size (`display: contents`) native view, and iOS leaves that
 * whole subtree out of the accessibility tree (checked with the simulator's
 * accessibility hierarchy: no tile was listed). With VoiceOver on, tiles are
 * plain links and offer the menu's actions as VoiceOver actions instead.
 */
let screenReader = false;
const screenReaderListeners = new Set<() => void>();
function setScreenReader(enabled: boolean) {
  if (enabled === screenReader) return;
  screenReader = enabled;
  for (const listener of screenReaderListeners) listener();
}
void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);

function useScreenReader(): boolean {
  return useSyncExternalStore(
    (listener) => {
      screenReaderListeners.add(listener);
      return () => {
        screenReaderListeners.delete(listener);
      };
    },
    () => screenReader,
  );
}

function openAppInfo(app: AppDto) {
  router.push({ pathname: "/apps/[id]", params: { id: app.id } });
}

function openInSafari(app: AppDto) {
  void Linking.openURL(app.url);
}

/** VoiceOver gets the context menu's two actions as custom actions. */
const ACCESSIBILITY_ACTIONS = [
  { name: "info", label: "App Info" },
  { name: "safari", label: "Open in Safari" },
];

function onAccessibilityAction(app: AppDto, event: AccessibilityActionEvent) {
  if (event.nativeEvent.actionName === "info") openAppInfo(app);
  else if (event.nativeEvent.actionName === "safari") openInSafari(app);
}

/**
 * The long-press menu every tile and row shares (2 actions, most common
 * first). A plain function, not a component: `Link` only finds its menu
 * when `Link.Menu` is a direct child.
 */
function appMenu(app: AppDto) {
  return (
    <Link.Menu>
      <Link.MenuAction icon="info.circle" onPress={() => openAppInfo(app)}>
        App Info
      </Link.MenuAction>
      <Link.MenuAction icon="safari" onPress={() => openInSafari(app)}>
        Open in Safari
      </Link.MenuAction>
    </Link.Menu>
  );
}

interface TileButtonProps extends Omit<PressableProps, "style" | "children"> {
  app: AppDto;
  geometry: GridGeometry;
  ref?: Ref<View>;
}

/**
 * The pressable part of a tile. `Link asChild` hands it `onPress`; its own
 * style stays a single object (a `Link asChild` child must not get an array
 * style). Pressed dims to 0.6; iPad pointer hover gets a `fillPressed` plate.
 */
function TileButton({ app, geometry, ref, ...props }: TileButtonProps) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      accessibilityHint="Opens the app"
      accessibilityLabel={app.name}
      accessibilityRole="button"
      onAccessibilityAction={(event) => onAccessibilityAction(app, event)}
      ref={ref}
      {...hoverProps}
      {...props}
      style={({ pressed }) => [
        styles.tile,
        { width: geometry.tileWidth },
        hovered && styles.hovered,
        pressed && styles.pressed,
      ]}
    >
      <AppIcon iconUrl={app.iconUrl} name={app.name} size={geometry.iconSize} />
      <Text
        align="center"
        numberOfLines={1}
        style={styles.label}
        variant={geometry.regular ? "footnote" : "caption1"}
      >
        {app.name}
      </Text>
    </Pressable>
  );
}

/** One launcher tile: opens the web app; long press for App Info and Safari. */
export const AppTile = memo(function AppTile({
  app,
  geometry,
}: {
  app: AppDto;
  geometry: GridGeometry;
}) {
  const href = { pathname: "/web/[id]", params: { id: app.id } } as const;
  const screenReaderOn = useScreenReader();
  if (screenReaderOn) {
    return (
      <Link asChild href={href} push>
        <TileButton app={app} geometry={geometry} />
      </Link>
    );
  }
  return (
    <Link asChild href={href} push>
      <Link.Trigger>
        <TileButton app={app} geometry={geometry} />
      </Link.Trigger>
      {appMenu(app)}
    </Link>
  );
});

/** Tiles that wrap; the parent `Section` is bare, so the grid sits on paper. */
export function AppGrid({ apps, geometry }: { apps: AppDto[]; geometry: GridGeometry }) {
  return (
    <View style={styles.grid}>
      {apps.map((app) => (
        <AppTile app={app} geometry={geometry} key={app.id} />
      ))}
    </View>
  );
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** An app as a row (accessibility text sizes): icon, name and host, same menu. */
export const AppListRow = memo(function AppListRow({ app }: { app: AppDto }) {
  const href = { pathname: "/web/[id]", params: { id: app.id } } as const;
  const row = (
    <Row
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      accessibilityHint="Opens the app"
      leading={<AppIcon iconUrl={app.iconUrl} name={app.name} size={LIST_ICON} />}
      leadingWidth={LIST_ICON}
      onAccessibilityAction={(event) => onAccessibilityAction(app, event)}
      subtitle={hostOf(app.origin)}
      title={app.name}
    />
  );
  const screenReaderOn = useScreenReader();
  if (screenReaderOn) {
    return (
      <Link asChild href={href} push>
        {row}
      </Link>
    );
  }
  return (
    <Link asChild href={href} push>
      <Link.Trigger>{row}</Link.Trigger>
      {appMenu(app)}
    </Link>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: ROW_GAP - TILE_PADDING * 2,
  },
  tile: {
    alignItems: "center",
    gap: 6,
    // Labels get the tile's full width; the padding is only above and below.
    paddingVertical: TILE_PADDING,
    borderRadius: TILE_RADIUS,
    borderCurve: "continuous",
  },
  hovered: {
    backgroundColor: colors.fillPressed,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    alignSelf: "stretch",
  },
});
