import { type Href, router } from "expo-router";

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
