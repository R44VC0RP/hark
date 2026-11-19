import type { AppDto, TeamDto } from "@hark/contracts";
import * as Device from "expo-device";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, findNodeHandle, StyleSheet, View } from "react-native";
import { AppIcon } from "../../src/components/app-icon";
import { useActionSheet } from "../../src/components/apps/action-sheet";
import { ApiError, api } from "../../src/lib/api";
import { refreshDirectory, useDirectory } from "../../src/lib/app-directory";
import { useSession } from "../../src/lib/auth";
import { haptic } from "../../src/lib/haptics";
import { previewApps, previewViewer } from "../../src/lib/inbox-preview";
import { leaveSheetThenPush } from "../../src/lib/navigation";
import { cacheApps, cachedApp } from "../../src/lib/web-apps";
import { spoken } from "../../src/ui/a11y";
import { Button } from "../../src/ui/button";
import { EmptyState, ErrorState, isNetworkError, LoadingState } from "../../src/ui/empty-state";
import { ActionRow, LabeledRow, List, Section, SwitchRow, useStackedRows } from "../../src/ui/list";
import { Text } from "../../src/ui/text";
import { metrics, space } from "../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;
const ICON_SIZE = 60;

type LoadFailure = "network" | "other" | "missing";

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : "Check your connection, then try again.";
}

/**
 * App Info (DESIGN.md 5.9): a form sheet from an app's long-press menu, the
 * web app's Hark menu or its iPad bar. Who added the app and when, what it
 * may know about you, and sharing, sign-in and removal. Teams come from the
 * shared directory, so the sheet makes one request: the app itself.
 */
