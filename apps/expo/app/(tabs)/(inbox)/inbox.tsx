import {
  HARK_APPROVE_ACTION_ID,
  HARK_DENY_ACTION_ID,
  HARK_NO_ACTION_ID,
  HARK_REPLY_ACTION_ID,
  HARK_YES_ACTION_ID,
  type InboxInteractionDto,
  type InboxLiveActivityDto,
  type InboxProjectSummaryDto,
} from "@hark/contracts";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import {
  type NativeStackNavigationProp,
  useFocusEffect,
  useNavigation,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Linking } from "react-native";
import { ANSWER_LABELS, projectNameFor } from "../../../src/components/inbox/format";
import { LiveActivityRow } from "../../../src/components/inbox/live-activity-row";
import { ProjectRow } from "../../../src/components/inbox/project-row";
import { type RequestAction, RequestRow } from "../../../src/components/inbox/request-row";
import { ApiError, api } from "../../../src/lib/api";
import { publishInboxCounts } from "../../../src/lib/app-directory";
import { useSession } from "../../../src/lib/auth";
import { alertFailure, haptic } from "../../../src/lib/haptics";
import {
  answerFailure,
  clearSettledRequests,
  currentHandledIds,
  currentSettledRequests,
  markInteractionHandled,
  markInteractionQueued,
  outcomesOf,
  type RequestAnswer,
  type RequestOutcome,
  rememberInteraction,
  type SettledRequest,
  sendAnswer,
  settleRequests,
  showQueuedAnswers,
  useHandledInteractionIds,
  useSettledRequests,
} from "../../../src/lib/inbox-cache";
import { previewActive, previewPending, previewProjects } from "../../../src/lib/inbox-preview";
import { createFocusRefreshPolicy, createRefreshSequence } from "../../../src/lib/inbox-refresh";
import { TabRootToolbar } from "../../../src/ui/account-button";
import { EmptyState, ErrorState, isNetworkError, LoadingState } from "../../../src/ui/empty-state";
import { List, Row, Section } from "../../../src/ui/list";
import { animateListChange } from "../../../src/ui/motion";

const simulatorPreview = __DEV__ && !Device.isDevice;
/** The Inbox polls while it is mounted (the tabs keep it mounted). */
const POLL_MS = 15_000;
/** Relative times ("4 min ago", "13 min left") move on once a minute. */
const TICK_MS = 60_000;
/** Where a first-run Inbox points: how to send the first webhook or request. */
const DOCS_URL = "https://hark.fyi/docs";
/**
 * A request that arrives while the Inbox is on screen ignores taps on its
 * answers until it has faded in (300 ms) and been on screen long enough to
 * be seen: a tap that lands sooner was aimed at what used to be there.
 * (At 700 ms a tap hammered at the spot got through 0.65 s after the row
 * began to fade in.)
 */
const ARRIVAL_GUARD_MS = 1_000;
/** The notification actions that answer a request, as the Inbox words them. */
const PUSH_ANSWERS: Record<string, RequestAnswer> = {
  [HARK_APPROVE_ACTION_ID]: "approve",
  [HARK_DENY_ACTION_ID]: "deny",
  [HARK_YES_ACTION_ID]: "yes",
  [HARK_NO_ACTION_ID]: "no",
  [HARK_REPLY_ACTION_ID]: "reply",
};

interface Summary {
  pending: InboxInteractionDto[];
  active: InboxLiveActivityDto[];
  /** Empty on servers without the project inbox (legacy layout). */
  projects: InboxProjectSummaryDto[];
}

type LoadFailure = "network" | "other";

/** A Needs You row: an open request, or one that stopped waiting while on screen. */
interface RequestEntry {
  item: InboxInteractionDto;
  outcome: RequestOutcome | null;
}

/** Open requests plus the settled ones, each once, newest first (the order at rest). */
function requestEntries(
  pending: readonly InboxInteractionDto[],
  settled: ReadonlyMap<string, SettledRequest>,
  handled: ReadonlySet<string>,
): RequestEntry[] {
  return [
    ...pending
      .filter((item) => !handled.has(item.id) && !settled.has(item.id))
      .map((item) => ({ item, outcome: null })),
    ...[...settled.values()].map(({ interaction, outcome }) => ({ item: interaction, outcome })),
  ].sort((a, b) => Date.parse(b.item.createdAt) - Date.parse(a.item.createdAt));
}

