import type { InboxInteractionDto } from "@hark/contracts";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { type AccessibilityActionEvent, StyleSheet, View } from "react-native";
import { useLayout } from "../../lib/layout";
import { spoken } from "../../ui/a11y";
import { SourceAvatar } from "../../ui/avatar";
import { Button } from "../../ui/button";
import { Cell, useStackedRows } from "../../ui/list";
import { Text } from "../../ui/text";
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
  const { regular } = useLayout();
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
        style={styles.copy}
      >
        <View style={styles.sourceLine}>
          <SourceAvatar name={item.sourceName} size={24} url={item.sourceImageUrl} />
          <Text color="secondaryLabel" numberOfLines={1} style={styles.source} variant="footnote">
            <Text color="secondaryLabel" variant="footnote" weight="600">
              {item.sourceName}
            </Text>
            {projectName ? ` · ${projectName}` : ""}
          </Text>
          <Text color="tertiaryLabel" tabular variant="footnote">
            {relativeTime(item.createdAt, now)}
          </Text>
        </View>
        <Text numberOfLines={stacked ? undefined : 2} style={styles.measure} variant="headline">
          {item.title}
        </Text>
        <Text
          color="secondaryLabel"
          numberOfLines={stacked ? undefined : 6}
          style={styles.measure}
          variant="subheadline"
        >
          {item.prompt}
        </Text>
        <View style={styles.meta}>
          <SymbolView name="clock" size={12} tintColor={colors.tertiaryLabel} />
          <Text color="tertiaryLabel" tabular variant="footnote">
            {timeRemaining(item.expiresAt, now)}
          </Text>
        </View>
      </View>
      <View
        style={[styles.actions, regular && styles.actionsRegular, stacked && styles.actionsStacked]}
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
  copy: {
    gap: 2,
  },
  /** Long text keeps a readable line length on iPad. */
  measure: {
    maxWidth: metrics.measureWidth,
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
  /** Two answers stay button-sized on wide windows. */
  actionsRegular: {
    width: "100%",
    maxWidth: 480,
  },
  actionsStacked: {
    flexDirection: "column-reverse",
  },
  action: {
    flex: 1,
  },
});
