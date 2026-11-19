import { type Href, router } from "expo-router";

/**
 * Closes a root sheet (page, join, Critical Alerts). When the sheet is the
 * only route, e.g. after a reload restored its URL, there is nothing to go
 * back to: `fallback` replaces it instead, so Close never does nothing.
 */
export function closeSheet(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
