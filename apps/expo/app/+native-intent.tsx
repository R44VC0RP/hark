import { closeSheetForLink, dropLeftoverPreviews, linkWhileRunning } from "../src/lib/navigation";

/**
 * Expo Router calls this for every incoming URL before handling it. The
 * launch URL passes through unchanged. While the app is running, screens
 * left preloaded by a dismissed `Link.Preview` are dropped first, a link to
 * a sheet closes the sheet already up, and links to the launch chain go
 * straight to the Inbox (`src/lib/navigation.ts`).
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  if (initial) return path;
  dropLeftoverPreviews();
  closeSheetForLink(path);
  return linkWhileRunning(path);
}
