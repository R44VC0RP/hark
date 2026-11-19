import * as Device from "expo-device";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { haptic } from "../../src/lib/haptics";
import { cachedInteraction, markInteractionHandled } from "../../src/lib/inbox-cache";
import { submitInteractionResponse } from "../../src/lib/interactions";
import { useLayout } from "../../src/lib/layout";
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const cached = cachedInteraction(String(id));
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const response = text.trim();

  const send = async () => {
    if (!cached || sending || !response) return;
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
      // (checked in the simulator). The Inbox row just goes.
      markInteractionHandled(interaction.id);
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert(
        "Couldn't Send Reply",
        error instanceof Error ? error.message : "Check your connection, then try again.",
      );
      setSending(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Reply" }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          accessibilityLabel="Cancel"
          icon="xmark"
          onPress={() => router.back()}
        />
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
        style={styles.transparent}
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
              onChangeText={setText}
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
    </>
  );
}

const styles = StyleSheet.create({
  transparent: {
    backgroundColor: "transparent",
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
