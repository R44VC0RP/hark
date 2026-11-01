import { createContext, createElement, type ReactNode, useContext, useMemo, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";

/**
 * iPad layout. Everything keys off the window width, not the device, so a
 * Split View, Slide Over or Stage Manager window gets the layout that fits it:
 * narrow windows look exactly like the iPhone app.
 */

/** From here up, content sits in a readable column and grids get roomier. */
export const REGULAR_MIN_WIDTH = 700;
/** From here up, the sidebar can sit next to the content. */
export const SIDEBAR_MIN_WIDTH = 960;
export const SIDEBAR_WIDTH = 288;
/** Widest a column of text and rows gets before it centers. */
export const READABLE_WIDTH = 720;

export const isPad = Platform.OS === "ios" && Platform.isPad;

/** "iPad" or "iPhone", for copy that names this device. */
export const deviceNoun = isPad ? "iPad" : "iPhone";

export function useLayout() {
  const { width } = useWindowDimensions();
  return { width, regular: width >= REGULAR_MIN_WIDTH, sidebarFits: width >= SIDEBAR_MIN_WIDTH };
}

/** Centers a screen's content at READABLE_WIDTH; a no-op on iPhone widths. */
export const readableColumn = {
  width: "100%",
  maxWidth: READABLE_WIDTH,
  alignSelf: "center",
} as const;

interface SidebarState {
  /** Shown, docked beside the content or sliding over it. */
  open: boolean;
  /** Shown and taking up width next to the content (wide windows). */
  docked: boolean;
  /** The window can show a sidebar at all, docked or over the content. */
  fits: boolean;
  toggle: () => void;
  /** Hides a sidebar that slid over the content; docked ones stay. */
  dismiss: () => void;
}

const SidebarContext = createContext<SidebarState>({
  open: false,
  docked: false,
  fits: false,
  toggle: () => {},
  dismiss: () => {},
});

/**
 * Wide windows dock the sidebar (it can be hidden); iPad-sized windows too
 * narrow for that, like an 11-inch iPad in portrait, slide it over the
 * content on demand, as Mail does. `enabled` is false on screens without a
 * sidebar (sign-in, setup).
 */
export function SidebarProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { regular, sidebarFits } = useLayout();
  const [hidden, setHidden] = useState(false);
  const [overlaid, setOverlaid] = useState(false);
  const canDock = enabled && sidebarFits;
  const canOverlay = enabled && regular && !sidebarFits;
  const value = useMemo(() => {
    const docked = canDock && !hidden;
    const open = docked || (canOverlay && overlaid);
    return {
      open,
      docked,
      fits: canDock || canOverlay,
      toggle: () =>
        canDock ? setHidden((current) => !current) : setOverlaid((current) => !current),
      dismiss: () => setOverlaid(false),
    };
  }, [canDock, canOverlay, hidden, overlaid]);
  return createElement(SidebarContext.Provider, { value }, children);
}

export function useSidebar(): SidebarState {
  return useContext(SidebarContext);
}
