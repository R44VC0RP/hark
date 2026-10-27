import type { OncallPageDto } from "@hark/contracts";
import * as Device from "expo-device";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIcon } from "../../src/components/app-icon";
import {
  MetaRow,
  PrimaryButton,
  ScreenHeader,
  SecondaryButton,
  SectionLabel,
  ui,
} from "../../src/components/screen-parts";
import { ApiError, api } from "../../src/lib/api";
import { useSession } from "../../src/lib/auth";
import { openTopLevelDestination } from "../../src/lib/inbox-body";
import { previewPages, previewViewer } from "../../src/lib/inbox-preview";
import { dismissNotificationsForPage } from "../../src/lib/notification-withdrawals";
import {
  escalationLabel,
  onPageClaimed,
  pageStatusLabel,
  timeAgo,
  timelineLabel,
} from "../../src/lib/teams";
import { colors, fonts, tightTracking } from "../../src/lib/theme";

type Busy = "acknowledge" | "escalate" | "resolve" | null;

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Please try again.";
}

export default function PageDetailScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; intent?: string }>();
  const id = String(params.id);
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const [page, setPage] = useState<OncallPageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const intentHandled = useRef(false);

  const load = useCallback(async (): Promise<OncallPageDto | null> => {
    if (simulatorPreview) {
      const preview = previewPages.find((item) => item.id === id) ?? previewPages[0] ?? null;
      setPage((current) => current ?? preview);
      return preview;
    }
    try {
      const result = await api.getPage(id);
      setPage(result.page);
      setError(null);
      return result.page;
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? "This page was deleted or you’re no longer on its team."
          : errorText(cause),
      );
      return null;
    }
  }, [id, simulatorPreview]);

  useEffect(() => {
    void load();
  }, [load]);

  // Someone else claimed it: show who, without waiting for a pull to refresh.
  useEffect(
    () =>
      onPageClaimed((pageId) => {
        if (pageId === id) void load();
      }),
    [id, load],
  );

  const apply = (next: OncallPageDto) => {
    setPage(next);
    if (next.status !== "triggered") void dismissNotificationsForPage(next.id).catch(() => {});
  };

  const acknowledge = async () => {
    if (!page || busy) return;
    setBusy("acknowledge");
    try {
      if (simulatorPreview) {
        const viewer = { ...previewViewer, image: null };
        apply({
          ...page,
          status: "acknowledged",
          acknowledgedBy: viewer,
          acknowledgedAt: new Date().toISOString(),
          nextEscalationAt: null,
        });
      } else {
        apply((await api.acknowledgePage(page.id)).page);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const latest = await load();
        const who = latest?.acknowledgedBy?.name ?? latest?.resolvedBy?.name;
        Alert.alert(
          who ? `Already acknowledged by ${who}` : "Already acknowledged",
          "Someone else is on it. You can still escalate or resolve it from here.",
        );
      } else {
        Alert.alert("Couldn’t acknowledge", errorText(cause));
      }
    } finally {
      setBusy(null);
    }
  };

  const escalate = useCallback(
    (current: OncallPageDto) => {
      Alert.alert(
        "Escalate this page?",
        "Hark notifies the next step in the escalation policy right away.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Escalate",
            onPress: () => {
              setBusy("escalate");
              void (async () => {
                try {
                  if (simulatorPreview) {
                    setPage({ ...current, escalationStep: current.escalationStep + 1 });
                  } else {
                    setPage((await api.escalatePage(current.id)).page);
                  }
                } catch (cause) {
                  Alert.alert("Couldn’t escalate", errorText(cause));
                } finally {
                  setBusy(null);
                }
              })();
            },
          },
        ],
      );
    },
    [simulatorPreview],
  );

  // The Escalate notification action lands here and asks once.
  useEffect(() => {
    if (params.intent !== "escalate" || intentHandled.current || !page) return;
    intentHandled.current = true;
    if (page.status !== "resolved") escalate(page);
  }, [escalate, page, params.intent]);

  const resolve = () => {
    if (!page || busy) return;
    Alert.prompt(
      "Resolve page",
      "Add an optional note for the team.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Resolve",
          onPress: (note?: string) => {
            setBusy("resolve");
            void (async () => {
              try {
                if (simulatorPreview) {
                  apply({
                    ...page,
                    status: "resolved",
                    resolvedBy: { ...previewViewer, image: null },
                    resolvedAt: new Date().toISOString(),
                    nextEscalationAt: null,
                  });
                } else {
                  apply((await api.resolvePage(page.id, note?.trim() || undefined)).page);
                }
              } catch (cause) {
                Alert.alert("Couldn’t resolve", errorText(cause));
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
      "plain-text",
    );
  };

  if (!isPending && !session && !simulatorPreview) return <Redirect href="/" />;

  const open = page?.status === "triggered";
  const resolved = page?.status === "resolved";

  return (
    <SafeAreaView edges={["top", "bottom"]} style={ui.container}>
      <StatusBar style="dark" />
      <ScreenHeader />
      {!page ? (
        error ? (
          <Text style={[ui.message, { paddingHorizontal: 24 }]}>{error}</Text>
        ) : (
          <ActivityIndicator color={colors.accent} style={ui.loading} />
        )
      ) : (
        <>
          <ScrollView contentContainerStyle={ui.scroll}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusPill,
                  open ? styles.statusOpen : resolved ? styles.statusResolved : styles.statusAck,
                ]}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: open
                        ? colors.danger
                        : resolved
                          ? colors.soft
                          : colors.accent,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    { color: open ? colors.danger : resolved ? colors.muted : colors.accent },
                  ]}
                >
                  {pageStatusLabel(page)}
                </Text>
              </View>
              <Text style={ui.rowTrailing}>
                {page.groupName} · {timeAgo(page.createdAt)}
              </Text>
            </View>
            <Text selectable style={[ui.title, { marginTop: 14 }]}>
              {page.title}
            </Text>
            {page.body ? (
              <Text selectable style={[ui.body, { marginTop: 10 }]}>
                {page.body}
              </Text>
            ) : null}

            <View style={ui.metaBlock}>
              <MetaRow label="Group" value={page.groupName} />
              <MetaRow label="From" value={page.source} />
              <MetaRow
                label="Raised"
                value={new Date(page.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              />
              {page.repeatCount > 0 ? (
                <MetaRow label="Repeats" value={`Fired ${page.repeatCount + 1} times`} />
              ) : null}
              <MetaRow
                label="Notified"
                value={
                  page.notified.length > 0
                    ? page.notified.map((person) => person.name).join(", ")
                    : "Nobody yet"
                }
              />
              <MetaRow label="Status" value={escalationLabel(page)} />
            </View>

            {page.app ? (
              <View style={styles.appRow}>
                <AppIcon iconUrl={page.app.iconUrl} name={page.app.name} size={40} />
                <View style={ui.rowCopy}>
                  <Text style={ui.rowLabel}>{page.app.name}</Text>
                  <Text numberOfLines={1} style={ui.rowValue}>
                    {page.url ?? page.app.origin}
                  </Text>
                </View>
                <SecondaryButton
                  accessibilityHint={`Opens ${page.app.name} signed in with Hark`}
                  label="Open app"
                  onPress={() => {
                    if (!page.app) return;
                    router.push({
                      pathname: "/web/[id]",
                      params: { id: page.app.id, ...(page.url ? { url: page.url } : {}) },
                    });
                  }}
                />
              </View>
            ) : page.url ? (
              <View style={{ marginTop: 16 }}>
                <SecondaryButton
                  accessibilityHint="Opens the link from this page"
                  label="Open link ↗"
                  onPress={() => {
                    if (page.url) void openTopLevelDestination(page.url);
                  }}
                />
              </View>
            ) : null}

            {page.timeline && page.timeline.length > 0 ? (
              <View style={{ marginTop: 8 }}>
                <SectionLabel>Timeline</SectionLabel>
                {page.timeline.map((event, index) => (
                  <View
                    accessible
                    key={`${event.at}-${event.kind}-${event.people.map((person) => person.userId).join(",")}`}
                    style={[ui.row, index === (page.timeline?.length ?? 0) - 1 && ui.lastRow]}
                  >
                    <View
                      style={[
                        styles.timelineDot,
                        event.kind === "acknowledged" && { backgroundColor: colors.accent },
                        event.kind === "paged" && { backgroundColor: colors.danger },
                      ]}
                    />
                    <Text style={[ui.rowValue, { flex: 1 }]}>{timelineLabel(event)}</Text>
                    <Text style={ui.rowTrailing}>
                      {new Date(event.at).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {page.ringing && page.ringing.length > 0 ? (
              <Text style={[ui.muted, { marginTop: 8 }]}>
                Ringing {page.ringing.map((ring) => ring.person.name).join(", ")} until someone
                acknowledges.
              </Text>
            ) : null}
          </ScrollView>

          {resolved ? null : (
            <View style={styles.actions}>
              {open ? (
                <PrimaryButton
                  accessibilityHint="Tells the team you’re on it and stops escalation"
                  busy={busy === "acknowledge"}
                  disabled={busy !== null && busy !== "acknowledge"}
                  label="Acknowledge"
                  onPress={() => void acknowledge()}
                />
              ) : null}
              <View style={styles.secondaryActions}>
                <View style={{ flex: 1 }}>
                  <SecondaryButton
                    accessibilityHint="Notifies the next responder now"
                    disabled={busy !== null}
                    label={busy === "escalate" ? "Escalating…" : "Escalate"}
                    onPress={() => escalate(page)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <SecondaryButton
                    accessibilityHint="Closes the page for everyone"
                    disabled={busy !== null}
                    label={busy === "resolve" ? "Resolving…" : "Resolve"}
                    onPress={resolve}
                  />
                </View>
              </View>
            </View>
          )}
          {resolved ? (
            <View style={[styles.actions, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
              <SymbolView name="checkmark.circle.fill" size={16} tintColor={colors.accent} />
              <Text style={ui.muted}>{escalationLabel(page)}</Text>
            </View>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 4,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusOpen: {
    backgroundColor: "#FBEAE7",
  },
  statusAck: {
    backgroundColor: colors.accentSoft,
  },
  statusResolved: {
    backgroundColor: "#F2F1ED",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  actions: {
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
  timelineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.soft,
  },
  secondaryActions: {
    flexDirection: "row",
    gap: 10,
  },
});
