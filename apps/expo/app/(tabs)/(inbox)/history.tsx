import type { InboxActivityDto, InboxActivityKind } from "@hark/contracts";
import * as Device from "expo-device";
import { Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { HISTORY_AVATAR, HistoryRow } from "../../../src/components/inbox/history-row";
import { api } from "../../../src/lib/api";
import { previewActivity } from "../../../src/lib/inbox-preview";
import { createRefreshSequence } from "../../../src/lib/inbox-refresh";
import { Button } from "../../../src/ui/button";
import { EmptyState, ErrorState, isNetworkError, LoadingState } from "../../../src/ui/empty-state";
import { PlainSeparator, useHorizontalSafeArea, useScreenMargin } from "../../../src/ui/list";
import { Text } from "../../../src/ui/text";
import { colors, metrics, space } from "../../../src/ui/tokens";

type Filter = "all" | InboxActivityKind;

const FILTERS: { value: Filter; label: string; empty: string; message: string }[] = [
  {
    value: "all",
    label: "All Activity",
    empty: "No Activity Yet",
    message: "Notifications, Live Activities and your answers to requests show up here.",
  },
  {
    value: "notification",
    label: "Notifications",
    empty: "No Notifications",
    message: "Notifications from your agents and scripts show up here.",
  },
  {
    value: "live_activity",
    label: "Live Activities",
    empty: "No Live Activities",
    message: "Live Activities show up here as they start and update.",
  },
  {
    value: "response",
    label: "Responses",
    empty: "No Responses",
    message: "Requests you approve, deny or reply to show up here.",
  },
];

/** The server's page size for the activity feed. */
const PAGE_SIZE = 20;
const simulatorPreview = __DEV__ && !Device.isDevice;

/** `moreFailed`: the next page failed; the footer offers Try Again. */
type Status = "loading" | "idle" | "more" | "moreFailed" | "error";

/**
 * History (DESIGN.md 5.4): everything that already happened, newest first,
 * in a plain list that loads the next page as you scroll. The filter is a
 * native toolbar menu instead of chips.
 */
export default function HistoryScreen() {
  const margin = useScreenMargin();
  const safeArea = useHorizontalSafeArea();
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<InboxActivityDto[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [failure, setFailure] = useState<"network" | "other">("other");
  const [refreshing, setRefreshing] = useState(false);
  const page = useRef(0);
  // A slow page for an old filter never lands in the new one.
  const sequence = useRef(createRefreshSequence()).current;

  const loadPage = useCallback(
    async (target: Filter, pageIndex: number) => {
      const token = sequence.begin();
      let result: { items: InboxActivityDto[]; total: number };
      if (simulatorPreview) {
        const filtered =
          target === "all"
            ? previewActivity
            : previewActivity.filter((item) => item.kind === target);
        result = {
          items: filtered.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE),
          total: filtered.length,
        };
      } else {
        result = await api.listActivityFeed(target, pageIndex);
      }
      if (!sequence.isCurrent(token)) return;
      page.current = pageIndex;
      setItems((current) => (pageIndex === 0 ? result.items : [...current, ...result.items]));
      setTotal(result.total);
      setStatus("idle");
    },
    [sequence],
  );

  const reload = useCallback(
    (target: Filter) => {
      setStatus("loading");
      void loadPage(target, 0).catch((error: unknown) => {
        setFailure(isNetworkError(error) ? "network" : "other");
        setStatus("error");
      });
    },
    [loadPage],
  );

  useEffect(() => {
    reload(filter);
  }, [filter, reload]);

  // A failed page waits for Try Again instead of retrying on every scroll.
  const loadMore = (retry = false) => {
    if (items.length >= total) return;
    if (status !== "idle" && !(retry && status === "moreFailed")) return;
    setStatus("more");
    void loadPage(filter, page.current + 1).catch(() => setStatus("moreFailed"));
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadPage(filter, 0);
    } catch {
      // Keep the rows already on screen.
    } finally {
      setRefreshing(false);
    }
  };

  const choose = (value: Filter) => {
    if (value === filter) return;
    setItems([]);
    setTotal(0);
    setFilter(value);
  };

  const current = FILTERS.find((option) => option.value === filter) ?? FILTERS[0];
  const separatorInset = margin + HISTORY_AVATAR + metrics.rowAccessoryGap;

  const renderItem = useCallback(
    ({ item }: { item: InboxActivityDto }) => <HistoryRow item={item} margin={margin} />,
    [margin],
  );
  const Separator = useCallback(() => <PlainSeparator inset={separatorInset} />, [separatorInset]);

  return (
    <>
      <Stack.Screen options={{ title: "History" }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu
          accessibilityLabel="Filter"
          icon={
            filter === "all"
              ? "line.3.horizontal.decrease.circle"
              : "line.3.horizontal.decrease.circle.fill"
          }
        >
          {FILTERS.map((option) => (
            <Stack.Toolbar.MenuAction
              isOn={option.value === filter}
              key={option.value}
              onPress={() => choose(option.value)}
            >
              {option.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <FlatList
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={
          status === "loading" ? (
            <LoadingState />
          ) : status === "error" ? (
            <ErrorState
              network={failure === "network"}
              onRetry={() => reload(filter)}
              title="Couldn't Load History"
            />
          ) : (
            <EmptyState
              message={current?.message}
              symbol="clock.arrow.circlepath"
              title={current?.empty ?? "No Activity Yet"}
            />
          )
        }
        ListFooterComponent={
          status === "more" ? (
            <View style={styles.footer}>
              <ActivityIndicator accessibilityLabel="Loading more" />
            </View>
          ) : status === "moreFailed" ? (
            <View style={styles.footer}>
              <Text align="center" color="secondaryLabel" variant="footnote">
                Couldn't load more activity.
              </Text>
              <Button onPress={() => loadMore(true)} title="Try Again" variant="plain" />
            </View>
          ) : null
        }
        contentContainerStyle={safeArea}
        contentInsetAdjustmentBehavior="automatic"
        data={items}
        initialNumToRender={12}
        keyExtractor={(item) => `${item.kind}-${item.id}`}
        onEndReached={() => loadMore()}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl onRefresh={() => void onRefresh()} refreshing={refreshing} />
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
    gap: space.xs,
    paddingVertical: space.l,
  },
});
