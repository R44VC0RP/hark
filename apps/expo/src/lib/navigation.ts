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
  routes: { key?: string; name?: string; params?: object; state?: unknown }[];
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
function topSheet(): { key: string; name: string; stackKey: string } | null {
  const stack = rootStack();
  const top = stack?.routes[stack.index ?? stack.routes.length - 1] as
    | { key?: string; name?: string }
    | undefined;
  if (!stack || !top?.key || !top.name || !SHEET_ROUTES.has(top.name)) return null;
  return { key: top.key, name: top.name, stackKey: stack.key };
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

/** The three tabs' stacks (`app/(tabs)`). */
type TabName = "(inbox)" | "(apps)" | "(teams)";

/** Where a link into a tab goes: the tab, and the screen above its root. */
interface TabLink {
  tab: TabName;
  screen?: { name: string; params: Record<string, string> };
}

/** "a=1&b=two" → { a: "1", b: "two" } (React Native has no full URLSearchParams). */
function queryParams(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const [key = "", value = ""] = pair.split("=");
    const decode = (text: string) => decodeURIComponent(text.replace(/\+/g, " "));
    params[decode(key)] = decode(value);
  }
  return params;
}

/**
 * The tab and screen a link opens, for every route that lives in a tab's
 * stack: Inbox (/inbox, /history, /project/…, /notification/…), Apps
 * (/apps), Teams (/teams, /teams/…, /oncall). Null for anything else
 * (sheets, web apps, Sign In, unknown links), which Expo Router handles.
 */
function tabLinkOf(path: string): TabLink | null {
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/\/?)?\/*([^?#]*)(?:\?([^#]*))?/i.exec(path);
  if (!match) return null;
  const segments = (match[1] ?? "").split("/").filter(Boolean).map(decodeURIComponent);
  const query = queryParams(match[2] ?? "");
  const [first, second, third] = segments;
  if (third !== undefined) return null;
  const screen = (name: string, extra: Record<string, string> = {}) => ({
    name,
    params: { ...query, ...extra },
  });
  switch (first) {
    case "inbox":
      return second ? null : { tab: "(inbox)" };
    case "history":
      return second ? null : { tab: "(inbox)", screen: screen("history") };
    case "project":
      return second
        ? { tab: "(inbox)", screen: screen("project/[project]", { project: second }) }
        : null;
    case "notification":
      return second
        ? { tab: "(inbox)", screen: screen("notification/[id]", { id: second }) }
        : null;
    case "apps":
      return second ? null : { tab: "(apps)" };
    case "teams":
      return second
        ? { tab: "(teams)", screen: screen("teams/[id]", { id: second }) }
        : { tab: "(teams)" };
    case "oncall":
      return second ? null : { tab: "(teams)", screen: screen("oncall") };
    default:
      return null;
  }
}

function sameParams(a: object | undefined, b: Record<string, string>): boolean {
  const left = (a ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(b)]);
  return [...keys].every((key) => String(left[key] ?? "") === String(b[key] ?? ""));
}

/**
 * Opens a link into a tab the same way every time (R3V-03): whatever was
 * above the tabs (a web app) goes, the tab is selected, and its stack
 * becomes [root, target] with Back to the root, whatever that stack held
 * and whichever tab was showing. Expo Router's own handling depended on
 * the tab's history: a team link from the Inbox landed on the Teams root
 * without the team, or showed it under the root's bar items with no Back,
 * and a link to a second team replaced the first in place. The root screen
 * keeps its route (no remount), as does the target when it is already the
 * one showing. False when the tabs aren't up (Sign In, Set Up) or the link
 * isn't a tab route: Expo Router handles it then.
 */
function openTabLink(path: string): boolean {
  const link = tabLinkOf(path);
  const root = rootStack();
  if (!link || !root || !navigationRef) return false;
  const tabsIndex = root.routes.findIndex((route) => route.name === "(tabs)");
  const tabs = root.routes[tabsIndex]?.state as NavigatorState | undefined;
  const stack = tabs?.routes.find((route) => route.name === link.tab)?.state as
    | NavigatorState
    | undefined;
  const home = stack?.routes[0];
  if (!tabs || !stack || !home) return false;
  const above = root.routes.length - 1 - tabsIndex;
  if (above > 0) navigationRef.dispatch({ ...StackActions.pop(above), target: root.key });
  navigationRef.dispatch({ ...CommonActions.navigate({ name: link.tab }), target: tabs.key });
  const top = stack.routes[stack.routes.length - 1];
  const target = link.screen;
  const showing =
    target &&
    stack.routes.length === 2 &&
    top?.name === target.name &&
    sameParams(top.params, target.params);
  if (showing || (!target && stack.routes.length === 1)) return true;
  const routes = target ? [home, { name: target.name, params: target.params }] : [home];
  navigationRef.dispatch({
    ...CommonActions.reset({
      ...stack,
      index: routes.length - 1,
      routes,
      preloadedRoutes: [],
    } as never),
    target: stack.key,
  });
  return true;
}

