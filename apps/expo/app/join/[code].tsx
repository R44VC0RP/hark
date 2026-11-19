import type { TeamInvitePreviewDto, TeamJoinResponse } from "@hark/contracts";
import * as Device from "expo-device";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { closeSheet } from "../../src/components/teams/close-sheet";
import { SeatLimitNotice } from "../../src/components/teams/seat-limit-notice";
import { ApiError, api } from "../../src/lib/api";
import { refreshDirectory } from "../../src/lib/app-directory";
import { useSession } from "../../src/lib/auth";
import { haptic } from "../../src/lib/haptics";
import { PREVIEW_TEAM_ID, previewInvite } from "../../src/lib/inbox-preview";
import {
  isSeatLimitError,
  memberCountLabel,
  PENDING_JOIN_CODE_KEY,
  roleLabel,
} from "../../src/lib/teams";
import { Avatar } from "../../src/ui/avatar";
import { EmptyState, ErrorState, isNetworkError, LoadingState } from "../../src/ui/empty-state";
import { LabeledRow, List, Row, Section } from "../../src/ui/list";
import { Text } from "../../src/ui/text";
import { metrics, palette, space } from "../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;
const AVATAR = 64;

type LoadFailure = { kind: "unavailable" | "network" | "other"; message?: string };

/**
 * Join a team from an invite link (DESIGN.md 5.19): who invited you, to
 * what, and one prominent Join in the sheet's bottom toolbar. Signed out,
 * the code is saved and the invite reopens right after sign-in.
 */
export default function JoinTeamSheet() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const { code: rawCode } = useLocalSearchParams<{ code: string }>();
  const code = String(rawCode ?? "");
  const [invite, setInvite] = useState<TeamInvitePreviewDto | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [joining, setJoining] = useState(false);
  const [seatLimit, setSeatLimit] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [alreadyMember, setAlreadyMember] = useState<{ id: string; name: string } | null>(null);
  const signedOut = !isPending && !session && !simulatorPreview;

  useEffect(() => {
    // Remember the invite so it reopens right after sign-in.
    if (signedOut && code) void SecureStore.setItemAsync(PENDING_JOIN_CODE_KEY, code);
  }, [signedOut, code]);

  const load = useCallback(() => {
    if (simulatorPreview) {
      setInvite(previewInvite);
      return;
    }
    void api
      .previewTeamInvite(code)
      .then((result) => {
        setInvite(result);
        setFailure(null);
      })
      .catch((cause: unknown) =>
        setFailure(
          cause instanceof ApiError && (cause.status === 404 || cause.status === 410)
            ? {
                kind: "unavailable",
                message:
                  "This invite has expired or was already used. Ask your teammate for a new link.",
              }
            : isNetworkError(cause)
              ? { kind: "network" }
              : {
                  kind: "other",
                  message: cause instanceof Error ? cause.message : undefined,
                },
        ),
      );
  }, [code]);

  useEffect(() => {
    if (!signedOut) load();
  }, [load, signedOut]);

  if (signedOut) return <Redirect href="/" />;

  /** Apps shows and highlights the team. */
  const showTeamApps = (teamId: string) => {
    void refreshDirectory().catch(() => {});
    router.dismissTo({ pathname: "/apps", params: { team: teamId } });
  };

  const join = async () => {
    if (joining || !invite) return;
    setJoining(true);
    setJoinError(null);
    setSeatLimit(false);
    try {
      const result: Pick<TeamJoinResponse, "joined"> & { team: { id: string; name: string } } =
        simulatorPreview
          ? { joined: true, team: { id: PREVIEW_TEAM_ID, name: invite.teamName } }
          : await api.acceptTeamInvite(code);
      if (!result.joined) {
        // The server leaves the invite unused when you're already a member.
        // Said in the sheet, not in an alert: leaving the sheet from an
        // alert's button while the alert is still going away froze both on
        // screen (checked in the simulator).
        setAlreadyMember(result.team);
        return;
      }
      haptic.success();
      showTeamApps(result.team.id);
    } catch (cause) {
      haptic.error();
      if (isSeatLimitError(cause)) setSeatLimit(true);
      else setJoinError(cause instanceof Error ? cause.message : "Couldn’t join this team.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          accessibilityLabel="Close"
          icon="xmark"
          onPress={() => closeSheet("/apps")}
        />
      </Stack.Toolbar>
      <List reading>
        {!invite ? (
          failure?.kind === "unavailable" ? (
            <EmptyState message={failure.message} symbol="link" title="Invite Unavailable" />
          ) : failure ? (
            <ErrorState
              network={failure.kind === "network"}
              onRetry={() => {
                setFailure(null);
                load();
              }}
              title="Couldn’t Load Invite"
            />
          ) : (
            <LoadingState />
          )
        ) : (
          <>
            <View style={styles.hero}>
              <Avatar name={invite.teamName} size={AVATAR} />
              <Text accessibilityRole="header" align="center" variant="title1">
                {`Join ${invite.teamName} on Hark`}
              </Text>
              <Text align="center" color="secondaryLabel" variant="body">
                {`${invite.invitedBy} invited you. You’ll see ${invite.teamName}’s apps in Hark and can be added to its on-call rotations.`}
              </Text>
            </View>
            <Section
              footer="Each team app still asks before signing you in, and you choose what it sees."
              title="Details"
            >
              <LabeledRow label="Team" value={invite.teamName} />
              <LabeledRow label="Invited By" value={invite.invitedBy} />
              <LabeledRow label="Role" value={roleLabel(invite.role)} />
              <LabeledRow label="Members" value={memberCountLabel(invite.memberCount)} />
            </Section>
            {alreadyMember ? (
              <Section>
                <Row
                  subtitle="Nothing changed, and the invite still works for someone else."
                  symbol="checkmark.circle.fill"
                  symbolColor="accent"
                  title={`You’re already on ${alreadyMember.name}`}
                />
              </Section>
            ) : null}
            {seatLimit ? <SeatLimitNotice owner={false} teamName={invite.teamName} /> : null}
            {joinError ? (
              <Text
                accessibilityLiveRegion="polite"
                color="danger"
                style={styles.error}
                variant="footnote"
              >
                {joinError}
              </Text>
            ) : null}
          </>
        )}
      </List>
      {invite ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.Spacer />
          {alreadyMember ? (
            <Stack.Toolbar.Button
              accessibilityHint={`Shows ${alreadyMember.name}’s apps`}
              onPress={() => showTeamApps(alreadyMember.id)}
              tintColor={palette.accent}
              variant="prominent"
            >
              Show Apps
            </Stack.Toolbar.Button>
          ) : (
            <Stack.Toolbar.Button
              accessibilityHint={`Adds you to ${invite.teamName}`}
              disabled={joining}
              onPress={() => void join()}
              tintColor={palette.accent}
              variant="prominent"
            >
              {joining ? "Joining…" : `Join ${invite.teamName}`}
            </Stack.Toolbar.Button>
          )}
          <Stack.Toolbar.Spacer />
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    gap: space.s,
    marginTop: space.l,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
  error: {
    marginTop: space.s,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
});
