import type { AppDto } from "@hark/contracts";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { type Href, usePathname, useRouter } from "expo-router";
import { type SFSymbol, SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loadDirectory, publishDirectory, useDirectory } from "../lib/app-directory";
import { SIDEBAR_WIDTH, useSidebar } from "../lib/layout";
import { currentShift, groupAppsByTeam, onPageClaimed, pagesNeedingResponse } from "../lib/teams";
import { colors, fonts, tightTracking } from "../lib/theme";
import { AppIcon } from "./app-icon";

/** Reloads at most this often while navigating. */
const REFRESH_INTERVAL_MS = 5000;

type Section = "apps" | "inbox" | "oncall" | "teams" | "settings";

/** Which sidebar item the current route belongs to, and which app is open. */
function locate(pathname: string): { section: Section | null; appId: string | null } {
  const [, first = "", second] = pathname.split("/");
  if (first === "web") return { section: null, appId: second ?? null };
  if (first === "apps") return { section: second ? null : "apps", appId: second ?? null };
  if (first === "inbox" || first === "project" || first === "notification") {
    return { section: "inbox", appId: null };
  }
  if (first === "oncall" || first === "pages") return { section: "oncall", appId: null };
  if (first === "teams" || first === "join") return { section: "teams", appId: null };
  if (first === "settings" || first === "critical-alerts") {
    return { section: "settings", appId: null };
  }
  return { section: null, appId: null };
}

/**
 * The iPad sidebar: Hark's sections and every web app, one tap away from
 * anywhere. Switching swaps the screen in place instead of stacking it, so
 * Back always leads to the launcher.
 */
export function Sidebar() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const directory = useDirectory();
  const { toggle, dismiss, docked } = useSidebar();
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const lastRefresh = useRef(0);

  const refresh = useCallback(
    (force = false) => {
      if (!force && Date.now() - lastRefresh.current < REFRESH_INTERVAL_MS) return;
      lastRefresh.current = Date.now();
      void loadDirectory(simulatorPreview)
        .then(publishDirectory)
        .catch(() => {});
    },
    [simulatorPreview],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: navigating is the refresh signal.
  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => refresh(true));
    const claimed = onPageClaimed(() => refresh(true));
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh(true);
    });
    return () => {
      received.remove();
      claimed();
      appState.remove();
    };
  }, [refresh]);

  const { section, appId } = locate(pathname);

  const go = (href: Href, target: string) => {
    dismiss();
    if (pathname === target) return;
    if (target === "/apps") {
      router.dismissTo("/apps");
      return;
    }
    // From the launcher a destination stacks on it; from anywhere else it
    // replaces the current screen, so the stack never grows past two.
    if (pathname === "/apps") router.push(href);
    else router.replace(href);
  };
  const via = { via: "sidebar" };

  const apps = directory?.apps ?? [];
  const grouped = groupAppsByTeam(apps, directory?.teams ?? []);
  const hasTeams = (directory?.teams?.length ?? 0) > 0;
  const shift = directory?.oncall ? currentShift(directory.oncall.shifts) : null;
  const needYou = directory?.oncall ? pagesNeedingResponse(directory.oncall.pages) : [];
  const firstPage = needYou[0];
  const inboxCount = (directory?.unread ?? 0) + (directory?.waiting ?? 0);

  const appRows = (items: AppDto[]) =>
    items.map((app) => (
      <Pressable
        accessibilityHint="Opens the app"
        accessibilityLabel={app.name}
        accessibilityRole="button"
        accessibilityState={{ selected: app.id === appId }}
        key={app.id}
        onPress={() =>
          go({ pathname: "/web/[id]", params: { id: app.id, ...via } }, `/web/${app.id}`)
        }
        style={({ pressed }) => [
          styles.row,
          app.id === appId && styles.rowActive,
          pressed && styles.rowPressed,
        ]}
      >
        <AppIcon iconUrl={app.iconUrl} name={app.name} size={26} />
        <Text
          numberOfLines={1}
          style={[styles.rowLabel, app.id === appId && styles.rowLabelActive]}
        >
          {app.name}
        </Text>
      </Pressable>
    ));

  return (
    <View style={[styles.sidebar, { paddingTop: insets.top }]}>
      <View style={styles.top}>
        <View style={styles.brandGroup}>
          <View style={styles.brandMark} />
          <Text style={styles.brand}>Hark</Text>
        </View>
        <Pressable
          accessibilityHint={docked ? "Gives the content the full width" : undefined}
          accessibilityLabel="Hide sidebar"
          accessibilityRole="button"
          hitSlop={6}
          onPress={toggle}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
        >
          <SymbolView name="sidebar.left" size={18} tintColor={colors.muted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {firstPage ? (
          <Pressable
            accessibilityHint={needYou.length === 1 ? "Opens the page" : "Shows your open pages"}
            accessibilityRole="button"
            onPress={() =>
              needYou.length === 1
                ? go(
                    { pathname: "/pages/[id]", params: { id: firstPage.id, ...via } },
                    `/pages/${firstPage.id}`,
                  )
                : go({ pathname: "/oncall", params: via }, "/oncall")
            }
            style={({ pressed }) => [styles.page, pressed && styles.rowPressed]}
          >
            <SymbolView name="bell.badge.fill" size={15} tintColor={colors.danger} />
            <View style={styles.pageCopy}>
              <Text style={styles.pageTitle}>
                {needYou.length === 1 ? "A page needs you" : `${needYou.length} pages need you`}
              </Text>
              <Text numberOfLines={1} style={styles.pageDetail}>
                {firstPage.groupName} · {firstPage.title}
              </Text>
            </View>
          </Pressable>
        ) : null}

        <NavRow
          active={section === "apps"}
          icon="square.grid.2x2"
          label="Apps"
          onPress={() => go("/apps", "/apps")}
        />
        <NavRow
          active={section === "inbox"}
          badge={inboxCount}
          icon="tray"
          label="Inbox"
          onPress={() => go({ pathname: "/inbox", params: via }, "/inbox")}
        />
        {hasTeams || shift ? (
          <NavRow
            active={section === "oncall"}
            detail={shift ? "On call now" : undefined}
            icon="bell"
            label="On call"
            onPress={() => go({ pathname: "/oncall", params: via }, "/oncall")}
          />
        ) : null}
        <NavRow
          active={section === "teams"}
          icon="person.2"
          label="Teams"
          onPress={() => go({ pathname: "/teams", params: via }, "/teams")}
        />
        <NavRow
          active={section === "settings"}
          icon="gearshape"
          label="Settings"
          onPress={() => go({ pathname: "/settings", params: via }, "/settings")}
        />

        {apps.length > 0 ? (
          hasTeams ? (
            <>
              {grouped.personal.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>Yours</Text>
                  {appRows(grouped.personal)}
                </>
              ) : null}
              {grouped.teams
                .filter((team) => team.apps.length > 0)
                .map((team) => (
                  <View key={team.team.id}>
                    <Text numberOfLines={1} style={styles.sectionLabel}>
                      {team.team.name}
                    </Text>
                    {appRows(team.apps)}
                  </View>
                ))}
            </>
          ) : (
            <>
              <Text style={styles.sectionLabel}>Your apps</Text>
              {appRows(apps)}
            </>
          )
        ) : null}
      </ScrollView>
    </View>
  );
}

