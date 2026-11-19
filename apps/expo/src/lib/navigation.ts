import { type Href, router, useNavigationContainerRef } from "expo-router";
import { CommonActions, StackActions } from "expo-router/react-navigation";
import { useEffect } from "react";

/**
 * Navigation helpers shared by every screen (DESIGN.md 5.0). The root layout
 * reports the current path, so these work outside React components too.
 */

let currentPath = "/";

/** Called by the root layout whenever the pathname changes. */
export function setCurrentPath(path: string): void {
  currentPath = path;
}

/**
 * Opens a web app. From inside a web app it replaces the open one (⌘1–9,
 * Switch App), so the stack never piles up apps; anywhere else it pushes.
 */
export function openWebApp(id: string, url?: string): void {
  const href = { pathname: "/web/[id]", params: { id, ...(url ? { url } : {}) } } as const;
  if (currentPath.startsWith("/web/")) router.replace(href);
  else router.push(href);
}

/**
 * Goes back (closes a sheet or web app, pops a screen). When there is
 * nothing to go back to, e.g. after a reload restored the URL, `fallback`
 * replaces it instead, so Close never does nothing.
 */
export function backOr(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/**
 * Closes the sheet this is called from, then opens `href` from the screen
 * underneath (a sheet that opens a web app or another route).
 */
export function leaveSheetThenPush(href: Href): void {
  router.back();
  router.push(href);
}

/**
 * Leaves the signed-in app for Sign In (`/`) or Set Up (`/home`): closes the
 * sheet or web app on top, then replaces the tabs, so nothing signed-in stays
 * mounted underneath. Use it for sign out, delete account and re-registering.
 */
export function leaveAppTo(href: "/" | "/home"): void {
  if (router.canDismiss()) router.dismissAll();
  router.replace(href);
}

/** The parts of a navigator's state that `dropLeftoverPreviews` reads. */
interface NavigatorState {
  key: string;
  type?: string;
  index?: number;
  routes: { name?: string; state?: unknown }[];
  preloadedRoutes?: unknown[];
}

/** Root routes presented as sheets (`app/_layout.tsx`). */
export const SHEET_ROUTES: ReadonlySet<string> = new Set([
  "apps/[id]",
  "pages/[id]",
  "join/[code]",
  "critical-alerts",
  "reply/[id]",
  "settings",
]);

/** The root Stack's state: expo-router nests it under its own `__root` route. */
function rootStack(): NavigatorState | undefined {
  const container = navigationRef?.getRootState() as NavigatorState | undefined;
  return container?.routes?.[0]?.state as NavigatorState | undefined;
}

/** Closes the sheet on top of the app, if any (iPad Esc and ⌘W, links). */
export function closeTopSheet(): boolean {
  const stack = rootStack();
  const top = stack?.routes[stack.index ?? stack.routes.length - 1];
  if (!stack || !navigationRef || !top?.name || !SHEET_ROUTES.has(top.name)) return false;
  navigationRef.dispatch({ ...StackActions.pop(), target: stack.key });
  return true;
}

/** The sheet route a link opens ("/join/abc" → "join/[code]"), if it opens one. */
function sheetRouteOf(path: string): string | null {
  const route = path.replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, "").replace(/^\/+/, "");
  const [first = "", second] = route.split(/[/?#]/);
  if (first === "apps") return second ? "apps/[id]" : null;
  if (first === "critical-alerts" || first === "settings") return first;
  if (first === "join") return "join/[code]";
  if (first === "pages") return "pages/[id]";
  if (first === "reply") return "reply/[id]";
  return null;
}

/**
 * A link that opens a sheet while another sheet is up closes that one first,
 * so sheets never stack (a Reply link over the Join sheet showed both).
 * Called by `app/+native-intent.tsx` before the link is handled.
 */
export function closeSheetForLink(path: string): void {
  if (sheetRouteOf(path)) closeTopSheet();
}

interface NavigationRef {
  getRootState(): unknown;
  dispatch(action: object): void;
}

let navigationRef: NavigationRef | null = null;

/** Root layout only: lets `dropLeftoverPreviews` reach the navigation state. */
export function useNavigationForLinks(): void {
  const navigation = useNavigationContainerRef();
  useEffect(() => {
    navigationRef = navigation as unknown as NavigationRef;
    return () => {
      navigationRef = null;
    };
  }, [navigation]);
}

function dropPreloadedRoutes(state: NavigatorState, dispatch: (action: object) => void): void {
  if (state.type === "stack" && state.preloadedRoutes?.length) {
    dispatch({
      ...CommonActions.reset({ ...state, preloadedRoutes: [] } as never),
      target: state.key,
    });
  }
  for (const route of state.routes) {
    if (route.state) dropPreloadedRoutes(route.state as NavigatorState, dispatch);
  }
}

/**
 * Drops the screens a dismissed `Link.Preview` left preloaded (called by
 * `app/+native-intent.tsx` before a link is handled). Touch and hold
 * preloads the destination, and a dismissed preview leaves it there; taps
 * and pushes adopt it, but a deep link to the same route did nothing: links
 * are NAVIGATE actions with `pop`, and expo-router's stack router takes the
 * preloaded route but only looks for it among the visible routes (checked in
 * the simulator with `hark://notification/…` after a preview). Each preview
 * replaces the last one, so at most one waits per stack.
 */
export function dropLeftoverPreviews(): void {
  const root = navigationRef?.getRootState() as NavigatorState | undefined;
  if (root && navigationRef) dropPreloadedRoutes(root, navigationRef.dispatch.bind(navigationRef));
}

/**
 * Where a link that arrives while the app is running should go (called by
 * `app/+native-intent.tsx`). `hark://` and `/home` re-run the launch chain
 * (`/` → `/home` → `/inbox`), whose last step replaces the screen on top with
 * the tabs: with the tabs already up that stacked a second, hidden tab bar
 * (checked in the simulator). Inside the signed-in app they go straight to
 * the Inbox; on Sign In and Set Up they are left alone.
 */
export function linkWhileRunning(url: string): string {
  if (currentPath === "/" || currentPath === "/home") return url;
  const match = /^([a-z][a-z0-9+.-]*:\/\/\/?)([^?#]*)(.*)$/i.exec(url);
  if (!match) return url;
  const [, scheme = "", path = "", rest = ""] = match;
  const route = path.replace(/^\/+|\/+$/g, "");
  return route === "" || route === "home" ? `${scheme}inbox${rest}` : url;
}
