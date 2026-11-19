import { Button as MenuButton } from "@expo/ui/swift-ui";
import type {
  OncallGroupDto,
  OncallPageDto,
  TeamDto,
  TeamInviteDto,
  TeamMemberDto,
  TeamRole,
} from "@hark/contracts";
import * as Device from "expo-device";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Share, StyleSheet, View } from "react-native";
import { FactLine } from "../../../../src/components/teams/fact-line";
import { InviteRow } from "../../../../src/components/teams/invite-row";
import { type MemberAction, MemberRow } from "../../../../src/components/teams/member-row";
import { RowMenu } from "../../../../src/components/teams/row-menu";
import { SeatLimitNotice } from "../../../../src/components/teams/seat-limit-notice";
import { ApiError, api } from "../../../../src/lib/api";
import { refreshDirectory } from "../../../../src/lib/app-directory";
import { useSession } from "../../../../src/lib/auth";
import { formatUpcoming } from "../../../../src/lib/dates";
import { alertFailure, haptic } from "../../../../src/lib/haptics";
import {
  previewOncallGroups,
  previewPages,
  previewTeamInvites,
  previewTeamMembers,
  previewTeams,
  previewViewer,
} from "../../../../src/lib/inbox-preview";
import { backOr } from "../../../../src/lib/navigation";
import {
  canManageTeam,
  isSeatLimitError,
  roleLabel,
  seatsFull,
  seatsLabel,
  unbroken,
} from "../../../../src/lib/teams";
import { spoken } from "../../../../src/ui/a11y";
import { Avatar } from "../../../../src/ui/avatar";
import {
  EmptyState,
  ErrorState,
  isNetworkError,
  LoadingState,
} from "../../../../src/ui/empty-state";
import {
  ActionRow,
  List,
  Row,
  Section,
  useLargeText,
  useStackedRows,
} from "../../../../src/ui/list";
import { animateListChange } from "../../../../src/ui/motion";
import { Text } from "../../../../src/ui/text";
import { colors, metrics, radius, space } from "../../../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;
const AVATAR = 60;
const CAPSULE = 22;

type LoadFailure = "network" | "other" | "missing";

/**
 * "Alex Kim until Thu at 5:00 AM" or "Nobody on call". At accessibility sizes
 * the open-page count goes on its own line instead of squeezing the name
 * beside a capsule. From xxxLarge the handoff may wrap between its words:
 * kept in one piece it no longer fit beside the capsule on a 375-pt iPhone
 * and its time was cut ("until Fri at 5:00…", SS-09).
 */
function groupSubtitle(
  group: OncallGroupDto,
  viewerId: string | undefined,
  stacked: boolean,
  wrap: boolean,
) {
  const open = stacked && group.openPageCount > 0 ? `\n${group.openPageCount} open` : "";
  if (!group.current) return `Nobody on call${open}`;
  const who = group.current.person.userId === viewerId ? "You" : group.current.person.name;
  const until = `until ${formatUpcoming(group.current.endsAt)}`;
  return `${who} ${wrap ? until : unbroken(until)}${open}`;
}

/** "Owner", "5 seats", "Team plan": one line, or one fact per line at AX sizes. */
function identityFacts(team: TeamDto): string[] {
  return [
    roleLabel(team.role),
    seatsLabel(team.seats),
    ...(team.plan === "team" ? ["Team plan"] : []),
  ];
}

/**
 * A team (DESIGN.md 5.13): who is in it, who is invited, its on-call groups,
 * and what you can do as its owner, admin or member. Admins rename it from
 * the header; inviting and managing members are native menus (I-07).
 */
