import type { InboxInteractionDto } from "@hark/contracts";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { type AccessibilityActionEvent, StyleSheet, View } from "react-native";
import { spoken } from "../../ui/a11y";
import { SourceAvatar } from "../../ui/avatar";
import { Button } from "../../ui/button";
import { Cell, useStackedRows } from "../../ui/list";
import { Text, useFontScale } from "../../ui/text";
import { colors, metrics, space } from "../../ui/tokens";
import { relativeTime, timeRemaining, timeRemainingSpoken } from "./format";

export type RequestAction = "approve" | "deny" | "yes" | "no";

interface RequestRowProps {
  item: InboxInteractionDto;
  projectName: string | null;
  /** This row's response is being sent. */
  sending: boolean;
  /** Any response is being sent: every action waits. */
  busy: boolean;
  /** Re-renders the relative times; pass the Inbox's minute tick. */
  now: number;
  onRespond: (item: InboxInteractionDto, action: RequestAction) => void;
  onReply: (item: InboxInteractionDto, projectName: string | null) => void;
}

/**
 * A request waiting on you (DESIGN.md 5.3): who asks, what, how long is
 * left, and its answers as flat buttons. The text is one VoiceOver element
 * with the answers as actions; the buttons stay separate elements.
 */
export const RequestRow = memo(function RequestRow({
  item,
  projectName,
  sending,
  busy,
  now,
  onRespond,
  onReply,
}: RequestRowProps) {
  const stacked = useStackedRows();
  const scale = useFontScale();
  const answers =
    item.kind === "approval"
      ? {
          primary: { action: "approve" as const, label: item.primaryLabel ?? "Approve" },
          secondary: { action: "deny" as const, label: item.secondaryLabel ?? "Deny" },
        }
      : item.kind === "yes_no"
        ? {
            primary: { action: "yes" as const, label: item.primaryLabel ?? "Yes" },
            secondary: { action: "no" as const, label: item.secondaryLabel ?? "No" },
          }
        : null;

  const source = projectName ? `${item.sourceName}, ${projectName}` : item.sourceName;
  const label = spoken(item.title, item.prompt, source, timeRemainingSpoken(item.expiresAt, now));
  const actions = answers
    ? [
        { name: answers.primary.action, label: answers.primary.label },
        { name: answers.secondary.action, label: answers.secondary.label },
      ]
    : [{ name: "reply", label: "Reply" }];
  const time = (
    <Text color="tertiaryLabel" tabular variant="footnote">
      {relativeTime(item.createdAt, now)}
    </Text>
  );
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (busy) return;
    if (name === "reply") onReply(item, projectName);
    else if (answers && (name === answers.primary.action || name === answers.secondary.action)) {
      onRespond(item, name);
    }
  };

  return (
    <Cell style={styles.row}>
      <View
        accessibilityActions={actions}
        accessibilityLabel={label}
        accessible
        onAccessibilityAction={onAccessibilityAction}
        style={[stacked ? styles.full : styles.column, styles.copy]}
      >
        <View style={styles.sourceLine}>
          <SourceAvatar name={item.sourceName} size={24} url={item.sourceImageUrl} />
          <Text
            color="secondaryLabel"
            numberOfLines={stacked ? undefined : 1}
            style={styles.source}
            variant="footnote"
          >
            <Text color="secondaryLabel" variant="footnote" weight="600">
              {item.sourceName}
            </Text>
            {projectName ? ` · ${projectName}` : ""}
          </Text>
          {stacked ? null : time}
        </View>
        {/* At accessibility sizes the time stacks under the source (3.6). */}
        {stacked ? time : null}
        <Text numberOfLines={stacked ? undefined : 2} variant="headline">
          {item.title}
        </Text>
        <Text color="secondaryLabel" numberOfLines={stacked ? undefined : 6} variant="subheadline">
          {item.prompt}
        </Text>
        <View style={styles.meta}>
          <SymbolView name="clock" size={Math.round(12 * scale)} tintColor={colors.tertiaryLabel} />
          <Text color="tertiaryLabel" tabular variant="footnote">
            {timeRemaining(item.expiresAt, now)}
          </Text>
        </View>
      </View>
      <View
        style={[
          stacked ? styles.full : styles.column,
          styles.actions,
          stacked && styles.actionsStacked,
        ]}
      >
        {answers ? (
          <>
            <Button
              disabled={busy}
              onPress={() => onRespond(item, answers.secondary.action)}
              style={stacked ? null : styles.action}
              title={answers.secondary.label}
              variant="bordered"
            />
            <Button
              busy={sending}
              busyTitle="Sending…"
              disabled={busy}
              onPress={() => onRespond(item, answers.primary.action)}
              style={stacked ? null : styles.action}
              title={answers.primary.label}
              variant="prominent"
            />
          </>
        ) : (
          <Button
            accessibilityHint="Opens a reply sheet"
            disabled={busy}
            onPress={() => onReply(item, projectName)}
            style={stacked ? null : styles.action}
            symbol="arrowshape.turn.up.left"
            title="Reply…"
            variant="bordered"
          />
        )}
      </View>
    </Cell>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.s,
    paddingVertical: space.s,
  },
  /**
   * On wide windows the whole request is one column (about 88 characters of
   * prompt per line) and the answers fill the same width, so text, time and
   * buttons share one right edge. A no-op on iPhone widths. At accessibility
   * text sizes the cap would leave about 25 characters per line, so the
   * request uses the full width instead.
   */
  column: {
    width: "100%",
    maxWidth: metrics.measureWidth,
  },
  full: {
    width: "100%",
  },
  copy: {
    gap: 2,
  },
  sourceLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    marginBottom: space.xxs,
  },
  source: {
    minWidth: 0,
    flex: 1,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xxs,
    marginTop: space.xxs,
  },
  actions: {
    flexDirection: "row",
    gap: space.xs,
  },
  actionsStacked: {
    flexDirection: "column-reverse",
  },
  action: {
    flex: 1,
  },
});
