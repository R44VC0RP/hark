import { Toggle } from "@expo/ui/swift-ui";
import type {
  CriticalAlertState,
  OncallGroupDto,
  OncallPageDto,
  OncallSettingsDto,
} from "@hark/contracts";
import * as Device from "expo-device";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  criticalAlertValue,
  OncallStatusRow,
  oncallStatus,
} from "../../../src/components/teams/oncall-status";
import { PageRow, sortPages } from "../../../src/components/teams/page-row";
import { RowMenu } from "../../../src/components/teams/row-menu";
import { api, type OncallMeDto } from "../../../src/lib/api";
import { refreshDirectory, useDirectory } from "../../../src/lib/app-directory";
import { useSession } from "../../../src/lib/auth";
import { criticalAlertsEnabled, reportCriticalAlertState } from "../../../src/lib/critical-alerts";
import { formatHandoffClock, formatUpcoming } from "../../../src/lib/dates";
import { alertFailure } from "../../../src/lib/haptics";
import {
  previewOncallGroups,
  previewOncallMe,
  previewPages,
  previewTeams,
  previewViewer,
} from "../../../src/lib/inbox-preview";
import { escalationPolicySummary, isUnsupportedRoute, onPageClaimed } from "../../../src/lib/teams";
import { spoken } from "../../../src/ui/a11y";
import { Avatar } from "../../../src/ui/avatar";
import { EmptyState, ErrorState, isNetworkError, LoadingState } from "../../../src/ui/empty-state";
import {
  Cell,
  List,
  Row,
  Section,
  SwitchRow,
  useStackedRows,
  useTextMeasure,
} from "../../../src/ui/list";
import { Text } from "../../../src/ui/text";
import { colors, space } from "../../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;
/** Relative times and "until" lines move on once a minute. */
const TICK_MS = 60_000;
const TEAM_AVATAR = 36;
const SHIFT_AVATAR = 22;

type LoadFailure = "network" | "other";

const RING_INTERVALS: Array<{ label: string; seconds: number | null }> = [
  { label: "Group Default", seconds: null },
  { label: "30 Seconds", seconds: 30 },
  { label: "1 Minute", seconds: 60 },
  { label: "2 Minutes", seconds: 120 },
  { label: "5 Minutes", seconds: 300 },
];

