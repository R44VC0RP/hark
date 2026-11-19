import type { AppDto } from "@hark/contracts";
import { router, usePathname } from "expo-router";
import { useEffect, useRef } from "react";
import { type Directory, useDirectory } from "../lib/app-directory";
import { type KeyCommand, onKeyCommand, setKeyCommands } from "../lib/key-commands";
import { openWebApp } from "../lib/navigation";
import { groupAppsByTeam } from "../lib/teams";

/** Web apps in launcher order: your own, then each team's. */
export function orderedApps(directory: Directory | null): AppDto[] {
  if (!directory) return [];
  const grouped = groupAppsByTeam(directory.apps, directory.teams ?? []);
  return [...grouped.personal, ...grouped.teams.flatMap((team) => team.apps)];
}

/** Selects a tab; React Navigation closes any web app or sheet on top of the tabs. */
function showTab(href: "/inbox" | "/apps"): void {
  router.navigate(href);
}

/**
 * iPad keyboard shortcuts (hold ⌘ to list them, DESIGN.md 2.6): ⌘0 Apps,
 * ⌘1–9 the first nine web apps, ⇧⌘I Inbox, ⌘, Settings; inside a web app
 * also ⌘R, ⌘[, ⌘] and ⌘W (handled by that screen). Mounted once, in the
 * tabs layout, so it stays active over web apps and sheets.
 */
export function KeyboardShortcuts() {
  const pathname = usePathname();
  const directory = useDirectory();
  const apps = orderedApps(directory).slice(0, 9);
  const inWebApp = pathname.startsWith("/web/");
  const appKey = apps.map((app) => `${app.id}:${app.name}`).join("|");

  // biome-ignore lint/correctness/useExhaustiveDependencies: appKey stands in for apps.
  useEffect(() => {
    const commands: KeyCommand[] = [
      { id: "apps", input: "0", modifiers: ["command"], title: "Apps" },
      ...apps.map((app, index) => ({
        id: `app:${app.id}`,
        input: String(index + 1),
        modifiers: ["command"] as KeyCommand["modifiers"],
        title: app.name,
      })),
      { id: "inbox", input: "i", modifiers: ["command", "shift"], title: "Inbox" },
      { id: "settings", input: ",", modifiers: ["command"], title: "Settings" },
    ];
    if (inWebApp) {
      commands.push(
        { id: "reload", input: "r", modifiers: ["command"], title: "Reload" },
        { id: "back", input: "[", modifiers: ["command"], title: "Back" },
        { id: "forward", input: "]", modifiers: ["command"], title: "Forward" },
        { id: "close", input: "w", modifiers: ["command"], title: "Close App" },
      );
    }
    setKeyCommands(commands);
  }, [appKey, inWebApp]);

  // Settings opens over whatever is showing; navigate keeps a second ⌘, from stacking it.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // biome-ignore lint/correctness/useExhaustiveDependencies: appKey stands in for apps.
  useEffect(() => {
    const subscriptions = [
      onKeyCommand("apps", () => showTab("/apps")),
      onKeyCommand("inbox", () => showTab("/inbox")),
      onKeyCommand("settings", () => {
        if (!pathRef.current.startsWith("/settings")) router.push("/settings");
      }),
      ...apps.map((app) => onKeyCommand(`app:${app.id}`, () => openWebApp(app.id))),
    ];
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, [appKey]);

  return null;
}
