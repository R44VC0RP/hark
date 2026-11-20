import type { AppDto } from "@hark/contracts";
import { router } from "expo-router";
import { memo, type Ref } from "react";
import { Linking, Pressable, type PressableProps, StyleSheet, View } from "react-native";
import { useHover, useLayout } from "../../lib/layout";
import { hostOf } from "../../lib/web-apps";
import {
  Row,
  useHorizontalSafeArea,
  useLargeText,
  useScreenMargin,
  useStackedRows,
} from "../../ui/list";
import { MenuLink, type MenuLinkAction } from "../../ui/menu-link";
import { Text } from "../../ui/text";
import { colors, space } from "../../ui/tokens";
import { AppIcon } from "../app-icon";

/**
 * The Apps tab's launcher tiles (DESIGN.md 3.3, 5.8). iPhone: four columns,
 * 60-pt icons, `caption1` labels. Regular width (iPad): fixed 104-pt tiles
 * that wrap, 72-pt icons, `footnote` labels. Rows are 24 pt apart. Either
 * way the first icon sits 16 pt inside the content margin, where section
 * headers start. At accessibility text sizes the grid becomes a list, so
 * names are never cut to a few letters; on iPhone widths already from
 * xxxLarge, where four columns kept 6–8 letters ("Home C…", SS-03).
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
  /** True at accessibility text sizes (iPhone widths: from xxxLarge): apps are rows, not tiles. */
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
  const stacked = useStackedRows();
  const largeText = useLargeText();
  const list = stacked || (!regular && largeText);
  if (regular) {
    return { list, regular, tileWidth: REGULAR_TILE, iconSize: REGULAR_ICON };
  }
  const content = width - 2 * margin - safeArea.paddingLeft - safeArea.paddingRight;
  return { list, regular, tileWidth: content / COMPACT_COLUMNS, iconSize: COMPACT_ICON };
}

function openAppInfo(app: AppDto) {
  router.push({ pathname: "/apps/[id]", params: { id: app.id } });
}

function openInSafari(app: AppDto) {
  void Linking.openURL(app.url);
}

/** The long-press menu every tile and row shares (2 actions, most common first). */
function appActions(app: AppDto): MenuLinkAction[] {
  return [
    { name: "info", label: "App Info", icon: "info.circle", onPress: () => openAppInfo(app) },
    { name: "safari", label: "Open in Safari", icon: "safari", onPress: () => openInSafari(app) },
  ];
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
      accessibilityHint="Opens the app"
      accessibilityLabel={app.name}
      accessibilityRole="button"
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
  return (
    <MenuLink
      actions={appActions(app)}
      href={{ pathname: "/web/[id]", params: { id: app.id } }}
      push
    >
      <TileButton app={app} geometry={geometry} />
    </MenuLink>
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

/** An app as a row (accessibility text sizes): icon, name and host, same menu. */
export const AppListRow = memo(function AppListRow({ app }: { app: AppDto }) {
  return (
    <MenuLink
      actions={appActions(app)}
      href={{ pathname: "/web/[id]", params: { id: app.id } }}
      push
    >
      <Row
        accessibilityHint="Opens the app"
        leading={<AppIcon iconUrl={app.iconUrl} name={app.name} size={LIST_ICON} />}
        leadingWidth={LIST_ICON}
        subtitle={hostOf(app.origin)}
        title={app.name}
      />
    </MenuLink>
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
