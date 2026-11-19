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
 * Never inside a sheet: pushed over one (⌘1 with Settings up) it opened in
 * the sheet, where each change of its header remounted it, in a loop for an
 * app that asks before signing in ("Maximum update depth exceeded", then a
 * blank app). Like a link, it closes the sheet first, after Reply's draft
 * prompt when there is one.
 */
export function openWebApp(id: string, url?: string): void {
  const href = { pathname: "/web/[id]", params: { id, ...(url ? { url } : {}) } } as const;
  const stack = rootStack();
  const sheet = topSheet();
  const below = stack?.routes[(stack.index ?? stack.routes.length - 1) - (sheet ? 1 : 0)];
  const inWebApp = stack ? below?.name === "web/[id]" : currentPath.startsWith("/web/");
  const open = () => (inWebApp ? router.replace(href) : router.push(href));
  const guard = guardOfTopSheet();
  if (guard) {
    void guard.ask().then((closed) => {
      if (closed) open();
    });
    return;
  }
  closeTopSheet();
  open();
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

/** The root stack's top route when it is a sheet. */
function topSheet(): { key: string; stackKey: string } | null {
  const stack = rootStack();
  const top = stack?.routes[stack.index ?? stack.routes.length - 1] as
    | { key?: string; name?: string }
    | undefined;
  if (!stack || !top?.key || !top.name || !SHEET_ROUTES.has(top.name)) return null;
  return { key: top.key, stackKey: stack.key };
}

/** Closes the sheet on top of the app, if any (links, and Esc and ⌘W through `escapeTopSheet`). */
export function closeTopSheet(): boolean {
  const sheet = topSheet();
  if (!sheet || !navigationRef) return false;
  navigationRef.dispatch({ ...StackActions.pop(), target: sheet.stackKey });
  return true;
}

/**
 * A sheet with unsaved work (Reply with a draft) that has to ask before it
 * closes. `ask` shows its prompt (or joins the one already up) and resolves
 * true once the sheet has closed, false when the person keeps editing.
 * `cancel` closes the prompt as Keep Editing; false when none is up.
 */
export interface LeaveGuard {
  ask(): Promise<boolean>;
  cancel(): boolean;
}

let leaveGuard: { routeKey: string; guard: LeaveGuard } | null = null;

/** Reply only, while it has a draft. Returns the removal. */
export function setLeaveGuard(routeKey: string, guard: LeaveGuard): () => void {
  const entry = { routeKey, guard };
  leaveGuard = entry;
  return () => {
    if (leaveGuard === entry) leaveGuard = null;
  };
}

function guardOfTopSheet(): LeaveGuard | null {
  const sheet = topSheet();
  return sheet && leaveGuard?.routeKey === sheet.key ? leaveGuard.guard : null;
}

/**
 * Esc and ⌘W with a sheet up: close the sheet's prompt as Keep Editing when
 * one is up (the reply field keeps the keyboard, so the popover never sees
 * Esc), else close the sheet (which asks first when it has to).
 */
export function escapeTopSheet(): boolean {
  if (guardOfTopSheet()?.cancel()) return true;
  return closeTopSheet();
}

/**
 * Whether a link must not open inside a sheet: it opens a sheet itself
 * ("/join/abc"), or a web app, which opens over the tabs (a web link over
 * the iPad Page sheet opened inside it).
 */
function leavesSheets(path: string): boolean {
  const route = path.replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, "").replace(/^\/+/, "");
  const [first = "", second] = route.split(/[/?#]/);
  if (first === "apps" || first === "web") return Boolean(second);
  return ["critical-alerts", "settings", "join", "pages", "reply"].includes(first);
}

/**
 * A link that opens a sheet or a web app while a sheet is up closes that
 * sheet first, so sheets never stack (a Reply link over the Join sheet
 * showed both) and nothing opens inside a sheet. A sheet with unsaved work
 * asks first and the link waits for the answer: it opens once the sheet has
 * closed, and is dropped if the person keeps editing (a link that went
 * ahead covered the prompt and left Reply unable to close, I2-02). Called
 * by `app/+native-intent.tsx`, whose result Expo Router awaits; null drops
 * the link.
 */
export function leaveSheetForLink(path: string): string | Promise<string | null> {
  if (!leavesSheets(path)) return path;
  const guard = guardOfTopSheet();
  if (guard) return guard.ask().then((closed) => (closed ? path : null));
  closeTopSheet();
  return path;
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
