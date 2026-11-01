import type { AppDto, TeamDto } from "@hark/contracts";
import * as Notifications from "expo-notifications";
import { useSyncExternalStore } from "react";
import { api, type OncallMeDto } from "./api";
import {
  previewApps,
  previewOncallMe,
  previewPending,
  previewProjects,
  previewTeams,
} from "./inbox-preview";
import { cacheApps, cachedApp } from "./web-apps";

/**
 * What the launcher and the iPad sidebar show: the account's web apps, its
 * teams and on-call state, and the inbox counts. Both read one snapshot so
 * they never disagree; whoever loads last publishes it.
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

let current: Directory | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishDirectory(directory: Directory): void {
  current = directory;
  for (const listener of listeners) listener();
}

export function useDirectory(): Directory | null {
  return useSyncExternalStore(subscribe, () => current);
}

/** Loads a fresh snapshot (demo data in the simulator) without publishing it. */
export async function loadDirectory(simulatorPreview: boolean): Promise<Directory> {
  if (simulatorPreview) {
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
    // Older servers 404 here; team sections and the on-call strip stay hidden.
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
