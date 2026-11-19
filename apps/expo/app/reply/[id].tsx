import * as Device from "expo-device";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  type NavigationAction,
  useHeaderHeight,
  usePreventRemove,
  useRoute,
} from "expo-router/react-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionSheetIOS, findNodeHandle, StyleSheet, TextInput, View } from "react-native";
import { alertFailure, haptic } from "../../src/lib/haptics";
import {
  cachedInteraction,
  markInteractionHandled,
  replyDraft,
  saveReplyDraft,
} from "../../src/lib/inbox-cache";
import { submitInteractionResponse } from "../../src/lib/interactions";
import { useLayout } from "../../src/lib/layout";
import { setLeaveGuard } from "../../src/lib/navigation";
import { SourceAvatar } from "../../src/ui/avatar";
import { EmptyState } from "../../src/ui/empty-state";
import { List, useStackedRows } from "../../src/ui/list";
import { Text } from "../../src/ui/text";
import { colors, palette, space, typography } from "../../src/ui/tokens";

const simulatorPreview = __DEV__ && !Device.isDevice;

/**
 * The sheet header's height on iOS 26 (measured in the simulator). The
 * header height hook first reports 56 and corrects itself about 0.3 s later,
 * which slid the request down 8 to 14 pt while the sheet was opening.
 */
const SHEET_HEADER_HEIGHT = { compact: 70, regular: 64 } as const;

/**
 * Where the Cancel button sits in the sheet (measured in the simulator), so
 * the draft prompt raised by a swipe, a tap outside, Esc or a link points at
 * it on iPad, as Mail's does. iPhone action sheets ignore an anchor (React
 * Native leaves the source out there).
 */
const CANCEL_FRAME = { left: 16, top: 12, width: 44, height: 44 } as const;

type DraftChoice = "delete" | "save" | "keep";

/**
 * Reply to a request (DESIGN.md 5.5): a form sheet at half height that the
 * Inbox opens. Cancel leads, Send Reply is the prominent trailing item. The
 * request comes from the Inbox's cache, so a relaunch shows "Request
 * Unavailable" instead of guessing.
 */