/** "repeats 1×, then everyone in the team" → "Repeats 1×, then everyone in the team." */
function sentence(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function intervalLabel(seconds: number | null): string {
  return RING_INTERVALS.find((option) => option.seconds === seconds)?.label ?? `${seconds} Seconds`;
}

const PREVIEW_SETTINGS: OncallSettingsDto = {
  ringUntilAcknowledged: true,
  ringIntervalSeconds: null,
  criticalAlerts: null,
  devices: [],
};

/**
 * On Call (DESIGN.md 5.14), pushed from Teams: your status and open pages,
 * then either a team's rotations (`?team=`) or your own shortcuts to every
 * team's rotations, your paging settings and your next shifts.
 */
export default function OncallScreen() {
  const { data: session } = useSession();
  const router = useRouter();
  const directory = useDirectory();
  const params = useLocalSearchParams<{ team?: string; name?: string }>();
  const teamId = typeof params.team === "string" && params.team ? params.team : null;
  const viewerId = simulatorPreview ? previewViewer.userId : session?.user.id;
  const [me, setMe] = useState<OncallMeDto | null>(null);
  const [teamName, setTeamName] = useState<string | null>(
    typeof params.name === "string" && params.name ? params.name : null,
  );
  const [groups, setGroups] = useState<OncallGroupDto[] | null>(null);
  const [teamPages, setTeamPages] = useState<OncallPageDto[] | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState<OncallSettingsDto | null>(null);
  const [critical, setCritical] = useState<CriticalAlertState | null>(null);
  const [now, setNow] = useState(() => Date.now());

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
      if (team) setTeamName(team.team.name);
      setGroups(groupResult?.groups ?? null);
      setTeamPages(pageResult?.pages ?? null);
      setFailure(null);
    } catch (cause) {
      if (isUnsupportedRoute(cause)) setUnsupported(true);
      else setFailure(isNetworkError(cause) ? "network" : "other");
    }
  }, [teamId]);

  /**
   * Reloads this screen together with the app directory, so the Teams
   * badge, the pages accessory and these lists always agree (I-05: a pull
   * showed two pages needing a responder under "1 Page Needs You").
   */
  const reload = useCallback(
    () => Promise.all([load(), refreshDirectory().catch(() => {})]),
    [load],
  );

  // Back from a page sheet or Critical Alerts: show what changed there.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // Someone else claimed a page.
  useEffect(() => onPageClaimed(() => void reload()), [reload]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

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
      alertFailure("Couldn’t Save", cause);
    }
  };

  const status = oncallStatus(me, now);
  const upcoming = useMemo(
    () => (me?.shifts ?? []).filter((item) => Date.parse(item.startsAt) > now),
    [me, now],
  );
  const pages = useMemo(
    () => sortPages((teamPages ?? me?.pages ?? []).filter((page) => page.status !== "resolved")),
    [me, teamPages],
  );
  const rotationTeams = (directory?.teams ?? []).filter((team) => team.oncallGroupCount > 0);
  const criticalEnabled = criticalAlertsEnabled();
  const title = teamId ? (teamName ? `${teamName} On Call` : "On Call") : "On Call";

  return (
    <>
      <Stack.Screen options={{ title }} />
      <List onRefresh={me || failure ? () => void onRefresh() : undefined} refreshing={refreshing}>
        {unsupported ? (
          <EmptyState
            message="This Hark server doesn’t support on-call yet."
            symbol="bell.slash"
            title="On Call Isn’t Available"
          />
        ) : !me ? (
          failure ? (
            <ErrorState
              network={failure === "network"}
              onRetry={() => {
                setFailure(null);
                void reload();
              }}
              title="Couldn’t Load On Call"
            />
          ) : (
            <LoadingState />
          )
        ) : (
          <>
            {/*
                The same "Open Pages" and count as Teams (V-14). With none,
                a quiet line under the status instead of a header over an
                empty section (V-16).
              */}
            <Section footer={pages.length === 0 ? "All quiet. No open pages." : undefined}>
              <OncallStatusRow status={status} tinted />
            </Section>

            {pages.length > 0 ? (
              <Section detail={String(pages.length)} prominent title="Open Pages">
                {pages.map((page) => (
                  <PageRow key={page.id} now={now} page={page} />
                ))}
              </Section>
            ) : null}

            {teamId && groups && groups.length > 0 ? (
              <Section prominent title="Rotations">
                {groups.map((group) => (
                  <RotationRow
                    group={group}
                    groups={groups}
                    key={group.id}
                    now={now}
                    viewerId={viewerId}
                  />
                ))}
              </Section>
            ) : null}

            {!teamId && rotationTeams.length > 0 ? (
              <Section prominent title="Team Rotations">
                {rotationTeams.map((team) => (
                  <Row
                    accessibilityHint="Shows the team’s rotations and open pages"
                    chevron
                    key={team.id}
                    leading={<Avatar name={team.name} size={TEAM_AVATAR} />}
                    leadingWidth={TEAM_AVATAR}
                    onPress={() =>
                      router.push({
                        pathname: "/oncall",
                        params: { team: team.id, name: team.name },
                      })
                    }
                    subtitle={
                      team.oncallGroupCount === 1
                        ? "1 on-call group"
                        : `${team.oncallGroupCount} on-call groups`
                    }
                    title={team.name}
                  />
                ))}
              </Section>
            ) : null}

            {!teamId && settings ? (
              <Section
                footer="Pages break through Focus with an alarm sound. Critical Alerts also ring through silent mode."
                prominent
                title="Paging"
              >
                <SwitchRow
                  onValueChange={(value) => void saveSettings({ ringUntilAcknowledged: value })}
                  subtitle={
                    settings.ringUntilAcknowledged
                      ? "Pages repeat until someone acknowledges."
                      : "Pages alert once."
                  }
                  title="Ring Until Acknowledged"
                  value={settings.ringUntilAcknowledged}
                />
                {settings.ringUntilAcknowledged ? (
                  // A pop-up button (I-10): a native menu with the current
                  // interval checked, opened from the value (V2-11).
                  <RowMenu
                    anchor="trailing"
                    hint="Chooses how often the alert repeats"
                    label="Repeat Every"
                    menu={RING_INTERVALS.map((option) => (
                      <Toggle
                        isOn={option.seconds === settings.ringIntervalSeconds}
                        key={option.label}
                        label={option.label}
                        onIsOnChange={() => {
                          if (option.seconds !== settings.ringIntervalSeconds) {
                            void saveSettings({ ringIntervalSeconds: option.seconds });
                          }
                        }}
                      />
                    ))}
                    value={intervalLabel(settings.ringIntervalSeconds)}
                  >
                    <Row
                      title="Repeat Every"
                      trailing={
                        <SymbolView
                          name="chevron.up.chevron.down"
                          size={13}
                          tintColor={colors.placeholder}
                          weight="semibold"
                        />
                      }
                      value={intervalLabel(settings.ringIntervalSeconds)}
                    />
                  </RowMenu>
                ) : null}
                <Row
                  accessibilityHint={
                    criticalEnabled ? "Explains Critical Alerts and turns them on" : undefined
                  }
                  chevron={criticalEnabled}
                  onPress={criticalEnabled ? () => router.push("/critical-alerts") : undefined}
                  title="Critical Alerts"
                  value={criticalAlertValue(critical)}
                />
              </Section>
            ) : null}

            {!teamId && upcoming.length > 0 ? (
              <Section prominent title="Your Next Shifts">
                {upcoming.map((item) => (
                  <Row
                    key={`${item.groupId}-${item.startsAt}`}
                    subtitle={`${item.teamName}\n${formatUpcoming(item.startsAt, now)} – ${formatUpcoming(item.endsAt, now)}`}
                    title={item.groupName}
                  />
                ))}
              </Section>
            ) : null}
          </>
        )}
      </List>
    </>
  );
}

