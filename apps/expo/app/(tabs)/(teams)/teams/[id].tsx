import { Button as MenuButton } from "@expo/ui/swift-ui";
import type {
  OncallGroupDto,
  TeamDto,
  TeamInviteDto,
  TeamMemberDto,
  TeamRole,
} from "@hark/contracts";
import * as Device from "expo-device";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Share, StyleSheet, View } from "react-native";
import { InviteRow } from "../../../../src/components/teams/invite-row";
import { type MemberAction, MemberRow } from "../../../../src/components/teams/member-row";
import { unbroken } from "../../../../src/components/teams/page-row";
import { MenuShield, RowMenu } from "../../../../src/components/teams/row-menu";
import { SeatLimitNotice } from "../../../../src/components/teams/seat-limit-notice";
import { ApiError, api } from "../../../../src/lib/api";
import { refreshDirectory } from "../../../../src/lib/app-directory";
import { useSession } from "../../../../src/lib/auth";
import { haptic } from "../../../../src/lib/haptics";
import {
  previewOncallGroups,
  previewTeamInvites,
  previewTeamMembers,
  previewTeams,
  previewViewer,
} from "../../../../src/lib/inbox-preview";
import {
  canManageTeam,
  formatHandoff,
  isSeatLimitError,
  roleLabel,
  seatsFull,
  seatsLabel,
} from "../../../../src/lib/teams";
import { Avatar } from "../../../../src/ui/avatar";
import {
  EmptyState,
  ErrorState,
  isNetworkError,
  LoadingState,
} from "../../../../src/ui/empty-state";
import { ActionRow, List, Row, Section, useStackedRows } from "../../../../src/ui/list";
import { animateListChange } from "../../../../src/ui/motion";
import { Text } from "../../../../src/ui/text";
import { colors, metrics, radius, space } from "../../../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;
const AVATAR = 60;
const CAPSULE = 22;

type LoadFailure = "network" | "other" | "missing";

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Check your connection, then try again.";
}

function failed(title: string, cause: unknown): void {
  haptic.error();
  Alert.alert(title, errorText(cause));
}

/**
 * "Alex Kim until Thu 5:00 AM" or "Nobody on call". At accessibility sizes
 * the open-page count joins it instead of squeezing the name beside a
 * capsule, and the handoff may wrap.
 */
function groupSubtitle(group: OncallGroupDto, viewerId: string | undefined, stacked: boolean) {
  if (!group.current) {
    return stacked && group.openPageCount > 0
      ? `Nobody on call · ${group.openPageCount} open`
      : "Nobody on call";
  }
  const who = group.current.person.userId === viewerId ? "You" : group.current.person.name;
  const until = `until ${formatHandoff(group.current.endsAt)}`;
  if (!stacked) return `${who} ${unbroken(until)}`;
  return `${who} ${until}${group.openPageCount > 0 ? ` · ${group.openPageCount} open` : ""}`;
}

/** "Owner · 5 seats · Team plan" */
function identityLine(team: TeamDto): string {
  return `${roleLabel(team.role)} · ${seatsLabel(team.seats)}${team.plan === "team" ? " · Team plan" : ""}`;
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
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = String(rawId);
  const viewerId = simulatorPreview ? previewViewer.userId : session?.user.id;
  const [team, setTeam] = useState<TeamDto | null>(null);
  const [members, setMembers] = useState<TeamMemberDto[]>([]);
  const [invites, setInvites] = useState<TeamInviteDto[]>([]);
  const [groups, setGroups] = useState<OncallGroupDto[] | null>(null);
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
      return;
    }
    try {
      const result = await api.getTeam(id);
      const [inviteResult, groupResult] = await Promise.all([
        canManageTeam(result.team.role)
          ? api.listTeamInvites(id).catch(() => null)
          : Promise.resolve(null),
        // Older servers lack on-call; the section simply stays hidden.
        api.listOncallGroups(id).catch(() => null),
      ]);
      setTeam(result.team);
      setMembers(result.members);
      setInvites(inviteResult?.invites ?? []);
      setGroups(groupResult?.groups ?? null);
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

  // Back from On Call or the share sheet: show what changed meanwhile.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

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
        } else failed("Couldn't Create Invite", cause);
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
            failed("Couldn't Revoke Invite", cause);
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
      failed("Couldn't Change Role", cause);
      void load();
    });
  };

  const removeMember = (member: TeamMemberDto) => {
    if (!team) return;
    Alert.alert(
      `Remove ${member.name}?`,
      `They lose access to ${team.name}'s apps and on-call groups.`,
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
                failed("Couldn't Remove Member", cause);
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
      label: "Remove from Team…",
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
                failed("Couldn't Rename Team", cause);
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
    if (router.canGoBack()) router.back();
    else router.replace("/teams");
  };

  const leave = () => {
    if (!team) return;
    Alert.alert(
      `Leave ${team.name}?`,
      "Its apps disappear from your Apps tab and you're taken off its on-call rotations.",
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
              .catch((cause: unknown) => failed("Couldn't Leave Team", cause));
          },
        },
      ],
    );
  };

  const deleteTeam = () => {
    if (!team) return;
    Alert.alert(
      `Delete ${team.name}?`,
      "Its apps, on-call groups and pages are deleted for everyone. This can't be undone.",
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
              .catch((cause: unknown) => failed("Couldn't Delete Team", cause));
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: team?.name ?? "" }} />
      {admin ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button accessibilityLabel="Rename Team" icon="pencil" onPress={rename} />
        </Stack.Toolbar>
      ) : null}
      <MenuShield>
        <List
          onRefresh={team || failure ? () => void onRefresh() : undefined}
          refreshing={refreshing}
        >
          {!team ? (
            failure === "missing" ? (
              <EmptyState
                message="It was deleted or you're no longer a member."
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
                title="Couldn't Load Team"
              />
            ) : (
              <LoadingState />
            )
          ) : (
            <>
              <View
                accessibilityLabel={`${team.name}. ${identityLine(team)}`}
                accessible
                style={[styles.identity, stacked && styles.identityStacked]}
              >
                <Avatar name={team.name} size={AVATAR} />
                <View style={styles.identityCopy}>
                  <Text accessibilityRole="header" variant="title3">
                    {team.name}
                  </Text>
                  <Text color="secondaryLabel" variant="subheadline">
                    {identityLine(team)}
                  </Text>
                </View>
              </View>

              {admin ? (
                <Section footer="You'll get a link to send. It works once and expires in 7 days.">
                  <RowMenu
                    disabled={inviting}
                    hint="Creates a join link and opens the share sheet"
                    label={inviting ? "Creating Link…" : "Invite People…"}
                    menu={(done) => (
                      <>
                        <MenuButton
                          label="Invite as Member"
                          onPress={() => {
                            done();
                            invite("member");
                          }}
                          systemImage="person.badge.plus"
                        />
                        <MenuButton
                          label="Invite as Admin"
                          onPress={() => {
                            done();
                            invite("admin");
                          }}
                          systemImage="person.badge.key"
                        />
                      </>
                    )}
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
                <Section title="On Call">
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
                      subtitle={groupSubtitle(group, viewerId, stacked)}
                      symbol="bell"
                      title={group.name}
                      trailing={
                        group.openPageCount > 0 && !stacked ? (
                          <View
                            accessibilityLabel={`${group.openPageCount} open`}
                            style={styles.openCapsule}
                          >
                            <Text
                              color="accent"
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

              <Section detail={String(members.length)} title="Members">
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
                <Section detail={String(pendingInvites.length)} title="Pending Invites">
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
      </MenuShield>
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
});
