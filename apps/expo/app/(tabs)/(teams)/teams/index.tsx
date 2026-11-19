import type { TeamDto } from "@hark/contracts";
import * as Device from "expo-device";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { OncallStatusRow, oncallStatus } from "../../../../src/components/teams/oncall-status";
import { PageRow, sortPages } from "../../../../src/components/teams/page-row";
import { api } from "../../../../src/lib/api";
import {
  refreshDirectory,
  useDirectory,
  useDirectoryLoadFailed,
} from "../../../../src/lib/app-directory";
import { haptic } from "../../../../src/lib/haptics";
import { previewTeams } from "../../../../src/lib/inbox-preview";
import { memberCountLabel, roleLabel } from "../../../../src/lib/teams";
import { TabRootToolbar } from "../../../../src/ui/account-button";
import { Avatar } from "../../../../src/ui/avatar";
import { EmptyState, ErrorState, LoadingState } from "../../../../src/ui/empty-state";
import { List, Row, Section, useStackedRows } from "../../../../src/ui/list";

const simulatorPreview = __DEV__ && !Device.isDevice;
/** Relative times ("4 min ago") move on once a minute. */
const TICK_MS = 60_000;
const AVATAR = 36;

/**
 * "Owner · 5 members · 3 apps" on one line (the row never wraps it, so no "·"
 * ends a line, V-06); one fact per line at accessibility sizes.
 */
function teamSubtitle(team: TeamDto, stacked: boolean): string {
  const apps = team.appCount === 1 ? "1 app" : `${team.appCount} apps`;
  return [roleLabel(team.role), memberCountLabel(team.memberCount), team.appCount > 0 ? apps : null]
    .filter(Boolean)
    .join(stacked ? "\n" : " · ");
}

/**
 * Teams (DESIGN.md 5.12), the third tab: where you stand on call, the pages
 * still open, and your teams. Everything reads the app directory the tab bar
 * badge and the pages accessory use, so they never disagree; pull to refresh
 * reloads it. "+" creates a team with a native prompt.
 */
export default function TeamsScreen() {
  const router = useRouter();
  const stacked = useStackedRows();
  const directory = useDirectory();
  const loadFailed = useDirectoryLoadFailed();
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const creating = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    // A failed refresh keeps the last data on screen.
    await refreshDirectory().catch(() => {});
    setRefreshing(false);
  };

  const create = useCallback(
    async (value?: string) => {
      const name = value?.trim();
      if (!name || creating.current) return;
      creating.current = true;
      try {
        let team: TeamDto;
        if (simulatorPreview) {
          team = {
            id: `team_preview${Date.now().toString(36)}`,
            name,
            role: "owner",
            memberCount: 1,
            appCount: 0,
            oncallGroupCount: 0,
            seats: { used: 1, available: 0, billable: 0 },
            plan: "free",
            createdAt: new Date().toISOString(),
          };
          previewTeams.push(team);
        } else {
          team = (await api.createTeam(name)).team;
        }
        router.push({ pathname: "/teams/[id]", params: { id: team.id } });
        void refreshDirectory().catch(() => {});
      } catch (cause) {
        haptic.error();
        Alert.alert(
          "Couldn’t Create Team",
          cause instanceof Error ? cause.message : "Check your connection, then try again.",
        );
      } finally {
        creating.current = false;
      }
    },
    [router],
  );

  const newTeam = useCallback(() => {
    Alert.prompt(
      "New Team",
      "Name your team.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Create", onPress: (value?: string) => void create(value) },
      ],
      "plain-text",
    );
  }, [create]);

  const teams = directory?.teams ?? null;
  const oncall = directory?.oncall ?? null;
  const pages = useMemo(
    () => sortPages((oncall?.pages ?? []).filter((page) => page.status !== "resolved")),
    [oncall],
  );
  const showOncall =
    (oncall?.shifts.length ?? 0) > 0 ||
    pages.length > 0 ||
    (teams ?? []).some((team) => team.oncallGroupCount > 0);
  const status = oncallStatus(oncall, now);

  return (
    <>
      <TabRootToolbar>
        {teams ? (
          <Stack.Toolbar.Button accessibilityLabel="New Team" icon="plus" onPress={newTeam} />
        ) : null}
      </TabRootToolbar>
      <List onRefresh={directory || loadFailed ? onRefresh : undefined} refreshing={refreshing}>
        {directory === null ? (
          loadFailed ? (
            <ErrorState
              onRetry={() => void refreshDirectory().catch(() => {})}
              title="Couldn’t Load Teams"
            />
          ) : (
            <LoadingState />
          )
        ) : teams === null ? (
          <EmptyState
            message="This Hark server doesn’t support teams yet."
            symbol="person.2"
            title="Teams Aren’t Available"
          />
        ) : teams.length === 0 ? (
          <EmptyState
            actionTitle="Create a Team"
            // The last two words keep together, so "sent." never sits alone (V-16).
            message={
              "Create a team to share apps with the people you work with and take turns being on call. Got an invite? Open the link your teammate\u00A0sent."
            }
            onAction={newTeam}
            symbol="person.2"
            title="No Teams Yet"
          />
        ) : (
          <>
            {showOncall ? (
              <Section prominent title="On Call">
                <OncallStatusRow onPress={() => router.push("/oncall")} status={status} />
              </Section>
            ) : null}
            {pages.length > 0 ? (
              <Section detail={String(pages.length)} prominent title="Open Pages">
                {pages.map((page) => (
                  <PageRow key={page.id} now={now} page={page} />
                ))}
              </Section>
            ) : null}
            <Section
              footer="Share apps with the people you work with and take turns being on call."
              prominent
              title="Your Teams"
            >
              {teams.map((team) => (
                <Row
                  accessibilityHint="Shows members, invites and on-call groups"
                  chevron
                  key={team.id}
                  leading={<Avatar name={team.name} size={AVATAR} />}
                  leadingWidth={AVATAR}
                  onPress={() => router.push({ pathname: "/teams/[id]", params: { id: team.id } })}
                  subtitle={teamSubtitle(team, stacked)}
                  subtitleLines={1}
                  title={team.name}
                />
              ))}
            </Section>
          </>
        )}
      </List>
    </>
  );
}
