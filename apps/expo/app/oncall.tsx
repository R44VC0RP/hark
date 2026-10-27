import type {
  CriticalAlertState,
  OncallGroupDto,
  OncallPageDto,
  OncallSettingsDto,
} from "@hark/contracts";
import * as Device from "expo-device";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PersonAvatar, ScreenHeader, SectionLabel, ui } from "../src/components/screen-parts";
import { api, type OncallMeDto } from "../src/lib/api";
import { useSession } from "../src/lib/auth";
import {
  criticalAlertLabel,
  criticalAlertsEnabled,
  reportCriticalAlertState,
} from "../src/lib/critical-alerts";
import {
  previewOncallGroups,
  previewOncallMe,
  previewPages,
  previewTeams,
  previewViewer,
} from "../src/lib/inbox-preview";
import {
  currentShift,
  escalationPolicySummary,
  formatHandoff,
  isUnsupportedRoute,
  onPageClaimed,
  pageStatusLabel,
  timeAgo,
} from "../src/lib/teams";
import { colors, fonts, tightTracking } from "../src/lib/theme";

export default function OncallScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ team?: string }>();
  const teamId = typeof params.team === "string" && params.team ? params.team : null;
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const viewerId = simulatorPreview ? previewViewer.userId : session?.user.id;
  const [me, setMe] = useState<OncallMeDto | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [groups, setGroups] = useState<OncallGroupDto[] | null>(null);
  const [teamPages, setTeamPages] = useState<OncallPageDto[] | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState<OncallSettingsDto | null>(null);
  const [critical, setCritical] = useState<CriticalAlertState | null>(null);

  const load = useCallback(async () => {
    if (simulatorPreview) {
      setMe(previewOncallMe);
      setSettings(PREVIEW_SETTINGS);
      setCritical(criticalAlertsEnabled() ? "notDetermined" : "unavailable");
      if (teamId) {
        setTeamName(previewTeams.find((team) => team.id === teamId)?.name ?? null);
        setGroups(previewOncallGroups.filter((group) => group.teamId === teamId));
        setTeamPages(previewPages.filter((page) => page.teamId === teamId));
      }
      return;
    }
    try {
      const [mine, team, groupResult, pageResult] = await Promise.all([
        api.getMyOncall(),
        teamId ? api.getTeam(teamId).catch(() => null) : null,
        teamId ? api.listOncallGroups(teamId).catch(() => null) : null,
        teamId ? api.listTeamPages(teamId, { status: "open" }).catch(() => null) : null,
      ]);
      setMe(mine);
      setSettings(mine.settings ?? null);
      // Keeps the server's copy current, e.g. after a change in iOS Settings.
      void reportCriticalAlertState().then(setCritical);
      setTeamName(team?.team.name ?? null);
      setGroups(groupResult?.groups ?? null);
      setTeamPages(pageResult?.pages ?? null);
      setError(null);
    } catch (cause) {
      if (isUnsupportedRoute(cause)) setUnsupported(true);
      else setError(cause instanceof Error ? cause.message : "Couldn’t load on-call.");
    }
  }, [simulatorPreview, teamId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => onPageClaimed(() => void load()), [load]);

  if (!isPending && !session && !simulatorPreview) return <Redirect href="/" />;

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const now = Date.now();
  const shift = me ? currentShift(me.shifts, now) : null;
  const upcoming = me?.shifts.filter((item) => Date.parse(item.startsAt) > now) ?? [];
  const pages = (teamPages ?? me?.pages ?? []).filter((page) => page.status !== "resolved");

  const saveSettings = async (input: Partial<OncallSettingsDto>) => {
    if (!settings) return;
    const previous = settings;
    setSettings({ ...settings, ...input });
    if (simulatorPreview) return;
    try {
      const result = await api.updateOncallSettings({
        ...(input.ringUntilAcknowledged !== undefined
          ? { ringUntilAcknowledged: input.ringUntilAcknowledged }
          : {}),
        ...(input.ringIntervalSeconds !== undefined
          ? { ringIntervalSeconds: input.ringIntervalSeconds }
          : {}),
      });
      setSettings(result.settings);
    } catch (cause) {
      setSettings(previous);
      Alert.alert("Couldn’t save", cause instanceof Error ? cause.message : "Please try again.");
    }
  };

  const chooseInterval = () => {
    Alert.alert("Repeat the alert every", undefined, [
      ...RING_INTERVALS.map((option) => ({
        text: option.label,
        onPress: () => void saveSettings({ ringIntervalSeconds: option.seconds }),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  return (
    <SafeAreaView edges={["top"]} style={ui.container}>
      <StatusBar style="dark" />
      <ScreenHeader title={teamName ? `${teamName} on call` : "On call"} />
      {unsupported ? (
        <Text style={[ui.message, { paddingHorizontal: 24 }]}>
          This Hark server doesn’t support on-call yet.
        </Text>
      ) : !me ? (
        error ? (
          <Text style={[ui.message, { paddingHorizontal: 24 }]}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.accent} style={ui.loading} />
        )
      ) : (
        <ScrollView
          contentContainerStyle={ui.scroll}
          refreshControl={
            <RefreshControl
              onRefresh={() => void onRefresh()}
              refreshing={refreshing}
              tintColor={colors.accent}
            />
          }
        >
          <View
            accessibilityLabel={
              shift
                ? `You’re on call for ${shift.groupName} until ${formatHandoff(shift.endsAt, now)}`
                : "You’re not on call right now"
            }
            accessible
            style={[styles.status, shift && styles.statusOn]}
          >
            <View style={[styles.statusDot, shift && styles.statusDotOn]} />
            <View style={ui.rowCopy}>
              <Text style={styles.statusTitle}>
                {shift ? "You’re on call" : "You’re not on call"}
              </Text>
              <Text style={ui.muted}>
                {shift
                  ? `${shift.groupName} · ${shift.teamName} · until ${formatHandoff(shift.endsAt, now)}`
                  : upcoming[0]
                    ? `Next: ${upcoming[0].groupName} from ${formatHandoff(upcoming[0].startsAt, now)}`
                    : "No shifts scheduled for you."}
              </Text>
            </View>
          </View>

          <SectionLabel detail={pages.length > 0 ? `${pages.length} open` : undefined}>
            {teamId ? "Open pages" : "Your pages"}
          </SectionLabel>
          {pages.length === 0 ? (
            <Text style={[ui.muted, { paddingBottom: 4 }]}>All quiet. No open pages.</Text>
          ) : (
            pages.map((page, index) => (
              <PageRow
                key={page.id}
                last={index === pages.length - 1}
                onPress={() => router.push({ pathname: "/pages/[id]", params: { id: page.id } })}
                page={page}
              />
            ))
          )}

          {groups && groups.length > 0 ? (
            <>
              <SectionLabel>Rotations</SectionLabel>
              {groups.map((group, index) => (
                <View
                  key={group.id}
                  style={[
                    ui.row,
                    { alignItems: "flex-start", paddingVertical: 14 },
                    index === groups.length - 1 && ui.lastRow,
                  ]}
                >
                  <View style={[ui.rowCopy, { gap: 8 }]}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={ui.rowLabel}>{group.name}</Text>
                      <Text style={ui.rowTrailing}>
                        {group.rotation.period === "weekly" ? "Weekly" : "Daily"} ·{" "}
                        {group.rotation.handoffAt}
                      </Text>
                    </View>
                    <Text style={ui.rowValue}>
                      {escalationPolicySummary(
                        group,
                        (id) =>
                          group.rotation.members.find((member) => member.userId === id)?.name ??
                          "a teammate",
                        (id) => groups.find((other) => other.id === id)?.name ?? "another group",
                      )}
                    </Text>
                    {group.upcoming.slice(0, 4).map((item, shiftIndex) => {
                      const live = shiftIndex === 0 && group.current !== null;
                      const you = item.person.userId === viewerId;
                      return (
                        <View
                          accessibilityLabel={`${live ? "Now" : formatHandoff(item.startsAt, now)}: ${you ? "you" : item.person.name}${item.override ? ", covering" : ""}`}
                          accessible
                          key={`${item.startsAt}-${item.person.userId}`}
                          style={styles.shiftLine}
                        >
                          <PersonAvatar
                            image={item.person.image}
                            name={item.person.name}
                            size={22}
                          />
                          <Text
                            numberOfLines={1}
                            style={[styles.shiftName, live && styles.shiftNameLive]}
                          >
                            {you ? "You" : item.person.name}
                            {item.override ? " (cover)" : ""}
                          </Text>
                          <Text style={ui.rowTrailing}>
                            {live
                              ? `Now – ${formatHandoff(item.endsAt, now)}`
                              : formatHandoff(item.startsAt, now)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {!teamId && settings ? (
            <>
              <SectionLabel>Paging</SectionLabel>
              <View style={ui.row}>
                <View style={ui.rowCopy}>
                  <Text style={ui.rowLabel}>Ring until acknowledged</Text>
                  <Text style={ui.rowValue}>
                    {settings.ringUntilAcknowledged
                      ? "Pages repeat until someone acknowledges."
                      : "Pages alert once."}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Ring until acknowledged"
                  onValueChange={(value) => void saveSettings({ ringUntilAcknowledged: value })}
                  trackColor={{ true: colors.accent }}
                  value={settings.ringUntilAcknowledged}
                />
              </View>
              {settings.ringUntilAcknowledged ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={chooseInterval}
                  style={({ pressed }) => [ui.row, pressed && ui.rowPressed]}
                >
                  <View style={ui.rowCopy}>
                    <Text style={ui.rowLabel}>Repeat every</Text>
                  </View>
                  <Text style={ui.rowTrailing}>{intervalLabel(settings.ringIntervalSeconds)}</Text>
                  <SymbolView name="chevron.right" size={12} tintColor={colors.soft} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={!criticalAlertsEnabled()}
                onPress={() => router.push("/critical-alerts")}
                style={({ pressed }) => [ui.row, ui.lastRow, pressed && ui.rowPressed]}
              >
                <View style={ui.rowCopy}>
                  <Text style={ui.rowLabel}>Critical Alerts</Text>
                  <Text style={ui.rowValue}>
                    {critical === "authorized"
                      ? "Pages ring through silent mode and Focus."
                      : "Pages break through Focus with an alarm sound, but not the silent switch."}
                  </Text>
                </View>
                <Text style={ui.rowTrailing}>{criticalAlertLabel(critical)}</Text>
                {criticalAlertsEnabled() ? (
                  <SymbolView name="chevron.right" size={12} tintColor={colors.soft} />
                ) : null}
              </Pressable>
            </>
          ) : null}

          {!teamId && upcoming.length > 0 ? (
            <>
              <SectionLabel>Your next shifts</SectionLabel>
              {upcoming.map((item, index) => (
                <View
                  key={`${item.groupId}-${item.startsAt}`}
                  style={[ui.row, index === upcoming.length - 1 && ui.lastRow]}
                >
                  <View style={ui.rowCopy}>
                    <Text style={ui.rowLabel}>{item.groupName}</Text>
                    <Text style={ui.rowValue}>{item.teamName}</Text>
                  </View>
                  <Text style={ui.rowTrailing}>
                    {formatHandoff(item.startsAt, now)} – {formatHandoff(item.endsAt, now)}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const RING_INTERVALS: Array<{ label: string; seconds: number | null }> = [
  { label: "Group default", seconds: null },
  { label: "30 seconds", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "2 minutes", seconds: 120 },
  { label: "5 minutes", seconds: 300 },
];

function intervalLabel(seconds: number | null): string {
  return RING_INTERVALS.find((option) => option.seconds === seconds)?.label ?? `${seconds} seconds`;
}

const PREVIEW_SETTINGS: OncallSettingsDto = {
  ringUntilAcknowledged: true,
  ringIntervalSeconds: null,
  criticalAlerts: null,
  devices: [],
};

function PageRow({
  page,
  last,
  onPress,
}: {
  page: OncallPageDto;
  last: boolean;
  onPress: () => void;
}) {
  const open = page.status === "triggered";
  return (
    <Pressable
      accessibilityHint="Opens the page"
      accessibilityLabel={`${page.title}, ${pageStatusLabel(page)}, ${page.groupName}, ${timeAgo(page.createdAt)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [ui.row, last && ui.lastRow, pressed && ui.rowPressed]}
    >
      <View style={[styles.pageDot, open ? styles.pageDotOpen : styles.pageDotAck]} />
      <View style={ui.rowCopy}>
        <Text numberOfLines={1} style={ui.rowLabel}>
          {page.title}
        </Text>
        <Text numberOfLines={1} style={ui.rowValue}>
          {page.groupName} · {timeAgo(page.createdAt)} ·{" "}
          {open
            ? "Needs a responder"
            : `${pageStatusLabel(page)}${page.acknowledgedBy ? ` by ${page.acknowledgedBy.name}` : ""}`}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={12} tintColor={colors.soft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  statusOn: {
    borderColor: "#C9DDD6",
    backgroundColor: colors.accentSoft,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.soft,
  },
  statusDotOn: {
    backgroundColor: colors.accent,
  },
  statusTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 17,
    letterSpacing: tightTracking(17),
  },
  pageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pageDotOpen: {
    backgroundColor: colors.danger,
  },
  pageDotAck: {
    backgroundColor: colors.accent,
  },
  shiftLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  shiftName: {
    minWidth: 0,
    flex: 1,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  shiftNameLive: {
    color: colors.ink,
    fontFamily: fonts.medium,
  },
});
