import type { AppDto } from "@hark/contracts";
import { usePathname, useRootNavigationState } from "expo-router";
import { useEffect, useRef } from "react";
import { type Directory, useDirectory } from "../lib/app-directory";
import { type KeyCommand, onKeyCommand, setKeyCommands } from "../lib/key-commands";
import { escapeTopSheet, goTo, openWebApp, SHEET_ROUTES } from "../lib/navigation";
import { groupAppsByTeam } from "../lib/teams";

/** Web apps in launcher order: your own, then each team's. */
export function orderedApps(directory: Directory | null): AppDto[] {
  if (!directory) return [];
  const grouped = groupAppsByTeam(directory.apps, directory.teams ?? []);
  return [...grouped.personal, ...grouped.teams.flatMap((team) => team.apps)];
}

/**
 * iPad keyboard shortcuts (hold ⌘ to list them, DESIGN.md 2.6): ⌘0 Apps,
 * ⌘1–9 the first nine web apps, ⇧⌘I Inbox, ⌘, Settings; inside a web app
 * also ⌘R, ⌘[, ⌘] and ⌘W (handled by that screen); with a sheet up, Esc and
 * ⌘W close it. Mounted once, in the tabs layout, so it stays active over web
 * apps and sheets.
 */
export function KeyboardShortcuts() {
  const pathname = usePathname();
  const directory = useDirectory();
  // expo-router nests the root layout's Stack under its own `__root` route.
  const stackState = useRootNavigationState()?.routes?.[0]?.state;
  const topRoute = stackState?.routes?.[stackState.index ?? 0]?.name;
  const sheetOnTop = topRoute !== undefined && SHEET_ROUTES.has(topRoute);
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
    if (sheetOnTop) {
      // Like a sheet on the Mac. With the sheet's own prompt up (Reply's
      // draft), Esc closes the prompt as Keep Editing instead: the focused
      // reply field keeps Esc from ever reaching the popover.
      commands.push(
        { id: "closeSheet", input: "escape", modifiers: [], title: "Close" },
        { id: "closeSheetW", input: "w", modifiers: ["command"], title: "Close" },
      );
    } else if (inWebApp) {
      commands.push(
        { id: "reload", input: "r", modifiers: ["command"], title: "Reload" },
        { id: "back", input: "[", modifiers: ["command"], title: "Back" },
        { id: "forward", input: "]", modifiers: ["command"], title: "Forward" },
        { id: "close", input: "w", modifiers: ["command"], title: "Back to Hark" },
      );
    }
    setKeyCommands(commands);
  }, [appKey, inWebApp, sheetOnTop]);

  // Read at key-press time; the subscriptions below only change with the apps.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // biome-ignore lint/correctness/useExhaustiveDependencies: appKey stands in for apps.
  useEffect(() => {
    const subscriptions = [
      // By the links' rule (src/lib/navigation.ts): a sheet on top closes
      // first (Reply asks), a web app above the tabs goes, and the tab
      // shows its root.
      onKeyCommand("apps", () => goTo("/apps")),
      onKeyCommand("inbox", () => goTo("/inbox")),
      onKeyCommand("closeSheet", () => void escapeTopSheet()),
      onKeyCommand("closeSheetW", () => void escapeTopSheet()),
      // Settings opens once, in place of any other sheet.
      onKeyCommand("settings", () => {
        if (!pathRef.current.startsWith("/settings")) goTo("/settings");
      }),
      ...apps.map((app) => onKeyCommand(`app:${app.id}`, () => openWebApp(app.id))),
    ];
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, [appKey]);

  return null;
}
