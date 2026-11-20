import type { EventDto } from "@hark/contracts";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Stack } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet } from "react-native";
import { DELIVERY_AVATAR, DeliveryRow } from "../../src/components/delivery-row";
import { api } from "../../src/lib/api";
import { previewEvents } from "../../src/lib/inbox-preview";
import { EmptyState, ErrorState, isNetworkError, LoadingState } from "../../src/ui/empty-state";
import { PlainSeparator, useScreenMargin } from "../../src/ui/list";
import { colors, metrics } from "../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;

type Status = "loading" | "ready" | "error";

/**
 * Recent Deliveries (DESIGN.md 5.17), pushed inside the Settings sheet: the
 * webhooks Hark received lately and whether they reached your devices. Once
 * only visible during Set Up; now always one tap from Settings.
 */
export default function DeliveriesScreen() {
  const margin = useScreenMargin();
  const [events, setEvents] = useState<EventDto[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [failure, setFailure] = useState<"network" | "other">("other");
  const [refreshing, setRefreshing] = useState(false);
  const eventsJson = useRef("");

  const load = useCallback(async () => {
    const next = simulatorPreview ? previewEvents : (await api.listEvents()).events;
    setStatus("ready");
    const json = JSON.stringify(next);
    if (json === eventsJson.current) return;
    eventsJson.current = json;
    setEvents(next);
  }, []);

  const reload = useCallback(() => {
    setStatus("loading");
    void load().catch((error: unknown) => {
      setFailure(isNetworkError(error) ? "network" : "other");
      setStatus("error");
    });
  }, [load]);

  useEffect(() => {
    reload();
    // A push is a new delivery: show it without a pull.
    const received = Notifications.addNotificationReceivedListener(() => {
      void load().catch(() => {});
    });
    return () => received.remove();
  }, [load, reload]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } catch {
      // Keep the rows on screen.
    } finally {
      setRefreshing(false);
    }
  };

  const renderItem = useCallback(
    ({ item }: { item: EventDto }) => (
      <DeliveryRow event={item} margin={margin} ringColor="background" />
    ),
    [margin],
  );
  const separatorInset = margin + DELIVERY_AVATAR + metrics.rowAccessoryGap;
  const Separator = useCallback(() => <PlainSeparator inset={separatorInset} />, [separatorInset]);

  return (
    <>
      <Stack.Screen options={{ title: "Recent Deliveries" }} />
      <FlatList
        ItemSeparatorComponent={Separator}
        ListEmptyComponent={
          status === "loading" ? (
            <LoadingState />
          ) : status === "error" ? (
            <ErrorState
              network={failure === "network"}
              onRetry={reload}
              title="Couldn’t Load Deliveries"
            />
          ) : (
            <EmptyState
              message="Webhooks you send to Hark show up here with their delivery status."
              symbol="paperplane"
              title="No Deliveries Yet"
            />
          )
        }
        contentInsetAdjustmentBehavior="automatic"
        data={events}
        initialNumToRender={12}
        keyExtractor={(item) => item.id}
        refreshControl={
          status === "loading" ? undefined : (
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
});
