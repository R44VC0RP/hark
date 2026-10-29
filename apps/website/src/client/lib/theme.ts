import { useSyncExternalStore } from "react";

/** Seasonal theme set on <html data-theme> by /theme.js before first paint. */
export type SiteTheme = "default" | "halloween";

const subscribe = () => () => {};

/**
 * The active seasonal theme. Prerendered markup is the default theme; the
 * real value applies after hydration (colors already apply from CSS).
 */
export function useSiteTheme(): SiteTheme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === "halloween" ? "halloween" : "default"),
    () => "default",
  );
}