/**
 * Inbox (DESIGN.md 5.3), the first tab and the reference screen: what needs
 * you (requests that expire), what is running (Live Activities), and what
 * arrived (projects), then History. `List` is the first child so the large
 * title, scroll-edge glass and tab-bar minimise work; the Account button is
 * the tab root's only toolbar item.
 */
export default function InboxScreen() {
  const { data: session } = useSession();
  const router = useRouter();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const ready = Boolean(session || simulatorPreview);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The requests whose answer is on its way: only their own buttons wait,
  // every other request stays answerable (R4: one hung answer disabled all).
  const [sendingIds, setSendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const handled = useHandledInteractionIds();
  const settled = useSettledRequests();
  // While the Inbox is in sight, Needs You keeps every row where it is
  // (I2-01): requests that stop waiting stay with what happened, and new
  // ones join the end. `order` pins that order; null is newest first.
  const [order, setOrder] = useState<readonly string[] | null>(null);
  // What the screen shows, for the refresh and notification callbacks:
  // written with each change of `summary` and `order` (answered and settled
  // requests come from their store, which is always current).
  const shown = useRef<{ summary: Summary | null; order: readonly string[] | null }>({
    summary: null,
    order: null,
  });
  // A push or another tab has fully covered the Inbox (`transitionEnd`),
  // until it is focused again. A sheet only blurs it: the rows stay in view.
  const covered = useRef(false);
  // The first refresh once the Inbox is back in sight (after a push,
  // another tab or the background) shows rest order: newest first, not
  // arrivals pinned at the end below the fold (R3-P2-1).
  const restNext = useRef(false);
  // A pull to refresh is a drag, not a tap: its result arrives in rest
  // order, in one animated change (R3V-06).
  const pulling = useRef(false);
  // When each request that arrived in sight appeared (ARRIVAL_GUARD_MS).
  const arrivedAt = useRef(new Map<string, number>());
  const arrivedJustNow = useCallback((id: string) => {
    const arrived = arrivedAt.current.get(id);
    return arrived !== undefined && Date.now() - arrived < ARRIVAL_GUARD_MS;
  }, []);
  /** Back to rest: settled rows go, and arrivals take their place by age. */
  const restOrder = useCallback(() => {
    arrivedAt.current.clear();
    clearSettledRequests();
    shown.current = { ...shown.current, order: null };
    setOrder(null);
  }, []);
  const summaryJson = useRef("");
  const sending = useRef(new Set<string>());
  // Older/self-hosted servers without /api/inbox keep the legacy layout.
  const projectInboxSupported = useRef(true);
  // Orders overlapping refreshes (timer, focus, push, pull to refresh) so a
  // slow stale response never overwrites fresher state or the badge.
  const refreshSequence = useRef(createRefreshSequence()).current;

  const refresh = useCallback(async () => {
    const token = refreshSequence.begin();
    let next: Summary;
    let totalUnread: number;
    if (simulatorPreview) {
      next = {
        pending: previewPending,
        active: previewActive,
        projects: previewProjects.projects,
      };
      totalUnread = previewProjects.totalUnread;
    } else {
      const [interactionResult, activityResult, projectResult] = await Promise.all([
        api.listPendingInteractions(),
        api.listActiveActivities(),
        projectInboxSupported.current
          ? api.listInboxProjects().catch((error: unknown) => {
              if (error instanceof ApiError && error.status === 404) {
                // The latch records a fact about the server, so it applies
                // even when a newer refresh supersedes this one.
                projectInboxSupported.current = false;
                return null;
              }
              throw error;
            })
          : Promise.resolve(null),
      ]);
      if (!refreshSequence.isCurrent(token)) return;
      // A request whose answer already waits in the retry queue (the app was
      // closed or killed while sending it) says so instead of offering its
      // buttons again (R4-02).
      await showQueuedAnswers(interactionResult.interactions);
      if (!refreshSequence.isCurrent(token)) return;
      next = {
        pending: interactionResult.interactions,
        active: activityResult.activities,
        projects: projectResult?.projects ?? [],
      };
      totalUnread = projectResult?.totalUnread ?? 0;
    }
    // Also sets the app icon badge (pending requests plus unread
    // notifications; the server never sends badge values itself).
    publishInboxCounts({ unread: totalUnread, waiting: next.pending.length });
    setLoadFailure(null);
    const visible = !covered.current && AppState.currentState === "active";
    const atRest = pulling.current || restNext.current;
    if (visible) restNext.current = false;
    // Polling only re-renders when something changed.
    const json = JSON.stringify(next);
    if (json === summaryJson.current) return;
    const before = shown.current;
    if (visible && atRest) {
      // Settled rows fade out and arrivals fade in at their place by age in
      // the same animated change as the new data, not in two commits that
      // swapped rows in one frame (R3V-06).
      animateListChange();
      restOrder();
    } else if (before.summary && visible) {
      // In sight, a request that left the open list (answered on another
      // device, expired, withdrawn) stays where it is and says so, like one
      // answered here; one that arrived joins the end of Needs You, so no
      // answer button already on screen moves under a finger.
      const open = new Set(next.pending.map((item) => item.id));
      const vanished = before.summary.pending.filter(
        (item) =>
          !open.has(item.id) &&
          !currentHandledIds().has(item.id) &&
          !currentSettledRequests().has(item.id),
      );
      const outcomes = vanished.length > 0 ? await outcomesOf(vanished, Date.now()) : [];
      if (!refreshSequence.isCurrent(token)) return;
      const current = shown.current;
      const known = new Set(current.summary?.pending.map((item) => item.id));
      const arrivals = next.pending
        .filter((item) => !known.has(item.id) && !currentHandledIds().has(item.id))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      if (arrivals.length > 0) {
        const base =
          current.order ??
          requestEntries(
            current.summary?.pending ?? [],
            currentSettledRequests(),
            currentHandledIds(),
          ).map((entry) => entry.item.id);
        const arrived = Date.now();
        for (const item of arrivals) arrivedAt.current.set(item.id, arrived);
        const placed = new Set(base);
        const nextOrder = [
          ...base,
          ...arrivals.filter((item) => !placed.has(item.id)).map((item) => item.id),
        ];
        shown.current = { ...shown.current, order: nextOrder };
        // The new row fades in; only what is below Needs You slides down.
        animateListChange();
        setOrder(nextOrder);
      }
      settleRequests(outcomes);
    }
    summaryJson.current = json;
    shown.current = { ...shown.current, summary: next };
    setSummary(next);
  }, [refreshSequence, restOrder]);

  const load = useCallback(() => {
    void refresh().catch((error: unknown) => {
      setLoadFailure(isNetworkError(error) ? "network" : "other");
    });
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    load();
    const quiet = () => void refresh().catch(() => {});
    const timer = setInterval(quiet, POLL_MS);
    const received = Notifications.addNotificationReceivedListener(quiet);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") quiet();
      else if (state === "background") {
        restOrder();
        restNext.current = true;
      }
    });
    return () => {
      clearInterval(timer);
      received.remove();
      appState.remove();
    };
  }, [load, ready, refresh, restOrder]);

  // Settled requests stay in place and leave, and arrivals take their place
  // by age, only while nobody can be tapping them: once a pushed screen or
  // another tab has fully covered the Inbox, in the background, or on pull
  // to refresh. A row that left under a finger let a tap answer the next
  // request.
  useEffect(() => {
    // Fires once the Inbox is fully covered: a push or another tab (checked).
    // A sheet only blurs it, and the rows stay in view behind the sheet.
    const unsubscribeEnd = navigation.addListener("transitionEnd", (event) => {
      if (!event.data.closing) return;
      covered.current = true;
      restNext.current = true;
      restOrder();
    });
    const unsubscribeFocus = navigation.addListener("focus", () => {
      covered.current = false;
    });
    return () => {
      unsubscribeEnd();
      unsubscribeFocus();
      clearSettledRequests();
    };
  }, [navigation, restOrder]);

  // A request answered from its notification while the Inbox shows it was
  // answered here: it settles in place with that answer (the root layout
  // sends it), not as an answer from another device on the next refresh.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const answer = PUSH_ANSWERS[response.actionIdentifier];
      const data = response.notification.request.content.data as { interactionId?: unknown };
      if (!answer || typeof data?.interactionId !== "string") return;
      if (answer === "reply" && !response.userText?.trim()) return;
      if (covered.current || AppState.currentState !== "active") return;
      const item = shown.current.summary?.pending.find((entry) => entry.id === data.interactionId);
      if (item) markInteractionHandled(item, answer);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Refresh when the Inbox regains focus (back from a project, a
  // notification or a sheet, where read state changes) instead of waiting for
  // the timer. The policy skips the mount focus, which the load above owns.
  const focusRefreshPolicy = useRef(createFocusRefreshPolicy()).current;
  const refreshRef = useRef(refresh);
  const readyRef = useRef(ready);
  useEffect(() => {
    refreshRef.current = refresh;
    readyRef.current = ready;
  }, [ready, refresh]);
  useFocusEffect(
    useCallback(() => {
      if (focusRefreshPolicy.onFocus(readyRef.current)) {
        void refreshRef.current().catch(() => {});
      }
      return () => focusRefreshPolicy.onBlur();
    }, [focusRefreshPolicy]),
  );

  // A pull whose data didn't change still clears settled rows: once the
  // refresh control has let go, they fade out and arrivals move to their
  // place by age. In the same commit as the control's end they left in one
  // frame (P2-02). A pull that brought new data did this already.
  const tidyAfterRefresh = useRef(false);
  useEffect(() => {
    if (refreshing || !tidyAfterRefresh.current) return;
    tidyAfterRefresh.current = false;
    if (currentSettledRequests().size === 0 && shown.current.order === null) return;
    animateListChange();
    restOrder();
  }, [refreshing, restOrder]);

  const onRefresh = async () => {
    setRefreshing(true);
    pulling.current = true;
    try {
      await refresh();
    } catch (error) {
      // Keep showing the last data; only an empty screen shows the failure.
      if (!summaryJson.current) setLoadFailure(isNetworkError(error) ? "network" : "other");
    } finally {
      pulling.current = false;
      tidyAfterRefresh.current = true;
      setRefreshing(false);
    }
  };

  const respond = useCallback(
    async (item: InboxInteractionDto, action: RequestAction) => {
      if (sending.current.has(item.id) || arrivedJustNow(item.id)) return;
      sending.current.add(item.id);
      setSendingIds(new Set(sending.current));
      try {
        const sent = simulatorPreview ? "sent" : await sendAnswer(item, { action });
        if (sent === "sent") {
          haptic.success();
          // No list animation: the row stays and shows the answer where its
          // buttons were, so nothing moves under the finger that tapped.
          markInteractionHandled(item, action);
          AccessibilityInfo.announceForAccessibility(ANSWER_LABELS[action]);
        } else if (sent === "offline" || sent === "slow") {
          // No response (no connection) or none in time (a hung
          // connection): the answer waits in the retry queue and goes out
          // when the connection works; the row says so, then shows what
          // really happened.
          haptic.warning();
          markInteractionQueued(item, action, sent);
          AccessibilityInfo.announceForAccessibility(
            `${ANSWER_LABELS[action]}, ${sent === "offline" ? "will send when you’re back online" : "will send when the connection responds"}`,
          );
        } else {
          // Already closed on the server (a stale tap after an answer on
          // another device): the row settles with what really happened,
          // never with the answer tapped here (R3-02).
          const [settledHere] = await outcomesOf([item], Date.now());
          haptic.warning();
          if (settledHere) {
            settleRequests([settledHere]);
            const { outcome } = settledHere;
            AccessibilityInfo.announceForAccessibility(
              outcome.kind === "answeredElsewhere"
                ? `${outcome.result}, answered on another device`
                : outcome.kind === "expired"
                  ? "Expired"
                  : "No longer waiting",
            );
          }
        }
        void refresh().catch(() => {});
      } catch (error) {
        // Not sent: the buttons come back (nothing settled) and it says so;
        // a request that changed shows its new version.
        alertFailure("Couldn’t Send Response", answerFailure(error));
        void refresh().catch(() => {});
      } finally {
        sending.current.delete(item.id);
        setSendingIds(new Set(sending.current));
      }
    },
    [arrivedJustNow, refresh],
  );

  const reply = useCallback(
    (item: InboxInteractionDto, projectName: string | null) => {
      if (arrivedJustNow(item.id)) return;
      rememberInteraction(item, projectName);
      router.push({ pathname: "/reply/[id]", params: { id: item.id } });
    },
    [arrivedJustNow, router],
  );

  const projects = summary?.projects ?? [];
  const active = summary?.active ?? [];
  // Open requests plus the settled ones, each in its own place: newest
  // first at rest, in the pinned order while the Inbox is in sight.
  const requests = useMemo(() => {
    const entries = requestEntries(summary?.pending ?? [], settled, handled);
    if (!order) return entries;
    const byId = new Map(entries.map((entry) => [entry.item.id, entry]));
    // One row per id, whatever the pinned order holds: two rows with one
    // key could let React reuse the wrong row's buttons.
    const pinned = new Set(order);
    return [
      ...[...pinned].flatMap((id) => byId.get(id) ?? []),
      ...entries.filter((entry) => !pinned.has(entry.item.id)),
    ];
  }, [handled, order, settled, summary]);
  const waiting = requests.filter((request) => request.outcome === null).length;
  // The count says how many still wait; with settled rows on screen it says
  // so in words, so "3" never sits over five rows (V2-02).
  const needsYouDetail =
    waiting === requests.length
      ? String(waiting)
      : waiting > 0
        ? `${waiting} waiting`
        : "None waiting";
  const empty = requests.length === 0 && active.length === 0 && projects.length === 0;

  return (
    <>
      <TabRootToolbar />
      <List onRefresh={summary || loadFailure ? onRefresh : undefined} refreshing={refreshing}>
        {summary === null ? (
          loadFailure ? (
            <ErrorState
              network={loadFailure === "network"}
              onRetry={() => {
                setLoadFailure(null);
                load();
              }}
              title="Couldn’t Load Inbox"
            />
          ) : (
            <LoadingState />
          )
        ) : (
          <>
            {requests.length > 0 ? (
              <Section detail={needsYouDetail} prominent title="Needs You">
                {requests.map(({ item, outcome }) => (
                  <RequestRow
                    busy={sendingIds.has(item.id)}
                    item={item}
                    key={item.id}
                    now={now}
                    outcome={outcome}
                    onRespond={respond}
                    onReply={reply}
                    projectName={projectNameFor(item, projects)}
                    sending={sendingIds.has(item.id)}
                  />
                ))}
              </Section>
            ) : null}
            {active.length > 0 ? (
              <Section prominent title="In Progress">
                {active.map((item) => (
                  <LiveActivityRow item={item} key={item.id} />
                ))}
              </Section>
            ) : null}
            {projects.length > 0 ? (
              <Section prominent title="Projects">
                {projects.map((item) => (
                  <ProjectRow item={item} key={item.projectId ?? "unfiled"} now={now} />
                ))}
              </Section>
            ) : null}
            {empty ? (
              <EmptyState
                actionTitle="How to Connect a Service"
                message="Requests, progress and notifications from your agents and scripts show up here."
                onAction={() => void Linking.openURL(DOCS_URL).catch(() => {})}
                symbol="tray"
                title="Your Inbox Is Empty"
              />
            ) : null}
            <Section>
              <Row
                accessibilityHint="Shows past notifications, Live Activities and responses"
                chevron
                onPress={() => router.push("/history")}
                symbol="clock.arrow.circlepath"
                title="History"
              />
            </Section>
          </>
        )}
      </List>
    </>
  );
}
