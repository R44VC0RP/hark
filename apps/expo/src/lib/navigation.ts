import { type Href, router, useNavigationContainerRef } from "expo-router";
import { CommonActions } from "expo-router/react-navigation";
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
  routes: { state?: unknown }[];
  preloadedRoutes?: unknown[];
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
