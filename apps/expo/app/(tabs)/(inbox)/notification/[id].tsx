import type { InboxNotificationDetailDto } from "@hark/contracts";
import * as Device from "expo-device";
import {
  Redirect,
  Stack,
  useIsFocused,
  useIsPreview,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { AppIcon } from "../../../../src/components/app-icon";
import { api, classifyNotificationDetailFailure } from "../../../../src/lib/api";
import { useSession } from "../../../../src/lib/auth";
import { haptic } from "../../../../src/lib/haptics";
import {
  linkDestinationLabel,
  linkifyBody,
  openBodyLink,
  openTopLevelDestination,
} from "../../../../src/lib/inbox-body";
import { previewNotificationDetail } from "../../../../src/lib/inbox-preview";
import { openWebApp } from "../../../../src/lib/navigation";
import { spoken } from "../../../../src/ui/a11y";
import { SourceAvatar } from "../../../../src/ui/avatar";
import { Button } from "../../../../src/ui/button";
import {
  EmptyState,
  ErrorState,
  isNetworkError,
  LoadingState,
} from "../../../../src/ui/empty-state";
import { ActionRow, Cell, LabeledRow, List, Section } from "../../../../src/ui/list";
import { Text } from "../../../../src/ui/text";
import { metrics, space } from "../../../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;
const NO_TITLE = { title: "" };

type Failure = "not_found" | "network" | "other";

/**
 * One notification (DESIGN.md 5.7), read like a message: who sent it and
 * when, the title, the body with tappable links, then what it opens (its web
 * app or link) and the delivery details. Opening it marks it read, except
 * while it is only previewed from a project row (touch and hold).
 */
export default function NotificationDetailScreen() {
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();
  const previewed = useIsPreview();
  // A touch-and-hold preview also prefetches this screen as a hidden,
  // unfocused route; only the screen people actually opened marks read.
  const focused = useIsFocused();
  const params = useLocalSearchParams<{ id: string }>();
  const compositeId = typeof params.id === "string" ? params.id : "";

  const [notification, setNotification] = useState<InboxNotificationDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [togglingRead, setTogglingRead] = useState(false);
  // Opening marks read once per notification; toggling it back to unread
  // here must stick. Keyed by ID: a deep link can reuse this screen for
  // another notification (checked in the simulator).
  const markedOnOpen = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (simulatorPreview) {
      setNotification(previewNotificationDetail(compositeId));
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailure(null);
    try {
      const result = await api.getInboxNotification(compositeId);
      setNotification(result.notification);
    } catch (error) {
      const kind = classifyNotificationDetailFailure(error);
      if (kind === "not_found") {
        // A modern server confirmed the notification is gone.
        setFailure("not_found");
      } else if (kind === "unsupported_server") {
        // Old or self-hosted servers have no detail route; a push tap lands
        // here anyway, so return to the legacy inbox instead of a dead end.
        router.replace("/inbox");
        return;
      } else {
        setFailure(isNetworkError(error) ? "network" : "other");
      }
    } finally {
      setLoading(false);
    }
  }, [compositeId, router]);

  useEffect(() => {
    if (!session && !simulatorPreview) return;
    // Never show the previous notification while another one loads.
    setNotification((current) => (current && current.id !== compositeId ? null : current));
    void load();
  }, [compositeId, load, session]);

  // Mark read only after the full content loaded, and never while the screen
  // is a touch-and-hold preview or its prefetched copy (it may never be
  // opened). A preview that is tapped open becomes this same screen, focused,
  // so this runs then. Optimistic, so the bar button and State row read
  // "read" from the first frame instead of flipping a moment later.
  const unreadOnArrival = notification?.id === compositeId && notification.readAt === null;
  useEffect(() => {
    if (previewed || !focused || !unreadOnArrival || markedOnOpen.current === compositeId) return;
    if (simulatorPreview) return;
    markedOnOpen.current = compositeId;
    const sameNotification = (current: InboxNotificationDetailDto | null) =>
      current !== null && current.id === compositeId;
    setNotification((current) =>
      sameNotification(current) && current
        ? { ...current, readAt: new Date().toISOString() }
        : current,
    );
    void api
      .markNotificationRead(compositeId)
      .then((marked) => {
        setNotification((current) =>
          sameNotification(current) && current ? { ...current, readAt: marked.readAt } : current,
        );
      })
      .catch(() => {
        // It stays unread; the next open retries (not this one, so a failing
        // server is never asked in a loop).
        setNotification((current) =>
          sameNotification(current) && current ? { ...current, readAt: null } : current,
        );
      });
  }, [compositeId, focused, previewed, unreadOnArrival]);

  const toggleRead = async () => {
    if (!notification || togglingRead) return;
    // Whatever happens next is the person's choice, not the automatic mark.
    markedOnOpen.current = notification.id;
    setTogglingRead(true);
    try {
      if (notification.readAt === null) {
        const marked = simulatorPreview
          ? { readAt: new Date().toISOString() }
          : await api.markNotificationRead(notification.id);
        setNotification({ ...notification, readAt: marked.readAt });
      } else {
        if (!simulatorPreview) await api.markNotificationUnread(notification.id);
        setNotification({ ...notification, readAt: null });
      }
    } catch (error) {
      haptic.error();
      Alert.alert(
        "Couldn't Update Notification",
        error instanceof Error ? error.message : "Check your connection, then try again.",
      );
    } finally {
      setTogglingRead(false);
    }
  };

  if (!sessionPending && !session && !simulatorPreview) return <Redirect href="/" />;

  const read = notification?.readAt != null;

  return (
    <>
      {/* A preview has no header; its navigation object must not be touched. */}
      {previewed ? null : <Stack.Screen options={NO_TITLE} />}
      {/*
        Present from the first frame, so it slides in with the push instead of
        popping in after it. While loading it reads "Mark as Unread": opening
        a notification marks it read.
      */}
      {previewed ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            disabled={!notification || togglingRead}
            hidden={!notification && !loading}
            onPress={() => void toggleRead()}
          >
            {notification && !read ? "Mark as Read" : "Mark as Unread"}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      <List reading>
        {notification ? (
          <NotificationContent notification={notification} />
        ) : loading ? (
          <LoadingState />
        ) : failure === "not_found" ? (
          <EmptyState
            message="It was removed or it expired."
            symbol="tray"
            title="Notification Unavailable"
          />
        ) : (
          <ErrorState
            network={failure === "network"}
            onRetry={() => void load()}
            title="Couldn't Load Notification"
          />
        )}
      </List>
    </>
  );
}

function NotificationContent({ notification }: { notification: InboxNotificationDetailDto }) {
  const { app, url } = notification;
  const received = formatHeaderTime(notification.createdAt);
  // "Fieldnotes Shop · Fieldnotes Shop" says nothing twice (same rule as the Inbox).
  const projectName =
    notification.projectName &&
    notification.projectName.toLowerCase() !== notification.sourceName.toLowerCase()
      ? notification.projectName
      : null;
  return (
    <>
      <View
        accessibilityLabel={spoken(
          projectName ? `${notification.sourceName}, ${projectName}` : notification.sourceName,
          received,
        )}
        accessible
        style={styles.source}
      >
        <SourceAvatar name={notification.sourceName} size={32} url={notification.sourceImageUrl} />
        <View style={styles.sourceCopy}>
          <Text color="secondaryLabel" variant="subheadline">
            <Text variant="subheadline" weight="600">
              {notification.sourceName}
            </Text>
            {projectName ? ` · ${projectName}` : ""}
          </Text>
          <Text color="tertiaryLabel" variant="footnote">
            {received}
          </Text>
        </View>
      </View>
      <Text accessibilityRole="header" selectable style={styles.title} variant="title2">
        {notification.title}
      </Text>
      {notification.body ? <BodyText body={notification.body} /> : null}

      {app ? (
        <Section footer="Signs you in with Hark. No password needed.">
          <Cell style={styles.appCell}>
            <View
              accessibilityLabel={spoken(app.name, appDestinationLabel(app.origin, url))}
              accessible
              style={styles.appIdentity}
            >
              <AppIcon iconUrl={app.iconUrl} name={app.name} size={44} />
              <View style={styles.appCopy}>
                <Text variant="headline">{app.name}</Text>
                <Text color="secondaryLabel" variant="footnote">
                  {appDestinationLabel(app.origin, url)}
                </Text>
              </View>
            </View>
            <Button
              accessibilityHint="Opens the app signed in with Hark"
              onPress={() => openWebApp(app.id, url ?? undefined)}
              size="large"
              title={`Open ${app.name}`}
              variant="prominent"
            />
          </Cell>
        </Section>
      ) : url ? (
        // A row, not a bordered button: the button's fill disappears on the
        // grouped background (checked in the simulator).
        <Section>
          <ActionRow
            accessibilityHint="Opens in Safari or the app it belongs to"
            onPress={() => void openTopLevelDestination(url)}
            symbol="arrow.up.right.square"
            title={openLinkLabel(url)}
          />
        </Section>
      ) : null}

      <Section title="Details">
        <LabeledRow label="Received" selectable value={formatFullTime(notification.createdAt)} />
        {notification.status ? (
          <LabeledRow label="Delivery" value={statusLabel(notification.status)} />
        ) : null}
        <LabeledRow label="State" value={notification.readAt ? "Read" : "Unread"} />
      </Section>
    </>
  );
}

/**
 * Selectable plain-text body with safe URL linkification. No HTML, no
 * WebView, no remote previews; links are revalidated again on tap. Links are
 * underlined as well as tinted: the accent and the ink are both dark.
 */
function BodyText({ body }: { body: string }) {
  const segments = linkifyBody(body.trim());
  // Character offsets make stable keys even when segment text repeats.
  let offset = 0;
  const keyed = segments.map((segment) => {
    const key = `at-${offset}`;
    offset += segment.text.length;
    return { ...segment, key };
  });
  return (
    <Text selectable style={styles.body} variant="body">
      {keyed.map((segment) =>
        segment.url ? (
          <Text
            accessibilityRole="link"
            color="accent"
            key={segment.key}
            onPress={() => {
              if (segment.url) void openBodyLink(segment.url);
            }}
            style={styles.link}
            variant="body"
          >
            {segment.text}
          </Text>
        ) : (
          <Text key={segment.key} variant="body">
            {segment.text}
          </Text>
        ),
      )}
    </Text>
  );
}

/** "Open Link" plus where it goes, e.g. `Open Link · ci.example.com`. */
function openLinkLabel(url: string): string {
  const destination = linkDestinationLabel(url);
  return destination ? `Open Link · ${destination}` : "Open Link";
}

/** Host plus path of the page an app notification opens, e.g. `app.example.com/builds/185`. */
function appDestinationLabel(origin: string, url: string | null): string {
  try {
    const target = new URL(url && new URL(url).origin === origin ? url : origin);
    const path = target.pathname === "/" ? "" : target.pathname;
    return `${target.host}${path}`;
  } catch {
    return origin;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "accepted":
      return "Delivered";
    case "partial":
      return "Partially Delivered";
    case "no_devices":
      return "No Devices";
    case "failed":
      return "Failed";
    case "withdrawn":
    case "withdraw_partial":
      return "Withdrawn";
    default:
      return status;
  }
}

/** "Today at 9:41 PM", "Yesterday at 8:02 AM", "Nov 12 at 3:15 PM". */
function formatHeaderTime(value: string): string {
  const date = new Date(value);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `Today at ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday at ${time}`;
  const sameYear = date.getFullYear() === today.getFullYear();
  const day = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${day} at ${time}`;
}

/** "Nov 18, 2026 at 9:41 PM". */
function formatFullTime(value: string): string {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

const styles = StyleSheet.create({
  source: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s,
    marginTop: space.xs,
  },
  sourceCopy: {
    minWidth: 0,
    flex: 1,
  },
  title: {
    marginTop: space.l,
  },
  body: {
    marginTop: space.s,
  },
  link: {
    textDecorationLine: "underline",
  },
  appCell: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.m,
    paddingVertical: space.m,
  },
  appIdentity: {
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowAccessoryGap,
  },
  appCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
});
