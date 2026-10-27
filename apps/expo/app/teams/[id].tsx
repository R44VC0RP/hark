import type {
  OncallGroupDto,
  TeamDto,
  TeamInviteDto,
  TeamMemberDto,
  TeamRole,
} from "@hark/contracts";
import * as Device from "expo-device";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  PersonAvatar,
  ScreenHeader,
  SeatLimitNotice,
  SecondaryButton,
  SectionLabel,
  ui,
} from "../../src/components/screen-parts";
import { api } from "../../src/lib/api";
import { useSession } from "../../src/lib/auth";
import {
  previewOncallGroups,
  previewTeamInvites,
  previewTeamMembers,
  previewTeams,
  previewViewer,
} from "../../src/lib/inbox-preview";
import {
  canManageTeam,
  formatHandoff,
  isSeatLimitError,
  memberCountLabel,
  roleLabel,
  seatsFull,
  seatsLabel,
} from "../../src/lib/teams";
import { colors } from "../../src/lib/theme";

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Please try again.";
}

export default function TeamDetailScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = String(rawId);
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const viewerId = simulatorPreview ? previewViewer.userId : session?.user.id;
  const [team, setTeam] = useState<TeamDto | null>(null);
  const [members, setMembers] = useState<TeamMemberDto[]>([]);
  const [invites, setInvites] = useState<TeamInviteDto[]>([]);
  const [groups, setGroups] = useState<OncallGroupDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seatLimitHit, setSeatLimitHit] = useState(false);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    if (simulatorPreview) {
      const preview = previewTeams.find((item) => item.id === id);
      if (!preview) return setError("This team no longer exists.");
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
      setTeam(result.team);
      setMembers(result.members);
      setError(null);
      const [inviteResult, groupResult] = await Promise.all([
        canManageTeam(result.team.role)
          ? api.listTeamInvites(id).catch(() => null)
          : Promise.resolve(null),
        // Older servers lack on-call; the section simply stays hidden.
        api.listOncallGroups(id).catch(() => null),
      ]);
      setInvites(inviteResult?.invites ?? []);
      setGroups(groupResult?.groups ?? null);
    } catch (cause) {
      setError(errorText(cause));
    }
  }, [id, simulatorPreview]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!isPending && !session && !simulatorPreview) return <Redirect href="/" />;

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
        setInvites((current) => [result.invite, ...current]);
        setSeatLimitHit(false);
        setInviting(false);
        await Share.share({
          message: `Join ${team.name} on Hark: ${result.url}`,
          url: result.url,
        });
      } catch (cause) {
        if (isSeatLimitError(cause)) setSeatLimitHit(true);
        else Alert.alert("Couldn’t create invite", errorText(cause));
      } finally {
        setInviting(false);
      }
    })();
  };

  const chooseInviteRole = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `Invite to ${team?.name ?? "team"}`,
        message: "You’ll get a link to send. It works once and expires in 7 days.",
        options: ["Invite as member", "Invite as admin", "Cancel"],
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) invite("member");
        else if (index === 1) invite("admin");
      },
    );
  };

  const revokeInvite = (item: TeamInviteDto) => {
    if (!team) return;
    Alert.alert("Revoke invite?", "The link stops working right away.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Revoke",
        style: "destructive",
        onPress: () => {
          setInvites((current) => current.filter((entry) => entry.id !== item.id));
          if (simulatorPreview) return;
          void api.revokeTeamInvite(team.id, item.id).catch((cause: unknown) => {
            Alert.alert("Couldn’t revoke invite", errorText(cause));
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
      Alert.alert("Couldn’t change role", errorText(cause));
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
            setMembers((current) => current.filter((entry) => entry.userId !== member.userId));
            if (simulatorPreview) return;
            void api
              .removeTeamMember(team.id, member.userId)
              .then(() => load())
              .catch((cause: unknown) => {
                Alert.alert("Couldn’t remove member", errorText(cause));
                void load();
              });
          },
        },
      ],
    );
  };

  const memberActions = (member: TeamMemberDto) => {
    // Admins manage members and admins; only owners touch other owners.
    if (member.role === "owner" && !owner) return;
    const options: Array<{ label: string; run: () => void; destructive?: boolean }> = [];
    if (member.role === "member") {
      options.push({ label: "Make admin", run: () => changeRole(member, "admin") });
    } else if (member.role === "admin") {
      options.push({ label: "Make member", run: () => changeRole(member, "member") });
    }
    options.push({ label: "Remove from team", run: () => removeMember(member), destructive: true });
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: member.name,
        message: `${roleLabel(member.role)} · ${member.email}`,
        options: [...options.map((option) => option.label), "Cancel"],
        destructiveButtonIndex: options.findIndex((option) => option.destructive),
        cancelButtonIndex: options.length,
      },
      (index) => options[index]?.run(),
    );
  };

  const rename = () => {
    if (!team) return;
    Alert.prompt(
      "Rename team",
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
              .then((result) => setTeam(result.team))
              .catch((cause: unknown) => {
                Alert.alert("Couldn’t rename team", errorText(cause));
                setTeam(team);
              });
          },
        },
      ],
      "plain-text",
      team.name,
    );
  };

  const leave = () => {
    if (!team) return;
    Alert.alert(
      `Leave ${team.name}?`,
      "Its apps disappear from your home screen and you’re taken off its on-call rotations.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave team",
          style: "destructive",
          onPress: () => {
            if (simulatorPreview) return router.back();
            void api
              .leaveTeam(team.id)
              .then(() => (router.canGoBack() ? router.back() : router.replace("/teams")))
              .catch((cause: unknown) => Alert.alert("Couldn’t leave team", errorText(cause)));
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
          text: "Delete team",
          style: "destructive",
          onPress: () => {
            if (simulatorPreview) return router.back();
            void api
              .deleteTeam(team.id)
              .then(() => (router.canGoBack() ? router.back() : router.replace("/teams")))
              .catch((cause: unknown) => Alert.alert("Couldn’t delete team", errorText(cause)));
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={ui.container}>
      <StatusBar style="dark" />
      <ScreenHeader
        fallback="/teams"
        right={
          admin ? (
            <Pressable
              accessibilityLabel="Rename team"
              accessibilityRole="button"
              onPress={rename}
              style={({ pressed }) => [ui.iconButton, pressed && ui.iconButtonPressed]}
            >
              <SymbolView name="pencil" size={16} tintColor={colors.muted} />
            </Pressable>
          ) : undefined
        }
      />
      {!team ? (
        error ? (
          <Text style={[ui.message, { paddingHorizontal: 24 }]}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.accent} style={ui.loading} />
        )
      ) : (
        <ScrollView contentContainerStyle={ui.scroll}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <PersonAvatar name={team.name} size={52} />
            <View style={ui.rowCopy}>
              <Text style={ui.title}>{team.name}</Text>
              <Text style={ui.muted}>
                {roleLabel(team.role)} · {seatsLabel(team.seats)}
                {team.plan === "team" ? " · Team plan" : ""}
              </Text>
            </View>
          </View>

          {admin ? (
            <View style={{ marginTop: 20 }}>
              <Pressable
                accessibilityHint="Creates a join link and opens the share sheet"
                accessibilityLabel="Invite people"
                accessibilityRole="button"
                disabled={inviting}
                onPress={chooseInviteRole}
                style={({ pressed }) => [
                  ui.primaryButton,
                  { flexDirection: "row", gap: 8 },
                  inviting && ui.disabled,
                  pressed && ui.primaryButtonPressed,
                ]}
              >
                <SymbolView name="person.badge.plus" size={16} tintColor="#FFFFFF" />
                <Text style={ui.primaryButtonText}>
                  {inviting ? "Creating link…" : "Invite people"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {seatLimitHit || seatsFull(team.seats) ? (
            <SeatLimitNotice
              admin={admin}
              teamName={team.name}
              title={seatLimitHit ? undefined : "Every seat is in use"}
            />
          ) : null}

          {groups && groups.length > 0 ? (
            <>
              <SectionLabel>On call</SectionLabel>
              {groups.map((group, index) => (
                <Pressable
                  accessibilityHint="Shows shifts and open pages"
                  accessibilityLabel={`${group.name} on-call group${group.current ? `, ${group.current.person.name} is on call` : ""}${group.openPageCount > 0 ? `, ${group.openPageCount} open pages` : ""}`}
                  accessibilityRole="button"
                  key={group.id}
                  onPress={() => router.push({ pathname: "/oncall", params: { team: team.id } })}
                  style={({ pressed }) => [
                    ui.row,
                    index === groups.length - 1 && ui.lastRow,
                    pressed && ui.rowPressed,
                  ]}
                >
                  <View style={[ui.avatar, { width: 34, height: 34, borderRadius: 17 }]}>
                    <SymbolView name="bell.badge.fill" size={15} tintColor={colors.accent} />
                  </View>
                  <View style={ui.rowCopy}>
                    <Text style={ui.rowLabel}>{group.name}</Text>
                    <Text style={ui.rowValue}>
                      {group.current
                        ? `${group.current.person.userId === viewerId ? "You" : group.current.person.name} until ${formatHandoff(group.current.endsAt)}`
                        : "Nobody on call"}
                    </Text>
                  </View>
                  {group.openPageCount > 0 ? (
                    <View style={[ui.rolePill, { backgroundColor: colors.accentSoft }]}>
                      <Text style={[ui.rolePillText, { color: colors.accent }]}>
                        {group.openPageCount} open
                      </Text>
                    </View>
                  ) : null}
                  <SymbolView name="chevron.right" size={12} tintColor={colors.soft} />
                </Pressable>
              ))}
            </>
          ) : null}

          <SectionLabel detail={memberCountLabel(members.length)}>Members</SectionLabel>
          {members.map((member, index) => {
            const self = member.userId === viewerId;
            const manageable = admin && !self && (member.role !== "owner" || owner);
            return (
              <Pressable
                accessibilityHint={manageable ? "Change role or remove" : undefined}
                accessibilityLabel={`${member.name}${self ? " (you)" : ""}, ${roleLabel(member.role)}`}
                accessibilityRole={manageable ? "button" : undefined}
                disabled={!manageable}
                key={member.userId}
                onPress={() => memberActions(member)}
                style={({ pressed }) => [
                  ui.row,
                  index === members.length - 1 && ui.lastRow,
                  pressed && ui.rowPressed,
                ]}
              >
                <PersonAvatar image={member.image} name={member.name} size={34} />
                <View style={ui.rowCopy}>
                  <Text numberOfLines={1} style={ui.rowLabel}>
                    {member.name}
                    {self ? <Text style={ui.rowValue}> · You</Text> : null}
                  </Text>
                  <Text numberOfLines={1} style={ui.rowValue}>
                    {member.email}
                  </Text>
                </View>
                <View style={ui.rolePill}>
                  <Text style={ui.rolePillText}>{roleLabel(member.role)}</Text>
                </View>
                {manageable ? (
                  <SymbolView name="ellipsis" size={14} tintColor={colors.soft} />
                ) : admin ? (
                  <View style={{ width: 14 }} />
                ) : null}
              </Pressable>
            );
          })}

          {admin && pendingInvites.length > 0 ? (
            <>
              <SectionLabel>Pending invites</SectionLabel>
              {pendingInvites.map((item, index) => (
                <Pressable
                  accessibilityHint="Revokes the invite"
                  accessibilityLabel={`Invite ${item.email ?? "link"}, ${roleLabel(item.role)}`}
                  accessibilityRole="button"
                  key={item.id}
                  onPress={() => revokeInvite(item)}
                  style={({ pressed }) => [
                    ui.row,
                    index === pendingInvites.length - 1 && ui.lastRow,
                    pressed && ui.rowPressed,
                  ]}
                >
                  <View style={[ui.avatar, { width: 34, height: 34, borderRadius: 17 }]}>
                    <SymbolView name="link" size={14} tintColor={colors.accent} />
                  </View>
                  <View style={ui.rowCopy}>
                    <Text numberOfLines={1} style={ui.rowLabel}>
                      {item.email ?? "Invite link"}
                    </Text>
                    <Text numberOfLines={1} style={ui.rowValue}>
                      {roleLabel(item.role)} · from {item.invitedBy} · expires{" "}
                      {new Date(item.expiresAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </Text>
                  </View>
                  <Text style={[ui.rowTrailing, { color: colors.danger }]}>Revoke</Text>
                </Pressable>
              ))}
            </>
          ) : null}

          <View style={{ gap: 10, marginTop: 30 }}>
            <SecondaryButton destructive label="Leave team" onPress={leave} />
            {owner ? (
              <SecondaryButton destructive label="Delete team" onPress={deleteTeam} />
            ) : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
