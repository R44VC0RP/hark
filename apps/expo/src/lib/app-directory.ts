import type { AppDto, TeamDto } from "@hark/contracts";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { usePathname } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { api, type OncallMeDto } from "./api";
import {
  previewApps,
  previewOncallMe,
  previewPending,
  previewProjects,
  previewTeams,
} from "./inbox-preview";
import { onPageClaimed } from "./teams";
import { cacheApps, cachedApp } from "./web-apps";

/**
 * What the tab bar badges, the pages accessory, the Apps and Teams tabs and
 * the keyboard shortcuts show: the account's web apps, its teams and on-call
 * state, and the inbox counts. Everything reads one snapshot so nothing
 * disagrees; `refreshDirectory` replaces it.
 */
export interface Directory {
  apps: AppDto[];
  /** `null` on servers without teams. */
  teams: TeamDto[] | null;
  /** `null` on servers without on-call. */
  oncall: OncallMeDto | null;
  unread: number;
  waiting: number;
}

/** Reloads at most this often while navigating. */
const NAVIGATION_REFRESH_MS = 5000;

const simulatorPreview = __DEV__ && !Device.isDevice;

let current: Directory | null = null;
let currentJson = "";
/** The last load failed; cleared by the next successful one. */
let failed = false;
let inflight: Promise<Directory> | null = null;
/** The follow-up load requested while `inflight` runs. */
let queued: Promise<Directory> | null = null;
let lastRefreshAt = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

/** Publishes a snapshot; an identical one keeps the old object, so nothing re-renders. */
export function publishDirectory(directory: Directory): void {
  const json = JSON.stringify(directory);
  const changed = json !== currentJson || failed;
  failed = false;
  if (json !== currentJson) {
    current = directory;
    currentJson = json;
  }
  if (changed) notify();
}

/**
 * The Inbox refreshes more often than the directory; its counts keep the
 * Inbox tab badge in step with the app icon badge between directory loads.
 */
export function publishInboxCounts(counts: { unread: number; waiting: number }): void {
  if (!current) return;
  if (current.unread === counts.unread && current.waiting === counts.waiting) return;
  publishDirectory({ ...current, ...counts });
}

export function useDirectory(): Directory | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** True while the most recent load failed (screens show `ErrorState` when they have no data). */
export function useDirectoryLoadFailed(): boolean {
  return useSyncExternalStore(subscribe, () => failed);
}

/** Loads a fresh snapshot (demo data in the simulator) without publishing it. */
export async function loadDirectory(preview: boolean): Promise<Directory> {
  if (preview) {
    // Keep consent granted earlier in this preview session.
    const apps = previewApps.map((app) => cachedApp(app.id) ?? app);
    cacheApps(apps);
    return {
      apps,
      teams: [...previewTeams],
      oncall: previewOncallMe,
      unread: previewProjects.totalUnread,
      waiting: previewPending.length,
    };
  }
  const [appResult, pendingResult, projectResult, teamResult, oncallResult] = await Promise.all([
    api.listApps(),
    api.listPendingInteractions().catch(() => null),
    api.listInboxProjects().catch(() => null),
    // Older servers 404 here; team sections and on-call stay hidden.
    api.listTeams().catch(() => null),
    api.getMyOncall().catch(() => null),
  ]);
  cacheApps(appResult.apps);
  const waiting = pendingResult?.interactions.length ?? 0;
  const unread = projectResult?.totalUnread ?? 0;
  // Same badge rule as the inbox: pending requests plus unread notifications.
  if (pendingResult && projectResult) {
    void Notifications.setBadgeCountAsync(waiting + unread).catch(() => {});
  }
  return {
    apps: appResult.apps,
    teams: teamResult?.teams ?? null,
    oncall: oncallResult,
    unread,
    waiting,
  };
}

/**
 * Loads and publishes a fresh snapshot. A call made while one is loading gets
 * one more load that starts after it, shared by every such call: the running
 * load may have started before the caller's change (an app moved, a page
 * acknowledged) and would publish what was true before it. Loads never
 * overlap, so responses arrive in order. Rejects when the load fails (pull to
 * refresh shows that; background callers ignore it).
 */
export function refreshDirectory(): Promise<Directory> {
  if (queued) return queued;
  if (inflight) {
    queued = inflight
      .catch(() => undefined)
      .then(() => {
        queued = null;
        return startLoad();
      });
    return queued;
  }
  return startLoad();
}

function startLoad(): Promise<Directory> {
  lastRefreshAt = Date.now();
  const task = loadDirectory(simulatorPreview)
    .then((directory) => {
      publishDirectory(directory);
      return directory;
    })
    .catch((error: unknown) => {
      if (!failed) {
        failed = true;
        notify();
      }
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  inflight = task;
  return task;
}

/**
 * Keeps the directory fresh while the signed-in app is open (mounted once,
 * in the tabs layout): on mount, when the app becomes active, when a push
 * arrives or a page is claimed, and at most every 5 seconds on navigation.
 */
export function useDirectoryRefresh(): void {
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: navigating is the refresh signal.
  useEffect(() => {
    if (Date.now() - lastRefreshAt < NAVIGATION_REFRESH_MS) return;
    void refreshDirectory().catch(() => {});
  }, [pathname]);

  useEffect(() => {
    const refresh = () => void refreshDirectory().catch(() => {});
    const received = Notifications.addNotificationReceivedListener(refresh);
    const claimed = onPageClaimed(refresh);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      received.remove();
      claimed();
      appState.remove();
    };
  }, []);
}
