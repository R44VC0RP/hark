import type { InboxNotificationSummaryDto } from "@hark/contracts";
import * as Device from "expo-device";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../../src/lib/api";
import { useSession } from "../../src/lib/auth";
import { previewNotifications, previewProjects } from "../../src/lib/inbox-preview";
import { readableColumn } from "../../src/lib/layout";
import {
  canMarkAllRead,
  loadedUnreadCount,
  markLoadedItemsRead,
  normalizeReadThroughToken,
  projectSummaryUnread,
} from "../../src/lib/project-inbox";
import { colors, fonts, tightTracking } from "../../src/lib/theme";

const PAGE_SIZE = 30;

export default function ProjectScreen() {
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ project: string; name?: string }>();
  const projectParam = typeof params.project === "string" ? params.project : "unfiled";
  const title = typeof params.name === "string" && params.name ? params.name : "Notifications";
  const simulatorPreview = __DEV__ && !Device.isDevice;

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
  const [loadError, setLoadError] = useState(false);
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
        setLoadError(false);
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
        setLoadError(false);
      } catch {
        if (token !== loadToken.current) return;
        setLoadError(true);
      }
    },
    [projectParam, simulatorPreview],
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
    }, [loadFirstPage, session, simulatorPreview, unreadOnly]),
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
      // Keep the loaded slice; the footer button retries on the next scroll.
    } finally {
      setLoadingMore(false);
    }
  };

  const markAllRead = async () => {
    // The button is disabled without a token; this guard covers races.
    if (markingAll || !readThrough) return;
    setMarkingAll(true);
    try {
      if (!simulatorPreview) {
        // The snapshot token marks every unread row the last load observed —
        // including older rows beyond the first page — while notifications
        // arriving mid-tap stay unread even on timestamp ties.
        await api.markAllNotificationsRead({
          readThrough,
          project: projectParam,
        });
      }
      setItems((current) => markLoadedItemsRead(current, new Date().toISOString()));
      setSummaryUnread(0);
      // Reconcile with the server in the background; the load token drops
      // this refresh if a newer one starts first.
      if (!simulatorPreview) void loadFirstPage(unreadOnly);
    } catch (error) {
      Alert.alert(
        "Could not mark all read",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setMarkingAll(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadFirstPage(unreadOnly);
    } finally {
      setRefreshing(false);
    }
  };

  const unreadCount = loadedUnreadCount(items);
  const markAllAvailable = canMarkAllRead(unreadCount, summaryUnread, readThrough);

  if (!sessionPending && !session && !simulatorPreview) return <Redirect href="/" />;

  return (
    <SafeAreaView edges={["top"]} style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/inbox"))}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
        >
          <SymbolView name="chevron.left" size={16} tintColor={colors.ink} weight="semibold" />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {title}
        </Text>
        <Pressable
          accessibilityLabel="Mark all read"
          accessibilityRole="button"
          disabled={markingAll || !markAllAvailable}
          onPress={() => void markAllRead()}
          style={({ pressed }) => [
            styles.iconButton,
            (markingAll || !markAllAvailable) && styles.iconButtonDisabled,
            pressed && markAllAvailable && styles.iconButtonPressed,
          ]}
        >
          <SymbolView
            name="checkmark.circle"
            size={18}
            tintColor={markAllAvailable ? colors.accent : colors.soft}
          />
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {(
          [
            { label: "All", value: false },
            { label: "Unread", value: true },
          ] as const
        ).map((option) => {
          const selected = unreadOnly === option.value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={option.label}
              onPress={() => setUnreadOnly(option.value)}
              style={({ pressed }) => [
                styles.filterOption,
                selected && styles.filterOptionSelected,
                pressed && styles.filterOptionPressed,
              ]}
            >
              <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={items}
          keyExtractor={(item) => item.id}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {loadError
                ? "Couldn’t load notifications. Pull to refresh."
                : unreadOnly
                  ? "No unread notifications."
                  : "No notifications yet."}
            </Text>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.accent} style={styles.footerLoading} />
            ) : null
          }
          renderItem={({ item }) => (
            <NotificationRow
              item={item}
              onPress={() =>
                router.push({ pathname: "/notification/[id]", params: { id: item.id } })
              }
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function NotificationRow({
  item,
  onPress,
}: {
  item: InboxNotificationSummaryDto;
  onPress: () => void;
}) {
  const unread = item.readAt === null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={[styles.unreadDot, !unread && styles.unreadDotHidden]} />
      <View style={styles.rowCopy}>
        <View style={styles.rowTopLine}>
          <Text numberOfLines={1} style={[styles.rowTitle, unread && styles.rowTitleUnread]}>
            {item.title}
          </Text>
          <Text style={styles.rowTime}>{formatTime(item.createdAt)}</Text>
        </View>
        <Text numberOfLines={2} style={styles.rowPreview}>
          {item.preview}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {item.sourceName}
        </Text>
      </View>
    </Pressable>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    ...readableColumn,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  headerTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 17,
    textAlign: "center",
    letterSpacing: tightTracking(17),
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  iconButtonDisabled: {
    opacity: 0.4,
  },
  iconButtonPressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.96 }],
  },
  filterRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 24,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  filterOption: {
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
    borderRadius: 18,
  },
  filterOptionSelected: {
    backgroundColor: colors.accentSoft,
  },
  filterOptionPressed: {
    opacity: 0.65,
    transform: [{ scale: 0.96 }],
  },
  filterLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  filterLabelSelected: {
    color: colors.accent,
  },
  loading: {
    paddingVertical: 40,
  },
  footerLoading: {
    paddingVertical: 20,
  },
  list: {
    ...readableColumn,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  empty: {
    paddingVertical: 24,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  row: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowPressed: {
    opacity: 0.7,
  },
  unreadDot: {
    width: 8,
    height: 8,
    marginTop: 6,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  unreadDotHidden: {
    opacity: 0,
  },
  rowCopy: {
    minWidth: 0,
    flex: 1,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  rowTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: tightTracking(14),
  },
  rowTitleUnread: {
    fontFamily: fonts.semibold,
  },
  rowTime: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 11,
    letterSpacing: tightTracking(11),
  },
  rowPreview: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  rowMeta: {
    marginTop: 3,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: tightTracking(11),
  },
});
