import type {
  InboxInteractionDto,
  InboxLiveActivityDto,
  InboxProjectSummaryDto,
} from "@hark/contracts";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import { projectNameFor } from "../../../src/components/inbox/format";
import { LiveActivityRow } from "../../../src/components/inbox/live-activity-row";
import { ProjectRow } from "../../../src/components/inbox/project-row";
import { type RequestAction, RequestRow } from "../../../src/components/inbox/request-row";
import { ApiError, api } from "../../../src/lib/api";
import { publishInboxCounts } from "../../../src/lib/app-directory";
import { useSession } from "../../../src/lib/auth";
import { haptic } from "../../../src/lib/haptics";
import {
  markInteractionHandled,
  rememberInteraction,
  useHandledInteractionIds,
} from "../../../src/lib/inbox-cache";
import { previewActive, previewPending, previewProjects } from "../../../src/lib/inbox-preview";
import { createFocusRefreshPolicy, createRefreshSequence } from "../../../src/lib/inbox-refresh";
import { submitInteractionResponse } from "../../../src/lib/interactions";
import { TabRootToolbar } from "../../../src/ui/account-button";
import { EmptyState, ErrorState, isNetworkError, LoadingState } from "../../../src/ui/empty-state";
import { List, Row, Section } from "../../../src/ui/list";
import { animateListChange } from "../../../src/ui/motion";

const simulatorPreview = __DEV__ && !Device.isDevice;
/** The Inbox polls while it is mounted (the tabs keep it mounted). */
const POLL_MS = 15_000;
/** Relative times ("2m", "13 min left") move on once a minute. */
const TICK_MS = 60_000;

interface Summary {
  pending: InboxInteractionDto[];
  active: InboxLiveActivityDto[];
  /** Empty on servers without the project inbox (legacy layout). */
  projects: InboxProjectSummaryDto[];
}

type LoadFailure = "network" | "other";

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
  const ready = Boolean(session || simulatorPreview);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const handled = useHandledInteractionIds();
  const summaryJson = useRef("");
  const sending = useRef<string | null>(null);
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
      next = {
        pending: interactionResult.interactions,
        active: activityResult.activities,
        projects: projectResult?.projects ?? [],
      };
      totalUnread = projectResult?.totalUnread ?? 0;
      // Badge counts pending requests plus unread notifications; the server
      // never sends badge values itself.
      void Notifications.setBadgeCountAsync(next.pending.length + totalUnread).catch(() => {});
    }
    publishInboxCounts({ unread: totalUnread, waiting: next.pending.length });
    setLoadFailure(null);
    // Polling only re-renders when something changed.
    const json = JSON.stringify(next);
    if (json !== summaryJson.current) {
      summaryJson.current = json;
      setSummary(next);
    }
  }, [refreshSequence]);

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
    });
    return () => {
      clearInterval(timer);
      received.remove();
      appState.remove();
    };
  }, [load, ready, refresh]);

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

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch (error) {
      // Keep showing the last data; only an empty screen shows the failure.
      if (!summaryJson.current) setLoadFailure(isNetworkError(error) ? "network" : "other");
    } finally {
      setRefreshing(false);
    }
  };

  const respond = useCallback(
    async (item: InboxInteractionDto, action: RequestAction) => {
      if (sending.current) return;
      sending.current = item.id;
      setSendingId(item.id);
      try {
        if (!simulatorPreview) {
          await submitInteractionResponse(item.id, { action, actionDigest: item.actionDigest });
        }
        haptic.success();
        animateListChange();
        markInteractionHandled(item.id);
        void refresh().catch(() => {});
      } catch (error) {
        haptic.error();
        Alert.alert(
          "Couldn't Send Response",
          error instanceof Error ? error.message : "Check your connection, then try again.",
        );
      } finally {
        sending.current = null;
        setSendingId(null);
      }
    },
    [refresh],
  );

  const reply = useCallback(
    (item: InboxInteractionDto, projectName: string | null) => {
      rememberInteraction(item, projectName);
      router.push({ pathname: "/reply/[id]", params: { id: item.id } });
    },
    [router],
  );

  const projects = summary?.projects ?? [];
  const active = summary?.active ?? [];
  const pending = useMemo(
    () =>
      (summary?.pending ?? [])
        .filter((item) => !handled.has(item.id))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [handled, summary],
  );
  const empty = pending.length === 0 && active.length === 0 && projects.length === 0;

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
              title="Couldn't Load Inbox"
            />
          ) : (
            <LoadingState />
          )
        ) : (
          <>
            {pending.length > 0 ? (
              <Section detail={String(pending.length)} prominent title="Needs You">
                {pending.map((item) => (
                  <RequestRow
                    busy={sendingId !== null}
                    item={item}
                    key={item.id}
                    now={now}
                    onRespond={respond}
                    onReply={reply}
                    projectName={projectNameFor(item, projects)}
                    sending={sendingId === item.id}
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
                message="Requests, progress and notifications from your agents and scripts show up here."
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
