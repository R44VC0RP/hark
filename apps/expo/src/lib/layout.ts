import { useMemo, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";

/**
 * iPad layout. Everything keys off the window width, not the device, so a
 * Split View, Slide Over or Stage Manager window gets the layout that fits it:
 * narrow windows look exactly like the iPhone app.
 */

/** From here up, content gets regular-width margins, tiles and columns. */
export const REGULAR_MIN_WIDTH = 700;
/** Widest a column of text and rows gets before it centers (legacy screens). */
export const READABLE_WIDTH = 720;

export const isPad = Platform.OS === "ios" && Platform.isPad;

/** "iPad" or "iPhone", for copy that names this device. */
export const deviceNoun = isPad ? "iPad" : "iPhone";

export function useLayout() {
  const { width } = useWindowDimensions();
  return { width, regular: width >= REGULAR_MIN_WIDTH };
}

/** Centers a screen's content at READABLE_WIDTH; a no-op on iPhone widths. */
export const readableColumn = {
  width: "100%",
  maxWidth: READABLE_WIDTH,
  alignSelf: "center",
} as const;

/**
 * Trackpad or mouse hover on iPad, for a highlight like UIKit's pointer
 * effect. Spread `hoverProps` on a Pressable and style with `hovered`.
 */
export function useHover() {
  const [hovered, setHovered] = useState(false);
  const hoverProps = useMemo(
    () => ({ onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }),
    [],
  );
  return { hovered, hoverProps };
}