export default function ReplySheet() {
  const router = useRouter();
  const { regular } = useLayout();
  const headerHeight = Math.max(
    useHeaderHeight(),
    SHEET_HEADER_HEIGHT[regular ? "regular" : "compact"],
  );
  const stacked = useStackedRows();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cached = cachedInteraction(String(id));
  // The draft outlives the sheet (per request, like Messages): closing it
  // and opening the same request again brings the text back.
  const [text, setText] = useState(() => replyDraft(String(id)));
  const [sending, setSending] = useState(false);
  const response = text.trim();
  const busy = useRef(false);
  // Set once the sheet may close without asking: sent, or the draft was
  // deleted or saved.
  const leaving = useRef(false);
  const hasDraft = Boolean(cached && response);
  const route = useRoute();
  const anchor = useRef<View>(null);
  // The draft prompt on screen, if any: everything that wants to close the
  // sheet while it is up waits for the same answer instead of asking again.
  const prompt = useRef<{ answer: Promise<DraftChoice>; resolve: (c: DraftChoice) => void } | null>(
    null,
  );

  const askAboutDraft = useCallback((): Promise<DraftChoice> => {
    if (prompt.current) return prompt.current.answer;
    let resolve: (choice: DraftChoice) => void = () => {};
    const answer = new Promise<DraftChoice>((settle) => {
      resolve = (choice) => {
        if (prompt.current?.answer === answer) prompt.current = null;
        settle(choice);
      };
    });
    prompt.current = { answer, resolve };
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Delete Draft", "Save Draft", "Keep Editing"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 2,
        anchor: findNodeHandle(anchor.current) ?? undefined,
      },
      (index) => resolve(index === 0 ? "delete" : index === 1 ? "save" : "keep"),
    );
    return answer;
  }, []);

  /** Closes the sheet once, deleting or keeping the draft, without asking again. */
  const leave = useCallback(
    (choice: "delete" | "save", action?: NavigationAction) => {
      if (choice === "delete") saveReplyDraft(String(id), "");
      if (leaving.current) return;
      leaving.current = true;
      if (action) navigation.dispatch(action);
      else navigation.goBack();
    },
    [id, navigation],
  );

  // With unsent text the sheet can't be swiped or tapped away by accident
  // (`preventNativeDismiss`, UIKit's `isModalInPresentation`). A swipe, a
  // tap outside, Esc or anything else that would close it asks first, as
  // Mail does: delete the draft, keep it for later, or keep editing.
  usePreventRemove(hasDraft, ({ data }) => {
    if (leaving.current) {
      navigation.dispatch(data.action);
      return;
    }
    if (busy.current) return;
    void askAboutDraft().then((choice) => {
      if (choice !== "keep") leave(choice, data.action);
    });
  });

  // A link that would close the sheet (`src/lib/navigation.ts`) asks the
  // same question and waits: it opens once the sheet has closed, and is
  // dropped on Keep Editing. Esc and ⌘W close the prompt as Keep Editing.
  useEffect(() => {
    if (!hasDraft) return;
    return setLeaveGuard(route.key, {
      ask: async () => {
        if (leaving.current) return true;
        const choice = await askAboutDraft();
        if (choice === "keep") return false;
        leave(choice);
        return true;
      },
      cancel: () => {
        const open = prompt.current;
        if (!open) return false;
        ActionSheetIOS.dismissActionSheet();
        open.resolve("keep");
        return true;
      },
    });
  }, [askAboutDraft, hasDraft, leave, route.key]);

  const edit = (value: string) => {
    setText(value);
    saveReplyDraft(String(id), value);
  };

  const send = async () => {
    if (!cached || busy.current || !response) return;
    busy.current = true;
    setSending(true);
    try {
      const { interaction } = cached;
      if (!simulatorPreview) {
        await submitInteractionResponse(interaction.id, {
          action: "reply",
          response,
          actionDigest: interaction.actionDigest,
        });
      }
      haptic.success();
      // No list animation here: this sheet is closing, and Fabric's
      // LayoutAnimation aborts the app when the same commit removes the sheet
      // (checked in the simulator). The Inbox row shows "Replied" in place.
      markInteractionHandled(interaction, "reply");
      leaving.current = true;
      router.back();
    } catch (error) {
      alertFailure("Couldn’t Send Reply", error);
      busy.current = false;
      setSending(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Reply" }} />
      <Stack.Toolbar placement="left">
        {hasDraft ? (
          // With a draft, Cancel asks from the button itself, like Mail;
          // a tap outside the menu keeps editing.
          <Stack.Toolbar.Menu accessibilityLabel="Cancel" icon="xmark">
            <Stack.Toolbar.MenuAction destructive icon="trash" onPress={() => leave("delete")}>
              Delete Draft
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction icon="tray.and.arrow.down" onPress={() => leave("save")}>
              Save Draft
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        ) : (
          <Stack.Toolbar.Button
            accessibilityLabel="Cancel"
            icon="xmark"
            onPress={() => router.back()}
          />
        )}
      </Stack.Toolbar>
      {cached ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            accessibilityLabel={sending ? "Sending Reply" : "Send Reply"}
            disabled={!response || sending}
            icon="arrow.up"
            onPress={() => void send()}
            tintColor={palette.accent}
            variant="prominent"
          />
        </Stack.Toolbar>
      ) : null}
      {/*
        At the half-height detent iOS lays the first frame out before the
        sheet's header exists, so the request would start under the header
        (checked in the simulator). The header height is applied by hand,
        plus 16 pt so the first line also clears the soft edge's fade.
      */}
      <List
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingTop: headerHeight + space.m }}
        contentInsetAdjustmentBehavior="never"
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        {cached ? (
          <>
            <View accessible style={styles.context}>
              <View style={styles.source}>
                <SourceAvatar
                  name={cached.interaction.sourceName}
                  size={24}
                  url={cached.interaction.sourceImageUrl}
                />
                <Text
                  color="secondaryLabel"
                  numberOfLines={stacked ? undefined : 1}
                  style={styles.flex}
                  variant="footnote"
                >
                  <Text color="secondaryLabel" variant="footnote" weight="600">
                    {cached.interaction.sourceName}
                  </Text>
                  {cached.projectName ? ` · ${cached.projectName}` : ""}
                </Text>
              </View>
              <Text variant="headline">{cached.interaction.title}</Text>
              <Text color="secondaryLabel" variant="subheadline">
                {cached.interaction.prompt}
              </Text>
            </View>
            <TextInput
              accessibilityLabel="Reply"
              autoFocus
              editable={!sending}
              multiline
              onChangeText={edit}
              placeholder="Write a reply"
              placeholderTextColor={colors.placeholder}
              scrollEnabled={false}
              selectionColor={palette.accent}
              style={styles.input}
              value={text}
            />
          </>
        ) : (
          <EmptyState
            message="It was answered or it expired."
            symbol="arrowshape.turn.up.left"
            title="Request Unavailable"
          />
        )}
      </List>
      {/* Where the draft prompt points on iPad: the Cancel button's frame. */}
      <View collapsable={false} pointerEvents="none" ref={anchor} style={styles.cancelAnchor} />
    </>
  );
}

const styles = StyleSheet.create({
  cancelAnchor: {
    position: "absolute",
    ...CANCEL_FRAME,
  },
  context: {
    gap: space.xxs,
  },
  source: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    marginBottom: space.xxs,
  },
  flex: {
    flex: 1,
  },
  input: {
    minHeight: 120,
    marginTop: space.m,
    padding: 0,
    color: colors.label,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
  },
});
