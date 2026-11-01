import type { AppDto, TeamDto } from "@hark/contracts";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon } from "../../src/components/app-icon";
import type { OncallMeDto } from "../../src/lib/api";
import { loadDirectory, publishDirectory } from "../../src/lib/app-directory";
import { useSession } from "../../src/lib/auth";
import { createRefreshSequence } from "../../src/lib/inbox-refresh";
import { DEVICE_ID_KEY } from "../../src/lib/interactions";
import { useLayout, useSidebar } from "../../src/lib/layout";
import {
  currentShift,
  groupAppsByTeam,
  memberCountLabel,
  onCallSummary,
  onPageClaimed,
  pagesNeedingResponse,
  pagesNeedYouLabel,
} from "../../src/lib/teams";
import { colors, fonts, tightTracking } from "../../src/lib/theme";

const ADD_APP_COMMAND = 'harkctl apps create --name "My app" --url https://…';

export default function AppsScreen() {
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [apps, setApps] = useState<AppDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // `null` until loaded, and on servers without teams / on-call.
  const [teams, setTeams] = useState<TeamDto[] | null>(null);
  const [oncall, setOncall] = useState<OncallMeDto | null>(null);
  const params = useLocalSearchParams<{ team?: string }>();
  const highlightTeam = typeof params.team === "string" ? params.team : null;
  const scrollView = useRef<ScrollView>(null);
  const sectionOffsets = useRef(new Map<string, number>());
  const highlight = useRef(new Animated.Value(0)).current;
  const refreshSequence = useRef(createRefreshSequence()).current;
  const { regular } = useLayout();
  const sidebar = useSidebar();

  useEffect(() => {
    void SecureStore.getItemAsync(DEVICE_ID_KEY).then((value) =>
      setDeviceId(value ?? (simulatorPreview ? "preview-device" : "")),
    );
  }, [simulatorPreview]);

  const refresh = useCallback(async () => {
    const token = refreshSequence.begin();
    const directory = await loadDirectory(simulatorPreview);
    if (!refreshSequence.isCurrent(token)) return;
    publishDirectory(directory);
    setApps(directory.apps);
    setTeams(directory.teams);
    setOncall(directory.oncall);
    setLoadError(false);
    setWaiting(directory.waiting);
    setUnread(directory.unread);
  }, [refreshSequence, simulatorPreview]);

  const ready = Boolean((session || simulatorPreview) && deviceId);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    void refresh()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
    const notificationSubscription = Notifications.addNotificationReceivedListener(() => {
      void refresh().catch(() => {});
    });
    const claimedSubscription = onPageClaimed(() => void refresh().catch(() => {}));
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(() => {});
    });
    return () => {
      notificationSubscription.remove();
      appStateSubscription.remove();
      claimedSubscription();
    };
  }, [ready, refresh]);

  // Returning from an app, the inbox, or app info updates order and counts.
  const skipFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocus.current) {
        skipFirstFocus.current = false;
        return;
      }
      if (ready) void refresh().catch(() => {});
    }, [ready, refresh]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      setLoadError(true);
    } finally {
      setRefreshing(false);
    }
  };

  // After joining a team, scroll to its section and flash it once.
  const highlightReady = highlightTeam !== null && teams !== null && !loading;
  useEffect(() => {
    if (!highlightReady || !highlightTeam) return;
    const timer = setTimeout(() => {
      const y = sectionOffsets.current.get(highlightTeam);
      if (y !== undefined) scrollView.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
      highlight.setValue(1);
      Animated.timing(highlight, {
        toValue: 0,
        duration: 1600,
        delay: 500,
        useNativeDriver: false,
      }).start();
    }, 250);
    return () => clearTimeout(timer);
  }, [highlight, highlightReady, highlightTeam]);

  if (!sessionPending && !session && !simulatorPreview) return <Redirect href="/" />;
  if (deviceId === "") return <Redirect href="/home" />;

  const sections = groupAppsByTeam(apps, teams ?? []);
  const hasTeams = sections.teams.length > 0;
  const shift = oncall ? currentShift(oncall.shifts) : null;
  const needYou = oncall ? pagesNeedingResponse(oncall.pages) : [];
  const firstPage = needYou[0];

  const renderGrid = (items: AppDto[], inSection = false) => (
    <View style={[styles.grid, regular && styles.gridRegular, inSection && styles.sectionGrid]}>
      {items.map((app) => (
        <Pressable
          accessibilityHint="Opens the app. Long press for app info."
          accessibilityLabel={app.name}
          accessibilityRole="button"
          delayLongPress={350}
          key={app.id}
          onLongPress={() => router.push({ pathname: "/apps/[id]", params: { id: app.id } })}
          onPress={() => router.push({ pathname: "/web/[id]", params: { id: app.id } })}
          style={({ pressed }) => [
            styles.tile,
            regular && styles.tileRegular,
            pressed && styles.tilePressed,
          ]}
        >
          <AppIcon iconUrl={app.iconUrl} name={app.name} size={regular ? 76 : 62} />
          <Text numberOfLines={1} style={[styles.tileLabel, regular && styles.tileLabelRegular]}>
            {app.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        ref={scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {sidebar.docked ? (
          <View style={styles.titleRow}>
            <Text accessibilityRole="header" style={styles.title}>
              Apps
            </Text>
          </View>
        ) : (
          <View style={styles.brandRow}>
            <View style={styles.brandGroup}>
              <View style={styles.brandMark} />
              <Text style={styles.brand}>Hark</Text>
            </View>
            <View style={styles.headerActions}>
              {sidebar.fits ? (
                <Pressable
                  accessibilityLabel="Show sidebar"
                  accessibilityRole="button"
                  onPress={sidebar.toggle}
                  style={({ pressed }) => [
                    styles.headerButton,
                    pressed && styles.iconButtonPressed,
                  ]}
                >
                  <SymbolView name="sidebar.left" size={18} tintColor={colors.muted} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityLabel={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
                accessibilityRole="button"
                onPress={() => router.push("/inbox")}
                style={({ pressed }) => [styles.headerButton, pressed && styles.iconButtonPressed]}
              >
                <SymbolView name="tray.fill" size={18} tintColor={colors.muted} />
                {unread > 0 ? (
                  <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>{unread > 99 ? "99+" : unread}</Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                accessibilityLabel="Settings"
                accessibilityRole="button"
                onPress={() => router.push("/settings")}
                style={({ pressed }) => [styles.headerButton, pressed && styles.iconButtonPressed]}
              >
                <SymbolView name="gearshape.fill" size={17} tintColor={colors.muted} />
              </Pressable>
            </View>
          </View>
        )}

        {firstPage && !sidebar.docked ? (
          <Pressable
            accessibilityHint={needYou.length === 1 ? "Opens the page" : "Shows your open pages"}
            accessibilityLabel={`${pagesNeedYouLabel(needYou.length)}. ${firstPage.title}`}
            accessibilityRole="button"
            onPress={() =>
              needYou.length === 1
                ? router.push({ pathname: "/pages/[id]", params: { id: firstPage.id } })
                : router.push("/oncall")
            }
            style={({ pressed }) => [styles.pageRow, pressed && styles.rowPressed]}
          >
            <SymbolView name="bell.badge.fill" size={17} tintColor={colors.danger} />
            <View style={styles.pageCopy}>
              <Text style={styles.pageTitle}>{pagesNeedYouLabel(needYou.length)}</Text>
              <Text numberOfLines={1} style={styles.pageDetail}>
                {firstPage.groupName} · {firstPage.title}
              </Text>
            </View>
            <SymbolView
              name="chevron.right"
              size={11}
              tintColor={colors.danger}
              weight="semibold"
            />
          </Pressable>
        ) : null}

        {shift ? (
          <Pressable
            accessibilityHint="Shows your shifts and pages"
            accessibilityLabel={onCallSummary(shift)}
            accessibilityRole="button"
            onPress={() => router.push("/oncall")}
            style={({ pressed }) => [styles.waitingRow, pressed && styles.rowPressed]}
          >
            <View style={styles.rowIconSlot}>
              <SymbolView name="bell.fill" size={13} tintColor={colors.accent} />
            </View>
            <Text numberOfLines={1} style={styles.waitingText}>
              {onCallSummary(shift)}
            </Text>
            <SymbolView name="chevron.right" size={11} tintColor={colors.soft} weight="semibold" />
          </Pressable>
        ) : null}

        {waiting > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/inbox")}
            style={({ pressed }) => [styles.waitingRow, pressed && styles.rowPressed]}
          >
            <View style={styles.waitingDot} />
            <Text style={styles.waitingText}>
              {waiting === 1
                ? "1 request is waiting on you"
                : `${waiting} requests are waiting on you`}
            </Text>
            <SymbolView name="chevron.right" size={11} tintColor={colors.soft} weight="semibold" />
          </Pressable>
        ) : null}

        {loading && apps.length === 0 && !hasTeams ? (
          <ActivityIndicator color={colors.accent} style={styles.loading} />
        ) : apps.length === 0 && !hasTeams ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {loadError ? "Couldn’t load your apps" : "Your apps live here"}
            </Text>
            <Text style={styles.emptyBody}>
              {loadError
                ? "Pull down to try again."
                : "Register any web app you run and open it here, already signed in with Hark. Ask an agent, or run:"}
            </Text>
            {loadError ? null : (
              <View style={styles.command}>
                <Text selectable style={styles.commandText}>
                  {ADD_APP_COMMAND}
                </Text>
              </View>
            )}
          </View>
        ) : !hasTeams ? (
          renderGrid(apps)
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Yours
              </Text>
            </View>
            {sections.personal.length > 0 ? (
              renderGrid(sections.personal, true)
            ) : (
              <Text style={styles.sectionEmpty}>Apps you add for yourself show up here.</Text>
            )}
            {sections.teams.map((section) => {
              const highlighted = section.team.id === highlightTeam;
              return (
                <Animated.View
                  key={section.team.id}
                  onLayout={(event) =>
                    sectionOffsets.current.set(section.team.id, event.nativeEvent.layout.y)
                  }
                  style={[
                    styles.teamSection,
                    highlighted && {
                      backgroundColor: highlight.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["rgba(231, 240, 237, 0)", "rgba(231, 240, 237, 1)"],
                      }),
                    },
                  ]}
                >
                  <View style={styles.sectionHeader}>
                    <Text accessibilityRole="header" numberOfLines={1} style={styles.sectionTitle}>
                      {section.team.name}
                    </Text>
                    {section.memberCount !== null ? (
                      <Text style={styles.sectionMeta}>
                        {memberCountLabel(section.memberCount)}
                      </Text>
                    ) : null}
                  </View>
                  {section.apps.length > 0 ? (
                    renderGrid(section.apps, true)
                  ) : (
                    <Text style={styles.sectionEmpty}>
                      No apps yet. Share one from its app info, or add one with harkctl.
                    </Text>
                  )}
                </Animated.View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  /** The launcher is wider than a reading column: rows of tiles, not text. */
  scroll: {
    width: "100%",
    maxWidth: 960,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  titleRow: {
    minHeight: 60,
    justifyContent: "flex-end",
    paddingBottom: 6,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: tightTracking(28),
  },
  brandRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: -10,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  iconButtonPressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.96 }],
  },
  headerBadge: {
    position: "absolute",
    top: 5,
    right: 3,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: colors.paper,
    borderRadius: 9,
    backgroundColor: colors.accent,
  },
  headerBadgeText: {
    color: "#FFFFFF",
    fontFamily: fonts.semibold,
    fontSize: 10,
  },
  waitingRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowPressed: {
    opacity: 0.7,
  },
  /** Same footprint as the waiting dot so row text lines up. */
  rowIconSlot: {
    width: 8,
    alignItems: "center",
  },
  waitingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  waitingText: {
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  loading: {
    paddingVertical: 48,
  },
  pageRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#F1C9C2",
    borderRadius: 14,
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
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  pageDetail: {
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  teamSection: {
    marginHorizontal: -12,
    paddingHorizontal: 12,
    paddingBottom: 4,
    borderRadius: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingTop: 26,
  },
  sectionTitle: {
    flexShrink: 1,
    color: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  sectionMeta: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  sectionEmpty: {
    paddingTop: 10,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 22,
    paddingTop: 22,
    marginHorizontal: -6,
  },
  /** Fixed-size tiles that wrap, like the iPad Home Screen, instead of four stretched columns. */
  gridRegular: {
    rowGap: 30,
    columnGap: 8,
    marginHorizontal: -16,
  },
  sectionGrid: {
    paddingTop: 14,
  },
  tile: {
    width: "25%",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 4,
  },
  tileRegular: {
    width: 112,
  },
  tilePressed: {
    opacity: 0.7,
    transform: [{ scale: 0.96 }],
  },
  tileLabel: {
    maxWidth: "100%",
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: tightTracking(12),
  },
  tileLabelRegular: {
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: tightTracking(13),
  },
  empty: {
    gap: 12,
    paddingTop: 56,
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: tightTracking(24),
  },
  emptyBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: tightTracking(15),
  },
  command: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: "#F2F1ED",
  },
  commandText: {
    color: colors.ink,
    fontFamily: fonts.mono,
    fontSize: 12,
    lineHeight: 17,
  },
});
