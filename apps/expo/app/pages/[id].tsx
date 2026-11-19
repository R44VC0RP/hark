import type { OncallPageDto, OncallPageEventDto } from "@hark/contracts";
import * as Device from "expo-device";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { AppIcon } from "../../src/components/app-icon";
import { closeSheet } from "../../src/components/teams/close-sheet";
import { LeadingDot } from "../../src/components/teams/page-row";
import { PageStatusPill } from "../../src/components/teams/page-status";
import { ApiError, api } from "../../src/lib/api";
import { publishDirectory, refreshDirectory, useDirectory } from "../../src/lib/app-directory";
import { useSession } from "../../src/lib/auth";
import { haptic } from "../../src/lib/haptics";
import { openTopLevelDestination } from "../../src/lib/inbox-body";
import { previewPages, previewViewer } from "../../src/lib/inbox-preview";
import { leaveSheetThenPush } from "../../src/lib/navigation";
import { dismissNotificationsForPage } from "../../src/lib/notification-withdrawals";
import {
  escalationLabel,
  formatHandoff,
  onPageClaimed,
  pageStatusLabel,
  timeAgo,
  timelineLabel,
} from "../../src/lib/teams";
import { spoken } from "../../src/ui/a11y";
import { Button } from "../../src/ui/button";
import { EmptyState, ErrorState, isNetworkError, LoadingState } from "../../src/ui/empty-state";
import { ActionRow, Cell, LabeledRow, List, Row, Section, useStackedRows } from "../../src/ui/list";
import { Text } from "../../src/ui/text";
import { type ColorName, metrics, palette, space } from "../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;
/** "next in 4 min" and "12 min ago" move on while the page is open. */
const TICK_MS = 30_000;
const APP_ICON = 40;

type Busy = "acknowledge" | "escalate" | "resolve" | null;
type LoadFailure = "missing" | "network" | "other";

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Check your connection, then try again.";
}

