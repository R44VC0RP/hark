import { requireOptionalNativeModule } from "expo";

/**
 * Clears what web apps left in WKWebView's persistent store (cookies,
 * storage, caches) via the local `modules/hark-website-data` native module.
 * Failures never block sign-out or revoke; builds without the module no-op.
 */
interface HarkWebsiteDataModule {
  clearAllAsync(): Promise<void>;
  clearHostAsync(host: string): Promise<void>;
}

const native = requireOptionalNativeModule<HarkWebsiteDataModule>("HarkWebsiteData");

/** Removes every web app's data; used on Hark sign-out and account deletion. */
export async function clearAllWebsiteData(): Promise<void> {
  await native?.clearAllAsync().catch(() => {});
}

/** Removes the data stored for one web app's host; used on revoke. */
export async function clearWebsiteDataForOrigin(origin: string): Promise<void> {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return;
  }
  await native?.clearHostAsync(host).catch(() => {});
}