function NavRow({
  icon,
  label,
  active,
  badge,
  detail,
  onPress,
}: {
  icon: SFSymbol;
  label: string;
  active: boolean;
  badge?: number;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        active && styles.rowActive,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={styles.navIcon}>
        <SymbolView
          name={active ? (`${icon}.fill` as SFSymbol) : icon}
          size={17}
          tintColor={active ? colors.accent : colors.muted}
        />
      </View>
      <Text numberOfLines={1} style={[styles.rowLabel, active && styles.rowLabelActive]}>
        {label}
      </Text>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: SIDEBAR_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.line,
    backgroundColor: "#F3F2EE",
  },
  top: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 22,
    paddingRight: 10,
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandMark: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  brand: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 18,
    letterSpacing: tightTracking(18),
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  iconButtonPressed: {
    backgroundColor: "#E7E5E0",
  },
  scroll: {
    gap: 2,
    paddingHorizontal: 12,
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  rowActive: {
    backgroundColor: colors.accentSoft,
  },
  rowPressed: {
    opacity: 0.7,
  },
  navIcon: {
    width: 26,
    alignItems: "center",
  },
  rowLabel: {
    minWidth: 0,
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 15,
    letterSpacing: tightTracking(15),
  },
  rowLabelActive: {
    color: colors.accent,
    fontFamily: fonts.semibold,
  },
  rowDetail: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  badge: {
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: colors.accent,
  },
  badgeText: {
    color: "#FFFFFF",
    fontFamily: fonts.semibold,
    fontSize: 12,
  },
  sectionLabel: {
    marginTop: 22,
    marginBottom: 4,
    paddingHorizontal: 10,
    color: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  page: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#F1C9C2",
    borderRadius: 12,
    backgroundColor: "#FBEAE7",
  },
  pageCopy: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  pageTitle: {
    color: colors.danger,
    fontFamily: fonts.semibold,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  pageDetail: {
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
});