/**
 * Every link that arrives while the app runs (called by
 * `app/+native-intent.tsx`, whose result Expo Router awaits; null means
 * handled or dropped). The sheet on top, if any, closes first, so sheets
 * never stack and nothing opens inside or under a sheet: a notification
 * link that went ahead while Reply was up popped the sheet in the same
 * action that pushed into the tab and left the lower half of the new
 * screen blank and dead (R3-03). A sheet with unsaved work (Reply with a
 * draft) asks first and the link waits: it opens once the sheet has
 * closed, and is dropped if the person keeps editing (I2-02), for every
 * link alike (R3-P2-2). Then a link into a tab opens through
 * `openTabLink`; anything else (a sheet, a web app, an unknown link) goes
 * to Expo Router.
 */
export function followLink(path: string): string | null | Promise<string | null> {
  const open = () => (openTabLink(path) ? null : path);
  const sheet = topSheet();
  if (!sheet) return open();
  return closeSheet(sheet).then((closed) => (closed ? open() : null));
}

/**
 * Closes the sheet on top (Reply with a draft asks first) and resolves
 * once it has gone: true, or false when the person keeps editing. Nothing
 * opens before that. A screen that mounted while a sheet was still leaving
 * was measured inside it: under Reply's half height, the pushed screen was
 * 402 × 423 pt and its lower half stayed blank and dead (R3-03, with an
 * empty Reply and with a draft); on iPad, Link Not Found opened as
 * Critical Alerts closed got the sheet's card size.
 */
function closeSheet(sheet: { key: string }): Promise<boolean> {
  const guard = guardOfTopSheet();
  const closing = guard ? guard.ask() : Promise.resolve(closeTopSheet());
  return closing.then((closed) => (closed ? sheetGone(sheet.key).then(() => true) : false));
}

/**
 * Navigation from outside the screens (notification taps, keyboard
 * shortcuts, the pages accessory) follows the links' rule: never push a
 * tab or root screen inside or under a sheet. `open` runs at once without
 * a sheet, else once the sheet has gone, and not at all if the person
 * keeps editing a Reply draft.
 */
export function afterSheets(open: () => void): void {
  const sheet = topSheet();
  if (!sheet) {
    open();
    return;
  }
  void closeSheet(sheet).then((closed) => {
    if (closed) open();
  });
}

/**
 * Opens an app path the way a link would (`followLink`): the sheet on top
 * closes first; tab routes open as [root, target] in their tab; anything
 * else is pushed.
 */
export function goTo(path: string): void {
  afterSheets(() => {
    if (!openTabLink(path)) router.push(path as Href);
  });
}

/** Links waiting for a sheet to finish leaving, by the sheet's route key. */
const leaving = new Map<string, () => void>();

/**
 * How long a sheet takes to be gone, in ms, for the sheets that never say
 * so: of the sheets, only Reply's closing `transitionEnd` reaches the root
 * stack when JavaScript closes it; Settings, App Info, Page, Join and
 * Critical Alerts send nothing. The navigation state is already right;
 * this only waits for UIKit and react-native-screens to finish with the
 * sheet. Measured on iPad (Settings form sheet): the slide-out ends about
 * 370 ms after it starts, but opening a screen 500 ms after the close
 * still landed a layout pass on the dismissed sheet (red box
 * "sheetPresentationController is null when attempting to set allowed
 * detents", 4 of 4 links and notification taps); at 1000 ms and later,
 * 0 of 4.
 */
const SHEET_DISMISS_MS = 1000;

function sheetGone(routeKey: string): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(fallback);
      leaving.delete(routeKey);
      resolve();
    };
    const fallback = setTimeout(done, SHEET_DISMISS_MS);
    leaving.set(routeKey, done);
  });
}

/**
 * Root layout only: a root screen finished its transition. A sheet that
 * finished closing releases the link waiting for it (`followLink`).
 */
export function rootTransitionEnded(routeKey: string | undefined, closing: boolean): void {
  if (!routeKey || !closing) return;
  leaving.get(routeKey)?.();
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
