import type { InboxNotificationSummaryDto } from "@hark/contracts";
import * as Device from "expo-device";
import { Redirect, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import {
  NOTIFICATION_DOT_COLUMN,
  NOTIFICATION_DOT_GAP,
  NotificationRow,
} from "../../../../src/components/notification-row";
import { api } from "../../../../src/lib/api";
import { changeUnreadCount } from "../../../../src/lib/app-directory";
import { useSession } from "../../../../src/lib/auth";
import { haptic } from "../../../../src/lib/haptics";
import { openTopLevelDestination } from "../../../../src/lib/inbox-body";
import { previewNotifications, previewProjects } from "../../../../src/lib/inbox-preview";
import { openWebApp } from "../../../../src/lib/navigation";
import {
  canMarkAllRead,
  loadedUnreadCount,
  markLoadedItemsRead,
  normalizeReadThroughToken,
  projectSummaryUnread,
} from "../../../../src/lib/project-inbox";
import {
  EmptyState,
  ErrorState,
  isNetworkError,
  LoadingState,
} from "../../../../src/ui/empty-state";
import {
  FilterLine,
  PlainSeparator,
  useHorizontalSafeArea,
  useScreenMargin,
} from "../../../../src/ui/list";
import { colors, space } from "../../../../src/ui/tokens";

const PAGE_SIZE = 30;
const simulatorPreview = __DEV__ && !Device.isDevice;

type LoadFailure = "network" | "other";

/**
 * A project's notifications (DESIGN.md 5.6): a plain list like a Mail
 * mailbox, newest first, loading older pages as you scroll. A one-tap
 * Unread Only filter and a More menu with "Mark All as Read" replace the
 * chips and the unlabelled icon.
 */
export default function ProjectScreen() {
  const { data: session, isPending: sessionPending } = useSession();
  const params = useLocalSearchParams<{ project: string; name?: string }>();
  const projectParam = typeof params.project === "string" ? params.project : "unfiled";
  const title = typeof params.name === "string" && params.name ? params.name : "Notifications";
  const margin = useScreenMargin();
  const safeArea = useHorizontalSafeArea();

  const [items, setItems] = useState<InboxNotificationSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Authoritative unread count from the project summary API. It also covers
  // unread rows beyond the loaded page, so mark-all stays available for them.
  const [summaryUnread, setSummaryUnread] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  // Server-issued snapshot boundary for mark-all-read: the server only marks
  // rows this token covered, so notifications arriving after the load stay
  // unread even when their timestamps tie with the newest loaded row.
  const [readThrough, setReadThrough] = useState<string | null>(null);
  const loadToken = useRef(0);
  const loadedOnce = useRef(false);

  const loadFirstPage = useCallback(
    async (unread: boolean) => {
      // One token guards both requests, so overlapping loads (focus refresh
      // racing pull-to-refresh or a filter change) cannot interleave stale
      // pages or summaries into fresher state.
      const token = ++loadToken.current;
      if (simulatorPreview) {
        const filtered = unread
          ? previewNotifications.filter((item) => item.readAt === null)
          : previewNotifications;
        setItems(filtered);
        // No server issues tokens in preview; mark-all short-circuits anyway.
        setReadThrough("preview");
        setNextCursor(null);
        setSummaryUnread(projectSummaryUnread(previewProjects.projects, projectParam));
        setLoadFailure(null);
        return;
      }
      try {
        const [page, projects] = await Promise.all([
          api.listInboxNotifications({ project: projectParam, unread, limit: PAGE_SIZE }),
          // The summary is an enhancement; its failure never blocks the list.
          api.listInboxProjects().catch(() => null),
        ]);
        if (token !== loadToken.current) return;
        setItems(page.items);
        setReadThrough(normalizeReadThroughToken(page.readThroughToken));
        setNextCursor(page.nextCursor);
        if (projects) setSummaryUnread(projectSummaryUnread(projects.projects, projectParam));
        setLoadFailure(null);
      } catch (error) {
        if (token !== loadToken.current) return;
        // Rows already on screen stay; only an empty list shows the failure.
        setLoadFailure(isNetworkError(error) ? "network" : "other");
      }
    },
    [projectParam],
  );

  // Reload on every focus — including the return from the detail screen,
  // which marks a notification read — and whenever the unread filter flips.
  // The shared load token keeps re-entrant loads from racing each other.
  useFocusEffect(
    useCallback(() => {
      if (!session && !simulatorPreview) return;
      if (!loadedOnce.current) setLoading(true);
      void loadFirstPage(unreadOnly).finally(() => {
        loadedOnce.current = true;
        setLoading(false);
      });
    }, [loadFirstPage, session, unreadOnly]),
  );

  const loadMore = async () => {
    if (!nextCursor || loadingMore || simulatorPreview) return;
    setLoadingMore(true);
    try {
      const page = await api.listInboxNotifications({
        project: projectParam,
        unread: unreadOnly,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      // Keep the loaded slice; reaching the end again retries.
    } finally {
      setLoadingMore(false);
    }
  };

  const markAllRead = async () => {
    // The action is disabled without a token; this guard covers races.
    if (markingAll || !readThrough) return;
    setMarkingAll(true);
    try {
      if (!simulatorPreview) {
        // The snapshot token marks every unread row the last load observed —
        // including older rows beyond the first page — while notifications
        // arriving mid-tap stay unread even on timestamp ties.
        await changeUnreadCount(
          -(summaryUnread ?? loadedUnreadCount(items)),
          api.markAllNotificationsRead({ readThrough, project: projectParam }),
        );
      }
      setItems((current) => markLoadedItemsRead(current, new Date().toISOString()));
      setSummaryUnread(0);
      // Reconcile with the server in the background; the load token drops
      // this refresh if a newer one starts first.
      if (!simulatorPreview) void loadFirstPage(unreadOnly);
    } catch (error) {
      haptic.error();
      Alert.alert(
        "Couldn’t Mark All as Read",
        error instanceof Error ? error.message : "Check your connection, then try again.",
      );
    } finally {
      setMarkingAll(false);
    }
  };

  // Row context menu: read state, then the link or app it opens.
  const toggleRead = useCallback(async (item: InboxNotificationSummaryDto) => {
    const markRead = item.readAt === null;
    try {
      let readAt: string | null = null;
      if (markRead) {
        readAt = simulatorPreview
          ? new Date().toISOString()
          : (await changeUnreadCount(-1, api.markNotificationRead(item.id))).readAt;
      } else if (!simulatorPreview) {
        await changeUnreadCount(1, api.markNotificationUnread(item.id));
      }
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id ? { ...candidate, readAt } : candidate,
        ),
      );
      setSummaryUnread((count) =>
        count === null ? null : Math.max(0, count + (markRead ? -1 : 1)),
      );
    } catch (error) {
      haptic.error();
      Alert.alert(
        "Couldn’t Update Notification",
        error instanceof Error ? error.message : "Check your connection, then try again.",
      );
    }
  }, []);
  const onToggleRead = useCallback(
    (item: InboxNotificationSummaryDto) => void toggleRead(item),
    [toggleRead],
  );
  const onOpenLink = useCallback((item: InboxNotificationSummaryDto) => {
    if (item.url) void openTopLevelDestination(item.url);
  }, []);
  const onOpenApp = useCallback((item: InboxNotificationSummaryDto) => {
    if (item.app) openWebApp(item.app.id, item.url ?? undefined);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadFirstPage(unreadOnly);
    } finally {
      setRefreshing(false);
    }
  };

  const retry = () => {
    setLoading(true);
    void loadFirstPage(unreadOnly).finally(() => setLoading(false));
  };

  const unreadCount = loadedUnreadCount(items);
  const markAllAvailable = canMarkAllRead(unreadCount, summaryUnread, readThrough);
  // Nothing to filter or mark: the project has no notifications at all.
  const emptyProject = !loading && !loadFailure && !unreadOnly && items.length === 0;

  const renderItem = useCallback(
    ({ item }: { item: InboxNotificationSummaryDto }) => (
      <NotificationRow
        item={item}
        margin={margin}
        onOpenApp={onOpenApp}
        onOpenLink={onOpenLink}
        onToggleRead={onToggleRead}
      />
    ),
    [margin, onOpenApp, onOpenLink, onToggleRead],
  );
  const separatorInset = margin + NOTIFICATION_DOT_COLUMN + NOTIFICATION_DOT_GAP;
  const Separator = useCallback(() => <PlainSeparator inset={separatorInset} />, [separatorInset]);

  if (!sessionPending && !session && !simulatorPreview) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title }} />
      {/*
        Like Mail: one tap on the filter shows unread only (the button reads
        selected while it does); Mark All as Read stays a deliberate second
        step in More. A project with nothing in it offers neither.
      */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          accessibilityHint={
            unreadOnly ? "Shows all notifications" : "Shows only unread notifications"
          }
          accessibilityLabel="Unread Only"
          hidden={emptyProject}
          icon={
            unreadOnly
              ? "line.3.horizontal.decrease.circle.fill"
              : "line.3.horizontal.decrease.circle"
          }
          onPress={() => setUnreadOnly((on) => !on)}
          selected={unreadOnly}
        />
        <Stack.Toolbar.Menu accessibilityLabel="More" hidden={emptyProject} icon="ellipsis">
          <Stack.Toolbar.MenuAction
            disabled={markingAll || !markAllAvailable}
            icon="envelope.open"
            onPress={() => void markAllRead()}
          >
            Mark All as Read
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <FlatList
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          unreadOnly ? (
            <FilterLine label="Unread" margin={margin} onShowAll={() => setUnreadOnly(false)} />
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <LoadingState />
          ) : loadFailure ? (
            <ErrorState
              network={loadFailure === "network"}
              onRetry={retry}
              title="Couldn’t Load Notifications"
            />
          ) : unreadOnly ? (
            <EmptyState
              message="You’ve read everything in this project."
              symbol="tray"
              title="No Unread Notifications"
            />
          ) : (
            <EmptyState
              message="Notifications sent to this project show up here."
              symbol="tray"
              title="No Notifications"
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator accessibilityLabel="Loading more" />
            </View>
          ) : null
        }
        contentContainerStyle={safeArea}
        contentInsetAdjustmentBehavior="automatic"
        data={loading ? [] : items}
        initialNumToRender={12}
        keyExtractor={(item) => item.id}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        refreshControl={
          loading ? undefined : (
            <RefreshControl onRefresh={() => void onRefresh()} refreshing={refreshing} />
          )
        }
        renderItem={renderItem}
        style={styles.list}
        windowSize={7}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  footer: {
    alignItems: "center",
    paddingVertical: space.l,
  },
});
