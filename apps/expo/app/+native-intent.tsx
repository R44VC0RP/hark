import { dropLeftoverPreviews, leaveSheetForLink, linkWhileRunning } from "../src/lib/navigation";

/**
 * Expo Router calls this for every incoming URL before handling it and
 * awaits the result (null drops the link). The launch URL passes through
 * unchanged. While the app is running, screens left preloaded by a
 * dismissed `Link.Preview` are dropped first, links to the launch chain go
 * straight to the Inbox, and a link that opens a sheet or a web app closes
 * the sheet already up, waiting for Reply's draft prompt when it has one
 * (`src/lib/navigation.ts`).
 */
export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | Promise<string | null> {
  if (initial) return path;
  dropLeftoverPreviews();
  return leaveSheetForLink(linkWhileRunning(path));
}
