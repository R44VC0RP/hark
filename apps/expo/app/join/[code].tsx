import type { TeamInvitePreviewDto } from "@hark/contracts";
import * as Device from "expo-device";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  MetaRow,
  PersonAvatar,
  PrimaryButton,
  ScreenHeader,
  SeatLimitNotice,
  ui,
} from "../../src/components/screen-parts";
import { ApiError, api } from "../../src/lib/api";
import { useSession } from "../../src/lib/auth";
import { PREVIEW_TEAM_ID, previewInvite } from "../../src/lib/inbox-preview";
import {
  isSeatLimitError,
  memberCountLabel,
  PENDING_JOIN_CODE_KEY,
  roleLabel,
} from "../../src/lib/teams";
import { colors } from "../../src/lib/theme";

export default function JoinTeamScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const { code: rawCode } = useLocalSearchParams<{ code: string }>();
  const code = String(rawCode ?? "");
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const [invite, setInvite] = useState<TeamInvitePreviewDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [seatLimit, setSeatLimit] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const signedOut = !isPending && !session && !simulatorPreview;

  useEffect(() => {
    // Remember the invite so it reopens right after sign-in.
    if (signedOut && code) void SecureStore.setItemAsync(PENDING_JOIN_CODE_KEY, code);
  }, [signedOut, code]);

  useEffect(() => {
    if (simulatorPreview) {
      setInvite(previewInvite);
      return;
    }
    void api
      .previewTeamInvite(code)
      .then(setInvite)
      .catch((cause: unknown) =>
        setLoadError(
          cause instanceof ApiError && (cause.status === 404 || cause.status === 410)
            ? "This invite has expired or was already used. Ask your teammate for a new link."
            : cause instanceof Error
              ? cause.message
              : "Couldn’t load this invite.",
        ),
      );
  }, [code, simulatorPreview]);

  if (signedOut) return <Redirect href="/" />;

  const close = () => (router.canGoBack() ? router.back() : router.replace("/apps"));

  const join = async () => {
    if (joining) return;
    setJoining(true);
    setJoinError(null);
    setSeatLimit(false);
    try {
      const teamId = simulatorPreview
        ? PREVIEW_TEAM_ID
        : (await api.acceptTeamInvite(code)).team.id;
      router.dismissTo({ pathname: "/apps", params: { team: teamId } });
    } catch (cause) {
      if (isSeatLimitError(cause)) setSeatLimit(true);
      else setJoinError(cause instanceof Error ? cause.message : "Couldn’t join this team.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={ui.container}>
      <StatusBar style="dark" />
      <ScreenHeader />
      {!invite ? (
        loadError ? (
          <View style={{ paddingHorizontal: 24, gap: 16 }}>
            <Text style={ui.title}>Invite unavailable</Text>
            <Text style={ui.muted}>{loadError}</Text>
          </View>
        ) : (
          <ActivityIndicator color={colors.accent} style={ui.loading} />
        )
      ) : (
        <View style={{ flex: 1, justifyContent: "space-between", paddingHorizontal: 24 }}>
          <View>
            <View style={{ alignItems: "flex-start", gap: 16, paddingTop: 16 }}>
              <PersonAvatar name={invite.teamName} size={60} />
              <Text style={[ui.title, { fontSize: 26, lineHeight: 32 }]}>
                Join {invite.teamName} on Hark
              </Text>
              <Text style={ui.body}>
                {invite.invitedBy} invited you. You’ll see {invite.teamName}’s apps on your home
                screen and can be added to its on-call rotations.
              </Text>
            </View>
            <View style={ui.metaBlock}>
              <MetaRow label="Team" value={invite.teamName} />
              <MetaRow label="Invited by" value={invite.invitedBy} />
              <MetaRow label="Role" value={roleLabel(invite.role)} />
              <MetaRow label="Members" value={memberCountLabel(invite.memberCount)} />
            </View>
            <Text style={[ui.muted, { marginTop: 12 }]}>
              Each team app still asks before signing you in, and you choose what it sees.
            </Text>
            {seatLimit ? <SeatLimitNotice owner={false} teamName={invite.teamName} /> : null}
            {joinError ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[ui.muted, { color: colors.danger, marginTop: 12 }]}
              >
                {joinError}
              </Text>
            ) : null}
          </View>
          <View style={{ gap: 4, paddingBottom: 12 }}>
            <PrimaryButton
              accessibilityHint={`Adds you to ${invite.teamName}`}
              busy={joining}
              label={`Join ${invite.teamName}`}
              onPress={() => void join()}
            />
            <Pressable
              accessibilityLabel="Not now"
              accessibilityRole="button"
              onPress={close}
              style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={ui.secondaryButtonText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
