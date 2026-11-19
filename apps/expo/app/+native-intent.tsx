import { dropLeftoverPreviews } from "../src/lib/navigation";

/**
 * Expo Router calls this for every incoming URL before handling it. URLs pass
 * through unchanged; while the app is running, screens left preloaded by a
 * dismissed `Link.Preview` are dropped first, so the link can navigate
 * (`src/lib/navigation.ts`).
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  if (!initial) dropLeftoverPreviews();
  return path;
}