export default function AppInfoSheet() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const appId = String(id);
  const router = useRouter();
  const stacked = useStackedRows();
  const { data: session } = useSession();
  const directory = useDirectory();
  const teams: TeamDto[] = directory?.teams ?? [];
  const viewerName = simulatorPreview ? previewViewer.name : session?.user.name;
  const [app, setApp] = useState<AppDto | null>(() => cachedApp(appId) ?? null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const shareRow = useRef<View>(null);
  const actionSheet = useActionSheet();

  const load = useCallback(() => {
    if (simulatorPreview) {
      const preview = cachedApp(appId) ?? previewApps.find((item) => item.id === appId);
      if (preview) setApp(preview);
      else setFailure("missing");
      return;
    }
    void api
      .getApp(appId)
      .then((result) => {
        cacheApps([result.app]);
        setApp(result.app);
        setFailure(null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 404) setFailure("missing");
        else setFailure(isNetworkError(cause) ? "network" : "other");
      });
  }, [appId]);

  useEffect(() => {
    load();
  }, [load]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.dismissTo("/apps");
  };

  const open = () => {
    // From the web app's own menu, "Open" just goes back to it.
    if (from === "web") close();
    else leaveSheetThenPush({ pathname: "/web/[id]", params: { id: appId } });
  };

  /** Keeps the Apps grid, shortcuts and the web app's cache in step. */
  const changed = (next: AppDto) => {
    cacheApps([next]);
    setApp(next);
    void refreshDirectory().catch(() => {});
  };

  const updateSharing = async (change: { shareName?: boolean; shareEmail?: boolean }) => {
    if (!app || saving) return;
    const previous = app;
    const optimistic = { ...app, ...change };
    setApp(optimistic);
    if (simulatorPreview) {
      cacheApps([optimistic]);
      return;
    }
    setSaving(true);
    try {
      const result = await api.updateAppSharing(app.id, change);
      cacheApps([result.app]);
      setApp(result.app);
    } catch (cause) {
      setApp(previous);
      haptic.error();
      Alert.alert("Couldn't Save", failureMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const stopSigningIn = () => {
    if (!app) return;
    Alert.alert(
      `Stop Signing In to ${app.name}?`,
      `Hark will stop sending passes to ${hostOf(app.origin)}. You’ll be asked again the next time you open it.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop Signing In",
          style: "destructive",
          onPress: () => {
            if (simulatorPreview) {
              changed({ ...app, consentedAt: null });
              return;
            }
            void api
              .revokeApp(app.id)
              .then((result) => {
                haptic.success();
                changed(result.app);
              })
              .catch((cause: unknown) => {
                haptic.error();
                Alert.alert("Couldn't Stop Signing In", failureMessage(cause));
              });
          },
        },
      ],
    );
  };

  const moveTo = (team: TeamDto | null) => {
    if (!app || moving) return;
    const run = () => {
      if (simulatorPreview) {
        changed({
          ...app,
          team: team ? { id: team.id, name: team.name } : null,
          addedBy: viewerName ?? null,
        });
        return;
      }
      setMoving(true);
      void api
        .shareApp(app.id, { teamId: team?.id ?? null, ...(team ? { notify: true } : {}) })
        .then((result) => {
          haptic.success();
          changed(result.app);
        })
        .catch((cause: unknown) => {
          haptic.error();
          Alert.alert(team ? "Couldn't Share App" : "Couldn't Move App", failureMessage(cause));
        })
        .finally(() => setMoving(false));
    };
    if (team) {
      Alert.alert(
        `Share ${app.name} with ${team.name}?`,
        `Everyone on ${team.name} sees it on their home screen and gets a notification. Each person approves sign-in and chooses what to share for themselves.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Share", onPress: run },
        ],
      );
    } else {
      Alert.alert(
        `Move ${app.name} to Your Apps?`,
        `It disappears for everyone else on ${app.team?.name ?? "the team"}.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Move", style: "destructive", onPress: run },
        ],
      );
    }
  };

  const chooseTeam = () => {
    const [onlyTeam] = teams;
    if (teams.length === 1 && onlyTeam) return moveTo(onlyTeam);
    const anchor = shareRow.current ? findNodeHandle(shareRow.current) : null;
    actionSheet.show(
      {
        title: "Share with a Team",
        options: [...teams.map((team) => team.name), "Cancel"],
        cancelButtonIndex: teams.length,
        ...(anchor ? { anchor } : {}),
      },
      (index) => {
        const team = teams[index];
        if (team) moveTo(team);
      },
    );
  };

  const remove = () => {
    if (!app) return;
    Alert.alert(
      app.team ? `Remove ${app.name} from ${app.team.name}?` : `Remove ${app.name}?`,
      app.team
        ? `It disappears for everyone on ${app.team.name}. Agents can add it again later.`
        : "It disappears from Hark on every device. Agents can add it again later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            if (simulatorPreview) {
              router.dismissTo("/apps");
              return;
            }
            void api
              .removeApp(app.id)
              .then(() => {
                haptic.success();
                void refreshDirectory().catch(() => {});
                router.dismissTo("/apps");
              })
              .catch((cause: unknown) => {
                haptic.error();
                Alert.alert("Couldn't Remove App", failureMessage(cause));
              });
          },
        },
      ],
    );
  };

  const canShare = Boolean(app && !app.team && teams.length > 0);
  const canMoveBack = Boolean(app?.team && viewerName && app.addedBy === viewerName);
  const consented = Boolean(app?.consentedAt);

  return (
    <>
      <Stack.Screen options={{ title: "App Info" }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button accessibilityLabel="Close" icon="xmark" onPress={close} />
      </Stack.Toolbar>
      <List>
        {!app ? (
          failure === "missing" ? (
            <EmptyState
              message="It was removed, or you no longer have access to it."
              symbol="square.grid.2x2"
              title="App Unavailable"
            />
          ) : failure ? (
            <ErrorState
              network={failure === "network"}
              onRetry={() => {
                setFailure(null);
                load();
              }}
              title="Couldn't Load App"
            />
          ) : (
            <LoadingState />
          )
        ) : (
          <>
            <View style={[styles.identity, stacked && styles.identityStacked]}>
              <View
                accessibilityLabel={spoken(app.name, hostOf(app.origin))}
                accessibilityRole="header"
                accessible
                style={styles.identityMain}
              >
                <AppIcon iconUrl={app.iconUrl} name={app.name} size={ICON_SIZE} />
                <View style={styles.identityCopy}>
                  <Text variant="title3">{app.name}</Text>
                  <Text color="secondaryLabel" variant="subheadline">
                    {hostOf(app.origin)}
                  </Text>
                </View>
              </View>
              <Button
                accessibilityHint="Opens the app, signed in with Hark"
                accessibilityLabel={`Open ${app.name}`}
                onPress={open}
                style={stacked ? styles.openStacked : null}
                title="Open"
                variant="prominent"
              />
            </View>

            <Section title="Details">
              {app.team ? <LabeledRow label="Team" value={app.team.name} /> : null}
              <LabeledRow label="Added By" value={app.addedBy ?? app.createdBy ?? "Unknown"} />
              {app.addedBy && app.createdBy && app.addedBy !== app.createdBy ? (
                <LabeledRow label="Via" value={app.createdBy} />
              ) : null}
              {app.projectName ? <LabeledRow label="Project" value={app.projectName} /> : null}
              <LabeledRow label="Added" value={formatDate(app.createdAt)} />
              <LabeledRow label="Last Opened" value={formatDate(app.lastOpenedAt)} />
              <LabeledRow
                label="Sign-In"
                value={consented ? "Signed in with Hark" : "Asks before signing in"}
              />
            </Section>

            <Section
              footer={`Hark gives ${app.name} a private ID made just for this app. Name and email are shared only when they are on.`}
              title={`Shared with ${app.name}`}
            >
              <LabeledRow label="Hark ID" value="Always" />
              <SwitchRow
                onValueChange={(value) => void updateSharing({ shareName: value })}
                title="Name"
                value={app.shareName}
              />
              <SwitchRow
                onValueChange={(value) => void updateSharing({ shareEmail: value })}
                title="Email"
                value={app.shareEmail}
              />
            </Section>

            {canShare || canMoveBack || consented ? (
              <Section>
                {canShare ? (
                  <ActionRow
                    accessibilityHint="Choose a team to add this app to"
                    accessibilityState={{ busy: moving }}
                    disabled={moving}
                    onPress={chooseTeam}
                    ref={shareRow}
                    title={moving ? "Sharing…" : "Share with a Team…"}
                  />
                ) : null}
                {canMoveBack && app.team ? (
                  <ActionRow
                    accessibilityHint={`Removes it from ${app.team.name} and keeps it for you`}
                    accessibilityState={{ busy: moving }}
                    disabled={moving}
                    onPress={() => moveTo(null)}
                    title={moving ? "Moving…" : "Move to Your Apps"}
                  />
                ) : null}
                {consented ? (
                  <ActionRow destructive onPress={stopSigningIn} title="Stop Signing In" />
                ) : null}
              </Section>
            ) : null}

            <Section>
              <ActionRow
                destructive
                onPress={remove}
                title={app.team ? `Remove from ${app.team.name}` : "Remove App"}
              />
            </Section>
          </>
        )}
      </List>
      {actionSheet.shield}
    </>
  );
}

const styles = StyleSheet.create({
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowAccessoryGap,
    marginTop: space.l,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
  identityStacked: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  identityMain: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowAccessoryGap + space.xxs,
  },
  identityCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  openStacked: {
    alignSelf: "flex-start",
  },
});
