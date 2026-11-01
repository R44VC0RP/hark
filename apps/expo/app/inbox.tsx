import type {
  InboxActivityDto,
  InboxActivityKind,
  InboxInteractionDto,
  InboxLiveActivityDto,
  InboxProjectSummaryDto,
} from "@hark/contracts";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HeaderLeading } from "../src/components/screen-parts";
import { ApiError, api } from "../src/lib/api";
import { useSession } from "../src/lib/auth";
import {
  previewActive,
  previewActivity,
  previewPending,
  previewProjects,
} from "../src/lib/inbox-preview";
import { createFocusRefreshPolicy, createRefreshSequence } from "../src/lib/inbox-refresh";
import { DEVICE_ID_KEY, submitInteractionResponse } from "../src/lib/interactions";
import { readableColumn } from "../src/lib/layout";
import { colors, fonts, tightTracking } from "../src/lib/theme";

type ActivityFilter = "all" | InboxActivityKind;

const PLACEHOLDER_AVATAR_URL =
  "https://pbs.twimg.com/profile_images/2070959207273082880/HZoVBuA2_400x400.jpg";

const ACTIVITY_PAGE_SIZE = 20;

export default function InboxScreen() {
  const { data: session, isPending: sessionPending } = useSession();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const activityOffset = useRef(0);
  const previewLoaded = useRef(false);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [pending, setPending] = useState<InboxInteractionDto[]>([]);
  const [active, setActive] = useState<InboxLiveActivityDto[]>([]);
  const [projects, setProjects] = useState<InboxProjectSummaryDto[]>([]);
  // Older/self-hosted servers without /api/inbox keep the legacy behavior.
  const projectInboxSupported = useRef(true);
  const [activity, setActivity] = useState<InboxActivityDto[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activityPage, setActivityPage] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const simulatorPreview = __DEV__ && !Device.isDevice;
  // Orders overlapping refreshes (timer, focus, push, pull-to-refresh) so a
  // slow stale response never overwrites fresher state or the badge.
  const refreshSequence = useRef(createRefreshSequence()).current;

  useEffect(() => {
    void SecureStore.getItemAsync(DEVICE_ID_KEY).then((value) =>
      setDeviceId(value ?? (simulatorPreview ? "preview-device" : "")),
    );
  }, [simulatorPreview]);

  const refreshSummary = useCallback(
    async (token: number) => {
      if (simulatorPreview) {
        if (!previewLoaded.current) {
          previewLoaded.current = true;
          setPending(previewPending);
        }
        setActive(previewActive);
        setProjects(previewProjects.projects);
        return;
      }
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
      setPending(interactionResult.interactions);
      setActive(activityResult.activities);
      if (projectResult) setProjects(projectResult.projects);
      else if (!projectInboxSupported.current) setProjects([]);
      // Badge counts pending interactions plus unread notifications; the
      // server never sends badge values itself.
      const totalUnread = projectResult?.totalUnread ?? 0;
      void Notifications.setBadgeCountAsync(
        interactionResult.interactions.length + totalUnread,
      ).catch(() => {});
    },
    [refreshSequence, simulatorPreview],
  );

  const refreshActivity = useCallback(
    async (token: number) => {
      if (simulatorPreview) {
        const filtered =
          activityFilter === "all"
            ? previewActivity
            : previewActivity.filter((item) => item.kind === activityFilter);
        setActivity(
          filtered.slice(
            activityPage * ACTIVITY_PAGE_SIZE,
            (activityPage + 1) * ACTIVITY_PAGE_SIZE,
          ),
        );
        setActivityTotal(filtered.length);
        return;
      }
      const result = await api.listActivityFeed(activityFilter, activityPage);
      if (!refreshSequence.isCurrent(token)) return;
      if (result.items.length === 0 && activityPage > 0) {
        setActivityPage(activityPage - 1);
        return;
      }
      setActivity(result.items);
      setActivityTotal(result.total);
      setLoadError(false);
    },
    [activityFilter, activityPage, refreshSequence, simulatorPreview],
  );

  const refreshAll = useCallback(async () => {
    const token = refreshSequence.begin();
    await Promise.all([refreshSummary(token), refreshActivity(token)]);
  }, [refreshActivity, refreshSequence, refreshSummary]);

  useEffect(() => {
    if ((!session && !simulatorPreview) || !deviceId) return;
    setLoading(true);
    void refreshAll()
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
    const timer = setInterval(() => void refreshAll().catch(() => {}), 15_000);
    const notificationSubscription = Notifications.addNotificationReceivedListener(() => {
      void refreshAll().catch(() => {});
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshAll().catch(() => {});
    });
    return () => {
      clearInterval(timer);
      notificationSubscription.remove();
      appStateSubscription.remove();
    };
  }, [deviceId, refreshAll, session, simulatorPreview]);

  // Refresh immediately when the screen regains navigation focus — returning
  // from the project or notification screens, where read state changes —
  // instead of waiting up to 15 seconds for the timer to correct the project
  // unread counts and the app badge. The callback stays stable (state is read
  // through refs) so the effect fires only on real focus transitions, and the
  // policy skips the mount focus because the initial-load effect owns it.
  const focusRefreshPolicy = useRef(createFocusRefreshPolicy()).current;
  const refreshAllRef = useRef(refreshAll);
  useEffect(() => {
    refreshAllRef.current = refreshAll;
  }, [refreshAll]);
  const focusReadyRef = useRef(false);
  useEffect(() => {
    focusReadyRef.current = Boolean((session || simulatorPreview) && deviceId);
  }, [deviceId, session, simulatorPreview]);
  useFocusEffect(
    useCallback(() => {
      if (focusRefreshPolicy.onFocus(focusReadyRef.current)) {
        void refreshAllRef.current().catch(() => {});
      }
      return () => focusRefreshPolicy.onBlur();
    }, [focusRefreshPolicy]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshAll();
    } catch {
      setLoadError(true);
    } finally {
      setRefreshing(false);
    }
  };

  const resolveItem = async (
    item: InboxInteractionDto,
    action: "approve" | "deny" | "yes" | "no" | "reply",
    response?: string,
  ) => {
    if (!deviceId || respondingTo) return;
    setRespondingTo(item.id);
    try {
      if (simulatorPreview) {
        setPending((items) => items.filter((candidate) => candidate.id !== item.id));
        setActivityPage(0);
        setReplyingTo(null);
        setReply("");
        return;
      }
      if (action === "reply") {
        await submitInteractionResponse(item.id, {
          action,
          response: response?.trim() ?? "",
          actionDigest: item.actionDigest,
        });
      } else {
        await submitInteractionResponse(item.id, {
          action,
          actionDigest: item.actionDigest,
        });
      }
      setPending((items) => items.filter((candidate) => candidate.id !== item.id));
      setReplyingTo(null);
      setReply("");
      setActivityPage(0);
      await refreshAll().catch(() => {});
    } catch (error) {
      Alert.alert(
        "Could not save response",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setRespondingTo(null);
    }
  };

  const activityPageCount = Math.max(1, Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE));
  const projectGroups = buildProjectGroups(projects, pending, active);

  if (!sessionPending && !session && !simulatorPreview) return <Redirect href="/" />;
  if (deviceId === "") return <Redirect href="/home" />;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={colors.accent}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <HeaderLeading
              onBack={() => (router.canGoBack() ? router.back() : router.replace("/apps"))}
            />
            <Text style={styles.brand}>Inbox</Text>
            <View style={styles.settingsButton} />
          </View>

          {projectGroups.length > 0 ? (
            <View style={styles.projectSection}>
              {projectGroups.map((group) => (
                <ProjectGroup
                  active={group.active}
                  item={group.project}
                  key={group.project.projectId ?? "unfiled"}
                  onCancelReply={() => {
                    setReplyingTo(null);
                    setReply("");
                  }}
                  onOpen={() =>
                    router.push({
                      pathname: "/project/[project]",
                      params: {
                        project: group.project.projectId ?? "unfiled",
                        name: group.project.name,
                      },
                    })
                  }
                  onReplyChange={setReply}
                  onResolve={(interaction, action, response) =>
                    void resolveItem(interaction, action, response)
                  }
                  onStartReply={(id) => setReplyingTo(id)}
                  pending={group.pending}
                  reply={reply}
                  replyingTo={replyingTo}
                  respondingTo={respondingTo}
                />
              ))}
            </View>
          ) : (
            <>
              {pending.map((item, index) => (
                <PendingRow
                  item={item}
                  key={item.id}
                  first={index === 0}
                  replying={replyingTo === item.id}
                  reply={reply}
                  onReplyChange={setReply}
                  onStartReply={() => setReplyingTo(item.id)}
                  onCancelReply={() => {
                    setReplyingTo(null);
                    setReply("");
                  }}
                  onResolve={(action, response) => void resolveItem(item, action, response)}
                  responding={respondingTo === item.id}
                />
              ))}
              {active.map((item, index) => (
                <ActiveRow item={item} key={item.id} first={index === 0} />
              ))}
            </>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: historyOpen }}
            onPress={() => setHistoryOpen((open) => !open)}
            style={({ pressed }) => [styles.historyRow, pressed && styles.projectRowPressed]}
          >
            <Text style={styles.historyText}>History</Text>
            <SymbolView
              name={historyOpen ? "chevron.up" : "chevron.right"}
              size={11}
              tintColor={colors.soft}
              weight="semibold"
            />
          </Pressable>

          {historyOpen ? (
            <View onLayout={(event) => (activityOffset.current = event.nativeEvent.layout.y)}>
              <ActivityPicker
                value={activityFilter}
                onChange={(value) => {
                  setActivityFilter(value);
                  setActivityPage(0);
                }}
              />
              {loading ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null}
              {!loading && activity.length === 0 ? (
                <Text style={styles.emptyActivity}>
                  {loadError ? "Couldn’t load activity. Pull to refresh." : "No activity yet."}
                </Text>
              ) : null}
              {activity.map((item, index) => (
                <ActivityRow item={item} key={`${item.kind}-${item.id}`} first={index === 0} />
              ))}
              {activityPageCount > 1 ? (
                <Pagination
                  page={activityPage}
                  pageCount={activityPageCount}
                  total={activityTotal}
                  onPageChange={(page) => {
                    setActivityPage(page);
                    scrollRef.current?.scrollTo({ y: activityOffset.current, animated: true });
                  }}
                />
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface ProjectGroupData {
  project: InboxProjectSummaryDto;
  pending: InboxInteractionDto[];
  active: InboxLiveActivityDto[];
}

function buildProjectGroups(
  projects: InboxProjectSummaryDto[],
  pending: InboxInteractionDto[],
  active: InboxLiveActivityDto[],
): ProjectGroupData[] {
  if (projects.length === 0) return [];

  const projectIds = new Set(projects.map((project) => project.projectId));
  const projectByName = new Map(projects.map((project) => [project.name.toLowerCase(), project]));
  const keyFor = (item: { projectId?: string | null; sourceName: string }): string | null => {
    if (item.projectId !== undefined && projectIds.has(item.projectId)) return item.projectId;
    const named = projectByName.get(item.sourceName.toLowerCase());
    return named?.projectId ?? null;
  };

  const pendingByProject = new Map<string | null, InboxInteractionDto[]>();
  const activeByProject = new Map<string | null, InboxLiveActivityDto[]>();
  for (const item of pending) {
    const key = keyFor(item);
    pendingByProject.set(key, [...(pendingByProject.get(key) ?? []), item]);
  }
  for (const item of active) {
    const key = keyFor(item);
    activeByProject.set(key, [...(activeByProject.get(key) ?? []), item]);
  }

  const groups = projects.map((project) => ({
    project,
    pending: pendingByProject.get(project.projectId) ?? [],
    active: activeByProject.get(project.projectId) ?? [],
  }));

  if (!projectIds.has(null) && (pendingByProject.has(null) || activeByProject.has(null))) {
    const unfiledPending = pendingByProject.get(null) ?? [];
    const unfiledActive = activeByProject.get(null) ?? [];
    groups.push({
      project: {
        projectId: null,
        name: "Other",
        unreadCount: 0,
        totalCount: 0,
        latestTitle: null,
        latestPreview: null,
        latestImageUrl:
          unfiledPending[0]?.sourceImageUrl ?? unfiledActive[0]?.sourceImageUrl ?? null,
        latestAt: null,
      },
      pending: unfiledPending,
      active: unfiledActive,
    });
  }

  return groups;
}

function ActivityPicker({
  value,
  onChange,
}: {
  value: ActivityFilter;
  onChange: (value: ActivityFilter) => void;
}) {
  const options: Array<{ label: string; value: ActivityFilter }> = [
    { label: "All", value: "all" },
    { label: "Notifications", value: "notification" },
    { label: "Live Activities", value: "live_activity" },
    { label: "Responses", value: "response" },
  ];
  return (
    <ScrollView
      horizontal
      contentContainerStyle={styles.activityPicker}
      showsHorizontalScrollIndicator={false}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
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
    </ScrollView>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const start = page * ACTIVITY_PAGE_SIZE + 1;
  const end = Math.min((page + 1) * ACTIVITY_PAGE_SIZE, total);
  return (
    <View style={styles.pagination}>
      <Pressable
        accessibilityLabel="Previous activity page"
        accessibilityRole="button"
        disabled={page === 0}
        onPress={() => onPageChange(page - 1)}
        style={({ pressed }) => [
          styles.pageButton,
          page === 0 && styles.pageButtonDisabled,
          pressed && page > 0 && styles.iconButtonPressed,
        ]}
      >
        <SymbolView name="chevron.left" size={14} tintColor={colors.ink} weight="semibold" />
      </Pressable>
      <Text style={styles.pageText}>
        {start}–{end} of {total}
      </Text>
      <Pressable
        accessibilityLabel="Next activity page"
        accessibilityRole="button"
        disabled={page === pageCount - 1}
        onPress={() => onPageChange(page + 1)}
        style={({ pressed }) => [
          styles.pageButton,
          page === pageCount - 1 && styles.pageButtonDisabled,
          pressed && page < pageCount - 1 && styles.iconButtonPressed,
        ]}
      >
        <SymbolView name="chevron.right" size={14} tintColor={colors.ink} weight="semibold" />
      </Pressable>
    </View>
  );
}

function PendingRow({
  item,
  first,
  replying,
  reply,
  onReplyChange,
  onStartReply,
  onCancelReply,
  onResolve,
  responding,
}: {
  item: InboxInteractionDto;
  first: boolean;
  replying: boolean;
  reply: string;
  onReplyChange: (value: string) => void;
  onStartReply: () => void;
  onCancelReply: () => void;
  onResolve: (action: "approve" | "deny" | "yes" | "no" | "reply", response?: string) => void;
  responding: boolean;
}) {
  return (
    <View style={[styles.pendingRow, first && styles.firstRow]}>
      <View style={styles.itemLayout}>
        <SourceAvatar url={item.sourceImageUrl} />
        <View style={styles.itemCopy}>
          <View style={styles.rowTopLine}>
            <Text style={styles.itemSource}>{item.sourceName}</Text>
            <Text style={styles.itemTime}>{relativeTime(item.createdAt)}</Text>
          </View>
          <Text style={styles.itemTitle}>{item.title}</Text>
          <Text style={styles.itemPrompt}>{item.prompt}</Text>
          <View style={styles.expirationRow}>
            <SymbolView name="clock" size={11} tintColor={colors.soft} />
            <Text style={styles.expirationText}>{timeRemaining(item.expiresAt)}</Text>
          </View>
        </View>
      </View>

      {item.kind === "approval" ? (
        <View style={styles.actions}>
          <ActionButton
            disabled={responding}
            label={item.secondaryLabel ?? "Deny"}
            onPress={() => onResolve("deny")}
            secondary
          />
          <ActionButton
            disabled={responding}
            label={responding ? "Sending…" : (item.primaryLabel ?? "Approve")}
            onPress={() => onResolve("approve")}
          />
        </View>
      ) : item.kind === "yes_no" ? (
        <View style={styles.actions}>
          <ActionButton
            disabled={responding}
            label={item.secondaryLabel ?? "No"}
            onPress={() => onResolve("no")}
            secondary
          />
          <ActionButton
            disabled={responding}
            label={responding ? "Sending…" : (item.primaryLabel ?? "Yes")}
            onPress={() => onResolve("yes")}
          />
        </View>
      ) : replying ? (
        <View style={styles.replyArea}>
          <TextInput
            autoFocus
            multiline
            onChangeText={onReplyChange}
            placeholder="Write a response"
            placeholderTextColor={colors.soft}
            style={styles.replyInput}
            value={reply}
          />
          <View style={styles.replyFooter}>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={onCancelReply}
              style={({ pressed }) => pressed && styles.textButtonPressed}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!reply.trim() || responding}
              onPress={() => onResolve("reply", reply)}
              style={({ pressed }) => [
                styles.sendButton,
                (!reply.trim() || responding) && styles.sendButtonDisabled,
                pressed && reply.trim() && !responding && styles.buttonPressed,
              ]}
            >
              <SymbolView name="arrow.up" size={15} tintColor="#FFFFFF" weight="semibold" />
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={responding}
          onPress={onStartReply}
          style={({ pressed }) => [styles.replyButton, pressed && styles.secondaryButtonPressed]}
        >
          <SymbolView name="arrow.turn.down.left" size={14} tintColor={colors.accent} />
          <Text style={styles.replyButtonText}>Reply</Text>
        </Pressable>
      )}
    </View>
  );
}

function ProjectGroup({
  item,
  pending,
  active,
  reply,
  replyingTo,
  respondingTo,
  onOpen,
  onReplyChange,
  onStartReply,
  onCancelReply,
  onResolve,
}: {
  item: InboxProjectSummaryDto;
  pending: InboxInteractionDto[];
  active: InboxLiveActivityDto[];
  reply: string;
  replyingTo: string | null;
  respondingTo: string | null;
  onOpen: () => void;
  onReplyChange: (value: string) => void;
  onStartReply: (id: string) => void;
  onCancelReply: () => void;
  onResolve: (
    item: InboxInteractionDto,
    action: "approve" | "deny" | "yes" | "no" | "reply",
    response?: string,
  ) => void;
}) {
  const hasLiveContent = pending.length > 0 || active.length > 0;
  return (
    <View style={styles.projectGroup}>
      <ProjectRow item={item} onPress={onOpen} showPreview={!hasLiveContent} />
      {pending.map((interaction) => (
        <ProjectInteraction
          item={interaction}
          key={interaction.id}
          onCancelReply={onCancelReply}
          onReplyChange={onReplyChange}
          onResolve={(action, response) => onResolve(interaction, action, response)}
          onStartReply={() => onStartReply(interaction.id)}
          reply={reply}
          replying={replyingTo === interaction.id}
          responding={respondingTo === interaction.id}
        />
      ))}
      {active.map((activity) => (
        <ProjectActivity item={activity} key={activity.id} />
      ))}
    </View>
  );
}

function ProjectInteraction({
  item,
  replying,
  reply,
  responding,
  onReplyChange,
  onStartReply,
  onCancelReply,
  onResolve,
}: {
  item: InboxInteractionDto;
  replying: boolean;
  reply: string;
  responding: boolean;
  onReplyChange: (value: string) => void;
  onStartReply: () => void;
  onCancelReply: () => void;
  onResolve: (action: "approve" | "deny" | "yes" | "no" | "reply", response?: string) => void;
}) {
  const actionButtons =
    item.kind === "approval" ? (
      <View style={styles.projectActionButtons}>
        <ActionButton
          compact
          disabled={responding}
          label={item.secondaryLabel ?? "Deny"}
          onPress={() => onResolve("deny")}
          secondary
        />
        <ActionButton
          compact
          disabled={responding}
          label={responding ? "Sending…" : (item.primaryLabel ?? "Approve")}
          onPress={() => onResolve("approve")}
        />
      </View>
    ) : item.kind === "yes_no" ? (
      <View style={styles.projectActionButtons}>
        <ActionButton
          compact
          disabled={responding}
          label={item.secondaryLabel ?? "No"}
          onPress={() => onResolve("no")}
          secondary
        />
        <ActionButton
          compact
          disabled={responding}
          label={responding ? "Sending…" : (item.primaryLabel ?? "Yes")}
          onPress={() => onResolve("yes")}
        />
      </View>
    ) : (
      <Pressable
        accessibilityRole="button"
        disabled={responding}
        hitSlop={{ top: 5, bottom: 5 }}
        onPress={onStartReply}
        style={({ pressed }) => [
          styles.compactReplyButton,
          pressed && styles.secondaryButtonPressed,
        ]}
      >
        <SymbolView name="arrow.turn.down.left" size={14} tintColor={colors.accent} />
        <Text style={styles.replyButtonText}>Reply</Text>
      </Pressable>
    );

  return (
    <View style={styles.projectChild}>
      <Text style={styles.projectActionTitle}>{item.title}</Text>
      <Text style={styles.projectActionPrompt}>{item.prompt}</Text>
      {replying && item.kind === "reply" ? (
        <View style={styles.projectReplyArea}>
          <TextInput
            autoFocus
            multiline
            onChangeText={onReplyChange}
            placeholder="Write a response"
            placeholderTextColor={colors.soft}
            style={styles.replyInput}
            value={reply}
          />
          <View style={styles.replyFooter}>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={onCancelReply}
              style={({ pressed }) => pressed && styles.textButtonPressed}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!reply.trim() || responding}
              onPress={() => onResolve("reply", reply)}
              style={({ pressed }) => [
                styles.sendButton,
                (!reply.trim() || responding) && styles.sendButtonDisabled,
                pressed && reply.trim() && !responding && styles.buttonPressed,
              ]}
            >
              <SymbolView name="arrow.up" size={15} tintColor="#FFFFFF" weight="semibold" />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.projectActionFooter}>
          <View style={styles.projectActionMeta}>
            <SymbolView name="clock" size={11} tintColor={colors.muted} />
            <Text numberOfLines={1} style={styles.projectActionMetaText}>
              {timeRemaining(item.expiresAt)} · {item.sourceName}
            </Text>
          </View>
          {actionButtons}
        </View>
      )}
    </View>
  );
}

function ProjectActivity({ item }: { item: InboxLiveActivityDto }) {
  const progress = item.props.progress;
  return (
    <View style={styles.projectChild}>
      <View style={styles.rowTopLine}>
        <Text style={styles.projectActionTitle}>{item.props.title}</Text>
        {progress !== undefined ? (
          <Text style={styles.activePercent}>{Math.round(progress * 100)}%</Text>
        ) : null}
      </View>
      <Text style={styles.projectActionPrompt}>{item.props.detail ?? item.props.status}</Text>
      {progress !== undefined ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

function ProjectRow({
  item,
  onPress,
  showPreview,
}: {
  item: InboxProjectSummaryDto;
  onPress: () => void;
  showPreview: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.unreadCount} unread`}
      onPress={onPress}
      style={({ pressed }) => [styles.projectRow, pressed && styles.projectRowPressed]}
    >
      <ProjectThumbnail name={item.name} url={item.latestImageUrl} />
      <View style={styles.projectCopy}>
        <View style={styles.rowTopLine}>
          <Text numberOfLines={1} style={styles.projectName}>
            {item.name}
          </Text>
          {item.latestAt ? (
            <Text style={styles.itemTime}>{relativeTime(item.latestAt)}</Text>
          ) : null}
        </View>
        {showPreview ? (
          <Text numberOfLines={1} style={styles.projectPreview}>
            {item.latestPreview ?? "No notifications yet"}
          </Text>
        ) : null}
      </View>
      {item.unreadCount > 0 ? (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadBadgeText}>
            {item.unreadCount > 99 ? "99+" : item.unreadCount}
          </Text>
        </View>
      ) : null}
      <SymbolView name="chevron.right" size={11} tintColor={colors.soft} weight="semibold" />
    </Pressable>
  );
}

function ProjectThumbnail({ name, url }: { name: string; url?: string | null }) {
  if (url) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={{ uri: url }}
        style={styles.projectThumbnail}
      />
    );
  }
  return (
    <View style={[styles.projectThumbnail, styles.projectThumbnailFallback]}>
      <Text style={styles.projectThumbnailText}>{name.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function ActiveRow({ item, first }: { item: InboxLiveActivityDto; first: boolean }) {
  const progress = item.props.progress;
  return (
    <View style={[styles.activeRow, first && styles.firstRow]}>
      <SourceAvatar url={item.sourceImageUrl} />
      <View style={styles.activeCopy}>
        <View style={styles.rowTopLine}>
          <Text style={styles.itemSource}>{item.sourceName}</Text>
          {progress !== undefined ? (
            <Text style={styles.activePercent}>{Math.round(progress * 100)}%</Text>
          ) : null}
        </View>
        <Text style={styles.itemTitle}>{item.props.title}</Text>
        <Text style={styles.itemPrompt} numberOfLines={1}>
          {item.props.detail ?? item.props.status}
        </Text>
        {progress !== undefined ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ActivityRow({ item, first }: { item: InboxActivityDto; first: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const expandable = item.detail !== null && item.detail.length > 0;
  return (
    <Pressable
      accessibilityRole={expandable ? "button" : undefined}
      disabled={!expandable}
      onPress={() => setExpanded((current) => !current)}
      style={[styles.recentRow, first && styles.firstRow, expanded && styles.recentRowExpanded]}
    >
      <SourceAvatar size={30} url={item.sourceImageUrl} />
      <View style={styles.recentCopy}>
        <Text style={styles.recentTitle} numberOfLines={expanded ? undefined : 1}>
          {item.title}
        </Text>
        {expandable ? (
          <Text style={styles.recentDetail} numberOfLines={expanded ? undefined : 1}>
            {item.detail}
          </Text>
        ) : null}
        <Text style={styles.recentMeta} numberOfLines={1}>
          {item.sourceName} · {activityKindLabel(item.kind)} · {formatActivityTime(item.createdAt)}
        </Text>
      </View>
      {item.result ? (
        <View style={styles.resultGroup}>
          <SymbolView name="checkmark" size={11} tintColor={colors.accent} weight="semibold" />
          <Text style={styles.resultText}>{item.result}</Text>
        </View>
      ) : null}
      {expandable ? (
        <SymbolView
          name={expanded ? "chevron.up" : "chevron.down"}
          size={11}
          tintColor={colors.soft}
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}

function SourceAvatar({ size = 40, url }: { size?: number; url?: string | null }) {
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri: url ?? PLACEHOLDER_AVATAR_URL }}
      style={[styles.sourceAvatar, { width: size, height: size, borderRadius: size / 2 }]}
    />
  );
}

function ActionButton({
  label,
  onPress,
  secondary,
  disabled,
  compact,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={compact ? { top: 5, bottom: 5 } : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        compact && styles.compactActionButton,
        secondary && styles.secondaryAction,
        disabled && styles.sendButtonDisabled,
        pressed && (secondary ? styles.secondaryButtonPressed : styles.buttonPressed),
      ]}
    >
      <Text style={[styles.actionLabel, secondary && styles.secondaryActionLabel]}>{label}</Text>
    </Pressable>
  );
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function timeRemaining(value: string): string {
  const minutes = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
}

function activityKindLabel(kind: InboxActivityKind): string {
  if (kind === "live_activity") return "Live Activity";
  if (kind === "response") return "Response";
  return "Notification";
}

function formatActivityTime(value: string): string {
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
  scroll: {
    ...readableColumn,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  brandRow: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: -12,
  },
  brand: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 17,
    letterSpacing: tightTracking(17),
  },
  settingsButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  activityPicker: {
    gap: 6,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
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
    paddingVertical: 30,
  },
  emptyActivity: {
    paddingVertical: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  activeRow: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  activeCopy: {
    minWidth: 0,
    flex: 1,
  },
  activePercent: {
    color: colors.accent,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  progressTrack: {
    height: 3,
    marginTop: 9,
    overflow: "hidden",
    borderRadius: 2,
    backgroundColor: colors.line,
  },
  progressFill: {
    width: "72%",
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  firstRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  projectSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#D8D6CE",
  },
  projectGroup: {
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#D8D6CE",
  },
  projectRow: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  projectRowPressed: {
    opacity: 0.7,
  },
  projectCopy: {
    minWidth: 0,
    flex: 1,
  },
  projectName: {
    flexShrink: 1,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: tightTracking(15),
  },
  projectPreview: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  projectThumbnail: {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#0000001A",
    backgroundColor: colors.line,
  },
  projectThumbnailFallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  projectThumbnailText: {
    color: colors.accent,
    fontFamily: fonts.semibold,
    fontSize: 15,
    letterSpacing: tightTracking(15),
  },
  projectChild: {
    paddingTop: 5,
    paddingBottom: 7,
  },
  projectActionTitle: {
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 19,
    letterSpacing: tightTracking(14),
  },
  projectActionPrompt: {
    marginTop: 3,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tightTracking(13),
  },
  projectActionFooter: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
  },
  projectActionMeta: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  projectActionMetaText: {
    flex: 1,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 11,
    letterSpacing: tightTracking(11),
  },
  projectActionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  compactActionButton: {
    minWidth: 72,
    minHeight: 34,
    flex: 0,
    paddingHorizontal: 14,
    borderRadius: 17,
  },
  compactReplyButton: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D6D3CC",
    borderRadius: 17,
    backgroundColor: "#F2F1ED",
  },
  projectReplyArea: {
    marginTop: 10,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: colors.accent,
  },
  unreadBadgeText: {
    color: "#FFFFFF",
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  historyRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  historyText: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  pendingRow: {
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  itemLayout: {
    flexDirection: "row",
    gap: 12,
  },
  sourceAvatar: {
    flexShrink: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#0000001A",
    backgroundColor: colors.line,
  },
  itemCopy: {
    minWidth: 0,
    flex: 1,
  },
  rowTopLine: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 10,
  },
  itemSource: {
    flex: 1,
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: tightTracking(12),
  },
  itemTime: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 11,
    letterSpacing: tightTracking(11),
  },
  itemTitle: {
    marginTop: 2,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: tightTracking(15),
  },
  itemPrompt: {
    marginTop: 4,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: tightTracking(14),
  },
  expirationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 7,
  },
  expirationText: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 11,
    letterSpacing: tightTracking(11),
  },
  actions: {
    flexDirection: "row",
    gap: 9,
    marginTop: 14,
    marginLeft: 52,
  },
  actionButton: {
    minHeight: 42,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: colors.accent,
  },
  secondaryAction: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D6D3CC",
    backgroundColor: "#F2F1ED",
  },
  actionLabel: {
    color: "#FFFFFF",
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  secondaryActionLabel: {
    color: colors.ink,
  },
  replyButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 14,
    marginLeft: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 21,
    backgroundColor: colors.surface,
  },
  replyButtonText: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  replyArea: {
    marginTop: 14,
    marginLeft: 52,
  },
  replyInput: {
    minHeight: 82,
    maxHeight: 140,
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: tightTracking(14),
    textAlignVertical: "top",
  },
  replyFooter: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 5,
  },
  cancelText: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  sendButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: colors.accent,
  },
  sendButtonDisabled: {
    opacity: 0.35,
  },
  recentRow: {
    minHeight: 65,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  recentCopy: {
    minWidth: 0,
    flex: 1,
  },
  recentTitle: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: tightTracking(13),
  },
  recentRowExpanded: {
    paddingVertical: 12,
  },
  recentDetail: {
    marginTop: 2,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: tightTracking(12),
  },
  recentMeta: {
    marginTop: 2,
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: tightTracking(11),
  },
  resultGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  resultText: {
    color: colors.accent,
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: tightTracking(11),
  },
  pagination: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pageButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  pageButtonDisabled: {
    opacity: 0.25,
  },
  pageText: {
    minWidth: 78,
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 12,
    textAlign: "center",
    letterSpacing: tightTracking(12),
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.96 }],
  },
  secondaryButtonPressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.96 }],
  },
  iconButtonPressed: {
    backgroundColor: "#F0EFEC",
    transform: [{ scale: 0.96 }],
  },
  textButtonPressed: {
    opacity: 0.6,
  },
});