export default function TeamScreen() {
  const { data: session } = useSession();
  const router = useRouter();
  const stacked = useStackedRows();
  const largeText = useLargeText();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = String(rawId);
  const viewerId = simulatorPreview ? previewViewer.userId : session?.user.id;
  const [team, setTeam] = useState<TeamDto | null>(null);
  const [members, setMembers] = useState<TeamMemberDto[]>([]);
  const [invites, setInvites] = useState<TeamInviteDto[]>([]);
  const [groups, setGroups] = useState<OncallGroupDto[] | null>(null);
  const [openPages, setOpenPages] = useState<OncallPageDto[]>([]);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [seatLimitHit, setSeatLimitHit] = useState(false);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    if (simulatorPreview) {
      const preview = previewTeams.find((item) => item.id === id);
      if (!preview) {
        setFailure("missing");
        return;
      }
      setTeam(preview);
      const isAcme = preview.id === previewTeams[0]?.id;
      setMembers(
        isAcme
          ? previewTeamMembers
          : [{ ...previewTeamMembers[0], role: "owner" } as TeamMemberDto],
      );
      setInvites(isAcme ? previewTeamInvites.filter((invite) => !invite.revokedAt) : []);
      setGroups(isAcme ? previewOncallGroups : []);
      setOpenPages(previewPages.filter((page) => page.teamId === preview.id));
      return;
    }
    try {
      const result = await api.getTeam(id);
      const [inviteResult, groupResult, pageResult] = await Promise.all([
        canManageTeam(result.team.role)
          ? api.listTeamInvites(id).catch(() => null)
          : Promise.resolve(null),
        // Older servers lack on-call; the section simply stays hidden.
        api.listOncallGroups(id).catch(() => null),
        // Which groups have a page nobody has acknowledged yet (V-14).
        api.listTeamPages(id, { status: "open" }).catch(() => null),
      ]);
      setTeam(result.team);
      setMembers(result.members);
      setInvites(inviteResult?.invites ?? []);
      setGroups(groupResult?.groups ?? null);
      setOpenPages(pageResult?.pages ?? []);
      setFailure(null);
    } catch (cause) {
      setFailure(
        cause instanceof ApiError && cause.status === 404
          ? "missing"
          : isNetworkError(cause)
            ? "network"
            : "other",
      );
    }
  }, [id]);

  // Back from On Call or the share sheet: show what changed meanwhile. The
  // app directory reloads with it, so the open-page counts here, the Teams
  // badge and the pages accessory agree (I-05).
  useFocusEffect(
    useCallback(() => {
      void load();
      void refreshDirectory().catch(() => {});
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshDirectory().catch(() => {})]);
    setRefreshing(false);
  };

  const needsResponder = (groupId: string) =>
    openPages.some((page) => page.groupId === groupId && page.status === "triggered");
  const admin = canManageTeam(team?.role);
  const owner = team?.role === "owner";
  const pendingInvites = invites.filter(
    (invite) =>
      !invite.acceptedAt && !invite.revokedAt && Date.parse(invite.expiresAt) > Date.now(),
  );

  const invite = (role: "member" | "admin") => {
    if (!team || inviting) return;
    setInviting(true);
    void (async () => {
      try {
        const result = simulatorPreview
          ? {
              url: "https://hark.fyi/join/preview-invite-code",
              invite: {
                ...(previewTeamInvites[0] as TeamInviteDto),
                id: `inv_preview${Date.now().toString(36)}`,
                email: null,
                role,
                createdAt: new Date().toISOString(),
              },
            }
          : await api.createTeamInvite(team.id, { role });
        haptic.success();
        animateListChange();
        setInvites((current) => [result.invite, ...current]);
        setSeatLimitHit(false);
        setInviting(false);
        await Share.share({
          message: `Join ${team.name} on Hark: ${result.url}`,
          url: result.url,
        });
      } catch (cause) {
        if (isSeatLimitError(cause)) {
          haptic.error();
          setSeatLimitHit(true);
        } else alertFailure("Couldn’t Create Invite", cause);
      } finally {
        setInviting(false);
      }
    })();
  };

  const revokeInvite = (item: TeamInviteDto) => {
    if (!team) return;
    Alert.alert("Revoke Invite?", "The link stops working right away.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: () => {
          animateListChange();
          setInvites((current) => current.filter((entry) => entry.id !== item.id));
          if (simulatorPreview) return;
          void api.revokeTeamInvite(team.id, item.id).catch((cause: unknown) => {
            alertFailure("Couldn’t Revoke Invite", cause);
            void load();
          });
        },
      },
    ]);
  };

  const changeRole = (member: TeamMemberDto, role: TeamRole) => {
    if (!team) return;
    setMembers((current) =>
      current.map((entry) => (entry.userId === member.userId ? { ...entry, role } : entry)),
    );
    if (simulatorPreview) return;
    void api.updateTeamMember(team.id, member.userId, role).catch((cause: unknown) => {
      alertFailure("Couldn’t Change Role", cause);
      void load();
    });
  };

  const removeMember = (member: TeamMemberDto) => {
    if (!team) return;
    Alert.alert(
      `Remove ${member.name}?`,
      `They lose access to ${team.name}’s apps and on-call groups.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            animateListChange();
            setMembers((current) => current.filter((entry) => entry.userId !== member.userId));
            if (simulatorPreview) return;
            void api
              .removeTeamMember(team.id, member.userId)
              .then(() => {
                void load();
                void refreshDirectory().catch(() => {});
              })
              .catch((cause: unknown) => {
                alertFailure("Couldn’t Remove Member", cause);
                void load();
              });
          },
        },
      ],
    );
  };

  /** A member's menu: change their role, or remove them (confirmed first). */
  const memberActions = (member: TeamMemberDto): MemberAction[] => {
    const actions: MemberAction[] = [];
    if (member.role === "member") {
      actions.push({
        label: "Make Admin",
        icon: "person.badge.key",
        run: () => changeRole(member, "admin"),
      });
    } else if (member.role === "admin") {
      actions.push({
        label: "Make Member",
        icon: "person",
        run: () => changeRole(member, "member"),
      });
    }
    actions.push({
      label: "Remove from Team",
      icon: "person.badge.minus",
      destructive: true,
      run: () => removeMember(member),
    });
    return actions;
  };

  const rename = () => {
    if (!team) return;
    Alert.prompt(
      "Rename Team",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",

          onPress: (value?: string) => {
            const name = value?.trim();
            if (!name || name === team.name) return;
            setTeam({ ...team, name });
            if (simulatorPreview) return;
            void api
              .renameTeam(team.id, name)
              .then((result) => {
                setTeam(result.team);
                void refreshDirectory().catch(() => {});
              })
              .catch((cause: unknown) => {
                alertFailure("Couldn’t Rename Team", cause);
                setTeam(team);
              });
          },
        },
      ],
      "plain-text",
      team.name,
    );
  };

  /** After leaving or deleting: back to Teams, which reloads its list. */
  const leaveScreen = () => {
    void refreshDirectory().catch(() => {});
    backOr("/teams");
  };

  const leave = () => {
    if (!team) return;
    Alert.alert(
      `Leave ${team.name}?`,
      "Its apps disappear from your Apps tab and you’re taken off its on-call rotations.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave Team",
          style: "destructive",
          onPress: () => {
            if (simulatorPreview) return router.back();
            void api
              .leaveTeam(team.id)
              .then(leaveScreen)
              .catch((cause: unknown) => alertFailure("Couldn’t Leave Team", cause));
          },
        },
      ],
    );
  };

  const deleteTeam = () => {
    if (!team) return;
    Alert.alert(
      `Delete ${team.name}?`,
      "Its apps, on-call groups and pages are deleted for everyone. This can’t be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Team",
          style: "destructive",
          onPress: () => {
            if (simulatorPreview) return router.back();
            void api
              .deleteTeam(team.id)
              .then(leaveScreen)
              .catch((cause: unknown) => alertFailure("Couldn’t Delete Team", cause));
          },
        },
      ],
    );
  };

  return (
    <>
      {/*
        No bar title: the identity block right under the bar names the team,
        as Contacts and Apple Account do; a title as well showed the name
        twice at rest (V2-08).
      */}
      <Stack.Screen options={{ title: "" }} />
      {admin ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button accessibilityLabel="Rename Team" icon="pencil" onPress={rename} />
        </Stack.Toolbar>
      ) : null}
      <List
        onRefresh={team || failure ? () => void onRefresh() : undefined}
        refreshing={refreshing}
      >
        {!team ? (
          failure === "missing" ? (
            <EmptyState
              message="It was deleted or you’re no longer a member."
              symbol="person.2"
              title="Team Unavailable"
            />
          ) : failure ? (
            <ErrorState
              network={failure === "network"}
              onRetry={() => {
                setFailure(null);
                void load();
              }}
              title="Couldn’t Load Team"
            />
          ) : (
            <LoadingState />
          )
        ) : (
          <>
            <View
              accessibilityLabel={spoken(team.name, ...identityFacts(team))}
              accessibilityRole="header"
              accessible
              style={[styles.identity, stacked && styles.identityStacked]}
            >
              <Avatar name={team.name} size={AVATAR} />
              <View style={styles.identityCopy}>
                <Text variant="title3">{team.name}</Text>
                <FactLine facts={identityFacts(team)} />
              </View>
            </View>

            {admin ? (
              <Section
                footer={"You’ll get a link to send. It works once and expires in 7\u00A0days."}
              >
                <RowMenu
                  anchor="leading"
                  disabled={inviting}
                  hint="Creates a join link and opens the share sheet"
                  label={inviting ? "Creating Link…" : "Invite People…"}
                  menu={
                    <>
                      <MenuButton
                        label="Invite as Member"
                        onPress={() => invite("member")}
                        systemImage="person.badge.plus"
                      />
                      <MenuButton
                        label="Invite as Admin"
                        onPress={() => invite("admin")}
                        systemImage="person.badge.key"
                      />
                    </>
                  }
                >
                  <ActionRow
                    disabled={inviting}
                    symbol="person.badge.plus"
                    title={inviting ? "Creating Link…" : "Invite People…"}
                  />
                </RowMenu>
              </Section>
            ) : null}

            {seatLimitHit || seatsFull(team.seats) ? (
              <SeatLimitNotice owner={owner} teamName={team.name} />
            ) : null}

            {groups && groups.length > 0 ? (
              <Section prominent title="On Call">
                {groups.map((group) => (
                  <Row
                    accessibilityHint="Shows shifts, rotations and open pages"
                    chevron
                    key={group.id}
                    onPress={() =>
                      router.push({
                        pathname: "/oncall",
                        params: { team: team.id, name: team.name },
                      })
                    }
                    subtitle={groupSubtitle(group, viewerId, stacked, stacked || largeText)}
                    subtitleLines={largeText ? 4 : 2}
                    symbol="bell"
                    title={group.name}
                    trailing={
                      group.openPageCount > 0 && !stacked ? (
                        // Red while a page in the group needs a responder,
                        // like every other open page in the app (V-14).
                        <View
                          accessibilityLabel={`${group.openPageCount} open`}
                          style={[
                            styles.openCapsule,
                            needsResponder(group.id) ? styles.openCapsuleUrgent : null,
                          ]}
                        >
                          <Text
                            color={needsResponder(group.id) ? "danger" : "accent"}
                            maxFontSizeMultiplier={1.3}
                            tabular
                            variant="caption1"
                            weight="600"
                          >
                            {`${group.openPageCount} open`}
                          </Text>
                        </View>
                      ) : null
                    }
                  />
                ))}
              </Section>
            ) : null}

            <Section detail={String(members.length)} prominent title="Members">
              {members.map((member) => {
                const self = member.userId === viewerId;
                // Admins manage members and admins; only owners touch other owners.
                const manageable = admin && !self && (member.role !== "owner" || owner);
                return (
                  <MemberRow
                    actions={manageable ? memberActions(member) : []}
                    key={member.userId}
                    member={member}
                    reserveAction={admin}
                    self={self}
                  />
                );
              })}
            </Section>

            {admin && pendingInvites.length > 0 ? (
              <Section detail={String(pendingInvites.length)} prominent title="Pending Invites">
                {pendingInvites.map((item) => (
                  <InviteRow invite={item} key={item.id} onRevoke={revokeInvite} />
                ))}
              </Section>
            ) : null}

            <Section>
              <ActionRow destructive onPress={leave} title="Leave Team" />
              {owner ? <ActionRow destructive onPress={deleteTeam} title="Delete Team" /> : null}
            </Section>
          </>
        )}
      </List>
    </>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    marginTop: space.l,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
  identityStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s,
  },
  identityCopy: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    gap: 2,
  },
  openCapsule: {
    minHeight: CAPSULE,
    justifyContent: "center",
    paddingHorizontal: space.xs,
    borderRadius: radius.capsule(CAPSULE),
    borderCurve: "continuous",
    backgroundColor: colors.accentSoft,
  },
  openCapsuleUrgent: {
    backgroundColor: colors.dangerSoft,
  },
});