function failed(title: string, cause: unknown): void {
  haptic.error();
  Alert.alert(title, errorText(cause));
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const TIMELINE_DOT: Record<OncallPageEventDto["kind"], ColorName> = {
  paged: "danger",
  acknowledged: "accent",
  resolved: "placeholder",
};

/**
 * A page (DESIGN.md 5.18), the most urgent thing in Hark: someone is being
 * paged. A form sheet with the status, what happened and who was notified,
 * and a native bottom toolbar whose prominent item is the next step:
 * Acknowledge while it's open, Resolve once someone is on it. Every change
 * goes straight into the app directory, so the Teams badge and the pages
 * accessory update the moment the server answers.
 */
export default function PageSheet() {
  const { data: session, isPending } = useSession();
  const stacked = useStackedRows();
  const directory = useDirectory();
  const params = useLocalSearchParams<{ id: string; intent?: string }>();
  const id = String(params.id);
  const [page, setPage] = useState<OncallPageDto | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [now, setNow] = useState(() => Date.now());
  const intentHandled = useRef(false);
  const directoryRef = useRef(directory);

  useEffect(() => {
    directoryRef.current = directory;
  }, [directory]);

  const load = useCallback(async (): Promise<OncallPageDto | null> => {
    if (simulatorPreview) {
      const preview = previewPages.find((item) => item.id === id) ?? previewPages[0] ?? null;
      setPage((current) => current ?? preview);
      return preview;
    }
    try {
      const result = await api.getPage(id);
      setPage(result.page);
      setFailure(null);
      return result.page;
    } catch (cause) {
      setFailure(
        cause instanceof ApiError && cause.status === 404
          ? "missing"
          : isNetworkError(cause)
            ? "network"
            : "other",
      );
      return null;
    }
  }, [id]);

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

  const triggered = page?.status === "triggered";
  const nextEscalationAt = triggered ? page?.nextEscalationAt : null;

  // While it rings, the escalation countdown and the age keep moving.
  useEffect(() => {
    if (!triggered) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [triggered]);

  // When the next escalation is due, fetch the page once to show who it reached.
  useEffect(() => {
    if (!nextEscalationAt) return;
    const delay = Math.max(0, Date.parse(nextEscalationAt) - Date.now()) + 3000;
    const timer = setTimeout(() => void load(), delay);
    return () => clearTimeout(timer);
  }, [load, nextEscalationAt]);

  /**
   * Shows a changed page here and in the app directory at once (Teams badge,
   * pages accessory, Open Pages), then reloads the directory from the server.
   */
  const apply = useCallback((next: OncallPageDto) => {
    setPage(next);
    setNow(Date.now());
    if (next.status !== "triggered") void dismissNotificationsForPage(next.id).catch(() => {});
    const snapshot = directoryRef.current;
    if (snapshot?.oncall) {
      publishDirectory({
        ...snapshot,
        oncall: {
          ...snapshot.oncall,
          pages: snapshot.oncall.pages.map((item) => (item.id === next.id ? next : item)),
        },
      });
    }
    void refreshDirectory().catch(() => {});
  }, []);

  /**
   * Someone else got there first (409): show the page as it is now and who
   * has it. The server only escalates pages nobody has acknowledged.
   */
  const alreadyHandled = useCallback(async () => {
    const latest = await load();
    if (latest) apply(latest);
    haptic.warning();
    if (latest?.status === "resolved") {
      const who = latest.resolvedBy?.name;
      Alert.alert(
        who ? `Already Resolved by ${who}` : "Already Resolved",
        "This page is closed for everyone.",
      );
      return;
    }
    const who = latest?.acknowledgedBy?.name;
    Alert.alert(
      who ? `Already Acknowledged by ${who}` : "Already Acknowledged",
      "Someone else is on it. You can still resolve it from here.",
    );
  }, [apply, load]);

  const acknowledge = async () => {
    if (!page || busy) return;
    setBusy("acknowledge");
    try {
      const next = simulatorPreview
        ? {
            ...page,
            status: "acknowledged" as const,
            acknowledgedBy: { ...previewViewer, image: null },
            acknowledgedAt: new Date().toISOString(),
            nextEscalationAt: null,
            ringing: [],
          }
        : (await api.acknowledgePage(page.id)).page;
      haptic.success();
      apply(next);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) await alreadyHandled();
      else failed("Couldn't Acknowledge", cause);
    } finally {
      setBusy(null);
    }
  };

  const escalate = useCallback(
    (current: OncallPageDto) => {
      Alert.alert(
        "Escalate This Page?",
        "Hark notifies the next step in the escalation policy right away.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Escalate",

            onPress: () => {
              setBusy("escalate");
              void (async () => {
                try {
                  const next = simulatorPreview
                    ? { ...current, escalationStep: current.escalationStep + 1 }
                    : (await api.escalatePage(current.id)).page;
                  haptic.success();
                  apply(next);
                } catch (cause) {
                  if (cause instanceof ApiError && cause.status === 409) await alreadyHandled();
                  else failed("Couldn't Escalate", cause);
                } finally {
                  setBusy(null);
                }
              })();
            },
          },
        ],
      );
    },
    [alreadyHandled, apply],
  );

  // The Escalate notification action lands here and asks once.
  useEffect(() => {
    if (params.intent !== "escalate" || intentHandled.current || !page) return;
    intentHandled.current = true;
    if (page.status === "triggered") escalate(page);
  }, [escalate, page, params.intent]);

  const resolve = () => {
    if (!page || busy) return;
    Alert.prompt(
      "Resolve Page",
      "Add an optional note for the team.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Resolve",

          onPress: (note?: string) => {
            setBusy("resolve");
            void (async () => {
              try {
                const next = simulatorPreview
                  ? {
                      ...page,
                      status: "resolved" as const,
                      resolvedBy: { ...previewViewer, image: null },
                      resolvedAt: new Date().toISOString(),
                      nextEscalationAt: null,
                      ringing: [],
                    }
                  : (await api.resolvePage(page.id, note?.trim() || undefined)).page;
                haptic.success();
                apply(next);
              } catch (cause) {
                if (cause instanceof ApiError && cause.status === 409) await alreadyHandled();
                else failed("Couldn't Resolve", cause);
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

  const resolved = page?.status === "resolved";
  const ringing = page?.ringing ?? [];
  const timeline = page?.timeline ?? [];

  return (
    <>
      <Stack.Screen options={{ title: page?.groupName ?? "" }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          accessibilityLabel="Close"
          icon="xmark"
          onPress={() => closeSheet("/teams")}
        />
      </Stack.Toolbar>
      <List reading>
        {!page ? (
          failure === "missing" ? (
            <EmptyState
              message="It was deleted or you're no longer on its team."
              symbol="bell.slash"
              title="Page Unavailable"
            />
          ) : failure ? (
            <ErrorState
              network={failure === "network"}
              onRetry={() => {
                setFailure(null);
                void load();
              }}
              title="Couldn't Load Page"
            />
          ) : (
            <LoadingState />
          )
        ) : (
          <>
            <View style={styles.hero}>
              <View
                accessibilityLabel={spoken(
                  pageStatusLabel(page),
                  page.groupName,
                  timeAgo(page.createdAt, now),
                )}
                accessible
                style={[styles.statusLine, stacked && styles.statusLineStacked]}
              >
                <PageStatusPill status={page.status} />
                {/* The group is the sheet's title, so the line only adds the age. */}
                <Text color="secondaryLabel" style={styles.flex} tabular variant="subheadline">
                  {timeAgo(page.createdAt, now)}
                </Text>
              </View>
              <Text accessibilityRole="header" selectable variant="title2">
                {page.title}
              </Text>
              {page.body ? (
                <Text selectable variant="body">
                  {page.body}
                </Text>
              ) : null}
            </View>

            {resolved ? (
              <Section>
                <Row
                  subtitle={page.resolvedAt ? dateTime(page.resolvedAt) : undefined}
                  symbol="checkmark.circle.fill"
                  symbolColor="accent"
                  title={escalationLabel(page, now)}
                />
              </Section>
            ) : null}

            <Section title="Details">
              <LabeledRow label="Group" value={page.groupName} />
              {page.urgency === "low" ? (
                <LabeledRow label="Urgency" value="Low · one alert, no escalation" />
              ) : null}
              <LabeledRow label="From" selectable value={page.source} />
              <LabeledRow label="Raised" value={dateTime(page.createdAt)} />
              {page.repeatCount > 0 ? (
                <LabeledRow label="Repeats" value={`Fired ${page.repeatCount + 1} times`} />
              ) : null}
              <LabeledRow
                label="Notified"
                value={
                  page.notified.length > 0
                    ? page.notified.map((person) => person.name).join(", ")
                    : "Nobody yet"
                }
              />
              <LabeledRow label="Status" value={escalationLabel(page, now)} />
            </Section>

            {page.app ? (
              <Section>
                <Cell
                  minHeight={APP_ICON + 2 * space.s}
                  separatorInset={metrics.rowPaddingHorizontal + APP_ICON + metrics.rowAccessoryGap}
                  style={stacked ? styles.appRowStacked : null}
                >
                  <View
                    accessibilityLabel={spoken(page.app.name, page.url ?? page.app.origin)}
                    accessible
                    style={styles.appIdentity}
                  >
                    <AppIcon iconUrl={page.app.iconUrl} name={page.app.name} size={APP_ICON} />
                    <View style={styles.flex}>
                      <Text variant="body" weight="600">
                        {page.app.name}
                      </Text>
                      <Text
                        color="secondaryLabel"
                        numberOfLines={stacked ? undefined : 1}
                        variant="footnote"
                      >
                        {page.url ?? page.app.origin}
                      </Text>
                    </View>
                  </View>
                  <Button
                    accessibilityHint={`Opens ${page.app.name} signed in with Hark`}
                    onPress={() => {
                      if (!page.app) return;
                      leaveSheetThenPush({
                        pathname: "/web/[id]",
                        params: { id: page.app.id, ...(page.url ? { url: page.url } : {}) },
                      });
                    }}
                    title="Open"
                    variant="bordered"
                  />
                </Cell>
              </Section>
            ) : page.url ? (
              <Section>
                <ActionRow
                  accessibilityHint="Opens the link from this page"
                  onPress={() => {
                    if (page.url) void openTopLevelDestination(page.url);
                  }}
                  symbol="arrow.up.right.square"
                  title="Open Link"
                />
              </Section>
            ) : null}

            {timeline.length > 0 || ringing.length > 0 ? (
              <Section
                footer={
                  ringing.length > 0
                    ? `Ringing ${ringing.map((ring) => ring.person.name).join(", ")} until someone acknowledges.`
                    : undefined
                }
                title="Timeline"
              >
                {timeline.map((event) => (
                  <TimelineRow
                    event={event}
                    key={`${event.at}-${event.kind}-${event.people.map((person) => person.userId).join(",")}`}
                    now={now}
                  />
                ))}
              </Section>
            ) : null}
          </>
        )}
      </List>
      {page && !resolved ? (
        <Stack.Toolbar placement="bottom">
          {/*
            Escalating needs an open page: the server refuses it once
            acknowledged (409), so acknowledged pages offer Resolve only.
            From xxxL text up the three labels no longer fit and UIKit folds
            the last item, the prominent one, into "…"; there Escalate and
            Resolve move into a More menu so the next step stays visible.
          */}
          {triggered && stacked ? (
            <Stack.Toolbar.Menu accessibilityLabel="More Actions" icon="ellipsis">
              <Stack.Toolbar.MenuAction disabled={busy !== null} onPress={() => escalate(page)}>
                Escalate…
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction disabled={busy !== null} onPress={resolve}>
                Resolve…
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          ) : null}
          {/*
            Labels stay the same while a request is out (the items are only
            disabled): a wider "Acknowledging…" no longer fit and UIKit
            folded the bar into "…" for a moment (seen frame by frame).
          */}
          {triggered && !stacked ? (
            <Stack.Toolbar.Button
              accessibilityHint="Notifies the next responder now"
              disabled={busy !== null}
              onPress={() => escalate(page)}
            >
              Escalate
            </Stack.Toolbar.Button>
          ) : null}
          {triggered && !stacked ? (
            <Stack.Toolbar.Button
              accessibilityHint="Closes the page for everyone"
              disabled={busy !== null}
              onPress={resolve}
            >
              Resolve
            </Stack.Toolbar.Button>
          ) : null}
          <Stack.Toolbar.Spacer />
          {triggered ? (
            <Stack.Toolbar.Button
              accessibilityHint="Tells the team you're on it and stops escalation"
              disabled={busy !== null}
              onPress={() => void acknowledge()}
              tintColor={palette.accent}
              variant="prominent"
            >
              Acknowledge
            </Stack.Toolbar.Button>
          ) : (
            <Stack.Toolbar.Button
              accessibilityHint="Closes the page for everyone"
              disabled={busy !== null}
              onPress={resolve}
              tintColor={palette.accent}
              variant="prominent"
            >
              Resolve
            </Stack.Toolbar.Button>
          )}
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

/** One line of the page's history: who was paged, claimed or resolved it, and when. */
function TimelineRow({ event, now }: { event: OncallPageEventDto; now: number }) {
  const stacked = useStackedRows();
  const label = timelineLabel(event);
  const time = formatHandoff(event.at, now);
  return (
    <Cell
      accessibilityLabel={spoken(label, time)}
      accessible
      separatorInset={metrics.rowPaddingHorizontal + 8 + metrics.rowAccessoryGap}
      style={styles.timelineRow}
    >
      <LeadingDot color={TIMELINE_DOT[event.kind]} size={8} />
      <View style={[styles.timelineCopy, stacked && styles.timelineStacked]}>
        <Text style={stacked ? null : styles.flex} variant="body">
          {label}
        </Text>
        <Text color="secondaryLabel" tabular variant="subheadline">
          {time}
        </Text>
      </View>
    </Cell>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: space.xs,
    marginTop: space.s,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    marginBottom: space.xxs,
  },
  statusLineStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  flex: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
  },
  appIdentity: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowAccessoryGap,
  },
  appRowStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  timelineRow: {
    alignItems: "flex-start",
  },
  timelineCopy: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: space.s,
  },
  timelineStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
  },
});
