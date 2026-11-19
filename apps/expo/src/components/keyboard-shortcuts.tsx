import type { AppDto } from "@hark/contracts";
import { router, usePathname, useRootNavigationState } from "expo-router";
import { useEffect, useRef } from "react";
import { type Directory, useDirectory } from "../lib/app-directory";
import { type KeyCommand, onKeyCommand, setKeyCommands } from "../lib/key-commands";
import { closeTopSheet, openWebApp, SHEET_ROUTES } from "../lib/navigation";
import { groupAppsByTeam } from "../lib/teams";

/** Web apps in launcher order: your own, then each team's. */
export function orderedApps(directory: Directory | null): AppDto[] {
  if (!directory) return [];
  const grouped = groupAppsByTeam(directory.apps, directory.teams ?? []);
  return [...grouped.personal, ...grouped.teams.flatMap((team) => team.apps)];
}

/**
 * Selects a tab. With a web app or sheet above the tabs, `navigate` would
 * push a second copy of the tabs (checked in the simulator), so it pops back
 * to the existing one instead.
 */
function showTab(href: "/inbox" | "/apps", tabsOnTop: boolean): void {
  if (tabsOnTop) router.navigate(href);
  else router.dismissTo(href);
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
  const tabsOnTop = topRoute === "(tabs)";
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
      // Like a sheet on the Mac. A popover or alert inside the sheet is
      // closer in the responder chain and takes Esc first.
      commands.push(
        { id: "closeSheet", input: "escape", modifiers: [], title: "Close" },
        { id: "closeSheetW", input: "w", modifiers: ["command"], title: "Close" },
      );
    } else if (inWebApp) {
      commands.push(
        { id: "reload", input: "r", modifiers: ["command"], title: "Reload" },
        { id: "back", input: "[", modifiers: ["command"], title: "Back" },
        { id: "forward", input: "]", modifiers: ["command"], title: "Forward" },
        { id: "close", input: "w", modifiers: ["command"], title: "Close App" },
      );
    }
    setKeyCommands(commands);
  }, [appKey, inWebApp, sheetOnTop]);

  // Read at key-press time; the subscriptions below only change with the apps.
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const tabsOnTopRef = useRef(tabsOnTop);
  tabsOnTopRef.current = tabsOnTop;

  // biome-ignore lint/correctness/useExhaustiveDependencies: appKey stands in for apps.
  useEffect(() => {
    const subscriptions = [
      onKeyCommand("apps", () => showTab("/apps", tabsOnTopRef.current)),
      onKeyCommand("inbox", () => showTab("/inbox", tabsOnTopRef.current)),
      onKeyCommand("closeSheet", () => void closeTopSheet()),
      onKeyCommand("closeSheetW", () => void closeTopSheet()),
      // Settings opens over whatever is showing, once.
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
