import { dropLeftoverPreviews, followLink, linkWhileRunning } from "../src/lib/navigation";

/**
 * Expo Router calls this for every incoming URL before handling it and
 * awaits the result (null: handled here, or dropped). The launch URL
 * passes through unchanged. While the app is running, screens left
 * preloaded by a dismissed `Link.Preview` are dropped first, links to the
 * launch chain go straight to the Inbox, the sheet on top closes first
 * (waiting for Reply's draft prompt when it has one), and links into a tab
 * open as [root, target] in that tab (`src/lib/navigation.ts`).
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null | Promise<string | null> {
  if (initial) return path;
  dropLeftoverPreviews();
  return followLink(linkWhileRunning(path));
}