/**
 * One on-call group of a team (5.14): name and handoff, its escalation
 * policy, and the next four shifts with who covers them.
 */
function RotationRow({
  group,
  groups,
  now,
  viewerId,
}: {
  group: OncallGroupDto;
  groups: OncallGroupDto[];
  now: number;
  viewerId: string | undefined;
}) {
  const stacked = useStackedRows();
  // The policy is text: it keeps the measure; the schedule and shift times
  // stay on the trailing edge (3.6).
  const measure = useTextMeasure();
  // The handoff on this device's clock, like the shifts under it (V-07).
  const handoff = formatHandoffClock(group.rotation.handoffAt, group.rotation.timezone, now);
  const schedule = `${group.rotation.period === "weekly" ? "Weekly" : "Daily"} · ${handoff}`;
  // "On call → 5 min → Everyone in the group · repeats 1× · then everyone in
  // the team": the chain on one line, what follows it as a sentence on the
  // next, so no "·" ends a wrapped line (V-06). An arrow keeps to the step
  // before it, so a wrapped line ends with "→", never starts with one.
  const [chain = "", ...extras] = escalationPolicySummary(
    group,
    (id) => group.rotation.members.find((member) => member.userId === id)?.name ?? "a teammate",
    (id) => groups.find((other) => other.id === id)?.name ?? "another group",
  ).split(" · ");
  const flow = chain.replace(/ →/g, "\u00A0→");
  const then = extras.length > 0 ? sentence(extras.join(", ")) : null;
  return (
    <Cell style={styles.rotation}>
      <View
        accessibilityLabel={spoken(group.name, schedule, chain, then)}
        accessible
        style={styles.rotationCopy}
      >
        <View style={[styles.rotationHeader, stacked && styles.stacked]}>
          <Text style={styles.flex} variant="body" weight="600">
            {group.name}
          </Text>
          <Text color="secondaryLabel" tabular variant="subheadline">
            {schedule}
          </Text>
        </View>
        <Text color="secondaryLabel" style={measure} variant="subheadline">
          {flow}
        </Text>
        {then ? (
          <Text color="secondaryLabel" style={measure} variant="subheadline">
            {then}
          </Text>
        ) : null}
      </View>
      {group.upcoming.slice(0, 4).map((item, index) => {
        const live = index === 0 && group.current !== null;
        const you = item.person.userId === viewerId;
        const name = `${you ? "You" : item.person.name}${item.override ? " (cover)" : ""}`;
        const when = live
          ? `Now – ${formatUpcoming(item.endsAt, now)}`
          : formatUpcoming(item.startsAt, now);
        return (
          <View
            accessibilityLabel={`${when}: ${you ? "you" : item.person.name}${item.override ? ", covering" : ""}`}
            accessible
            key={`${item.startsAt}-${item.person.userId}`}
            style={[styles.shift, stacked && styles.stacked]}
          >
            <View style={styles.shiftPerson}>
              <Avatar image={item.person.image} name={item.person.name} size={SHIFT_AVATAR} />
              <Text
                color={live ? "label" : "secondaryLabel"}
                numberOfLines={stacked ? undefined : 1}
                style={styles.flex}
                variant="subheadline"
                weight={live ? "600" : undefined}
              >
                {name}
              </Text>
            </View>
            <Text color="secondaryLabel" tabular variant="subheadline">
              {when}
            </Text>
          </View>
        );
      })}
    </Cell>
  );
}

const styles = StyleSheet.create({
  rotation: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.xs,
    paddingVertical: space.s,
  },
  rotationCopy: {
    gap: 2,
    marginBottom: space.xxs,
  },
  rotationHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space.xs,
  },
  shift: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  shiftPerson: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
  },
  stacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
  },
  flex: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
  },
});
