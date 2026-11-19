import type { InboxInteractionDto } from "@hark/contracts";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { type AccessibilityActionEvent, StyleSheet, View } from "react-native";
import { formatAgo, formatTimeLeft, spokenTime } from "../../lib/dates";
import type { RequestAnswer } from "../../lib/inbox-cache";
import { spoken } from "../../ui/a11y";
import { SourceAvatar } from "../../ui/avatar";
import { Button } from "../../ui/button";
import { Cell, useStackedRows, useTextMeasure } from "../../ui/list";
import { Text, useFontScale } from "../../ui/text";
import { colors, metrics, space } from "../../ui/tokens";
import { ANSWER_LABELS, isRefusal } from "./format";

export type RequestAction = Exclude<RequestAnswer, "reply">;

interface RequestRowProps {
  item: InboxInteractionDto;
  projectName: string | null;
  /** This row's response is being sent. */
  sending: boolean;
  /** Any response is being sent: every action waits. */
  busy: boolean;
  /** Answered in this session: the answer shows where the buttons were. */
  answer: RequestAnswer | null;
  /** Re-renders the relative times; pass the Inbox's minute tick. */
  now: number;
  onRespond: (item: InboxInteractionDto, action: RequestAction) => void;
  onReply: (item: InboxInteractionDto, projectName: string | null) => void;
}

/**
 * A request waiting on you (DESIGN.md 5.3): who asks, what, how long is
 * left, and its answers as flat buttons. The text is one VoiceOver element
 * with the answers as actions; the buttons stay separate elements.
 *
 * Once answered, the row keeps its exact size and shows the answer
 * ("Approved") over the space its buttons held, which no longer take
 * touches. Nothing moves, so a second tap can't land on the next request.
 */
export const RequestRow = memo(function RequestRow({
  item,
  projectName,
  sending,
  busy,
  answer,
  now,
  onRespond,
  onReply,
}: RequestRowProps) {
  const stacked = useStackedRows();
  const measure = useTextMeasure();
  const wide = measure !== null;
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
  const result = answer ? ANSWER_LABELS[answer] : null;
  const label = spoken(
    item.title,
    item.prompt,
    source,
    result ?? spokenTime(formatTimeLeft(item.expiresAt, now)),
  );
  const actions = answer
    ? undefined
    : answers
      ? [
          { name: answers.primary.action, label: answers.primary.label },
          { name: answers.secondary.action, label: answers.secondary.label },
        ]
      : [{ name: "reply", label: "Reply" }];
  const time = (
    <Text color="tertiaryLabel" tabular variant="footnote">
      {formatAgo(item.createdAt, now)}
    </Text>
  );
  const inactive = busy || answer !== null;
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName;
    if (inactive) return;
    if (name === "reply") onReply(item, projectName);
    else if (answers && (name === answers.primary.action || name === answers.secondary.action)) {
      onRespond(item, name);
    }
  };

  const copy = (
    <View
      accessibilityActions={actions}
      accessibilityLabel={label}
      accessible
      onAccessibilityAction={onAccessibilityAction}
      style={[wide ? [styles.copyWide, measure] : styles.full, styles.copy]}
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
        {stacked || wide ? null : time}
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
          {formatTimeLeft(item.expiresAt, now)}
        </Text>
      </View>
    </View>
  );
  const buttons = (
    <View style={styles.full}>
      {/*
        Answered: the buttons keep their space (so the row keeps its
        height) but are invisible, hidden from VoiceOver and take no
        touches; the answer sits on top of that space.
      */}
      <View
        accessibilityElementsHidden={answer !== null}
        importantForAccessibility={answer ? "no-hide-descendants" : "auto"}
        pointerEvents={answer ? "none" : "auto"}
        style={[styles.actions, stacked && styles.actionsStacked, answer && styles.spent]}
      >
        {answers ? (
          <>
            <Button
              disabled={inactive}
              onPress={() => onRespond(item, answers.secondary.action)}
              style={stacked ? null : styles.action}
              title={answers.secondary.label}
              variant="bordered"
            />
            <Button
              busy={sending}
              busyTitle="Sending…"
              disabled={inactive}
              onPress={() => onRespond(item, answers.primary.action)}
              style={stacked ? null : styles.action}
              title={answers.primary.label}
              variant="prominent"
            />
          </>
        ) : (
          <Button
            accessibilityHint="Opens a reply sheet"
            disabled={inactive}
            onPress={() => onReply(item, projectName)}
            style={stacked ? null : styles.action}
            symbol="arrowshape.turn.up.left"
            title="Reply…"
            variant="bordered"
          />
        )}
      </View>
      {result ? <AnswerLine result={result} scale={scale} /> : null}
    </View>
  );

  // Regular width: the text keeps its reading measure on the leading side,
  // and the time and the answers take a fixed column on the trailing edge,
  // which Projects and In Progress share for their time, badge and percent.
  if (wide) {
    return (
      <Cell style={[styles.row, styles.rowWide]}>
        {copy}
        <View style={styles.trailing}>
          <View style={styles.timeWide}>{time}</View>
          {buttons}
        </View>
      </Cell>
    );
  }
  return (
    <Cell style={styles.row}>
      {copy}
      {buttons}
    </Cell>
  );
});

/** "✓ Approved" (accent) or "✕ Denied" (secondary), centred where the buttons were. */
function AnswerLine({ result, scale }: { result: string; scale: number }) {
  const refusal = isRefusal(result);
  return (
    <View importantForAccessibility="no-hide-descendants" style={styles.answer}>
      <SymbolView
        name={refusal ? "xmark.circle.fill" : "checkmark.circle.fill"}
        size={Math.round(17 * scale)}
        tintColor={refusal ? colors.secondaryLabel : colors.accent}
      />
      <Text color={refusal ? "secondaryLabel" : "accent"} variant="subheadline" weight="600">
        {result}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.s,
    paddingVertical: space.s,
    // Opaque like a table cell: when a row is removed, the rows sliding up
    // cover it while it fades, instead of their text crossing its text.
    backgroundColor: colors.cell,
  },
  /**
   * Wide windows: text on the leading side at the measure (about 88
   * characters of prompt per line, `useTextMeasure`), time and answers in a
   * fixed column on the row's trailing edge. At accessibility text sizes the
   * request stacks at full width instead, like on iPhone.
   */
  rowWide: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: space.xl,
  },
  copyWide: {
    minWidth: 0,
    flex: 1,
  },
  trailing: {
    width: metrics.trailingColumnWidth,
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  /** The time sits on the source line's centre (the 24-pt avatar). */
  timeWide: {
    minHeight: 24,
    justifyContent: "center",
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
  spent: {
    opacity: 0,
  },
  answer: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.xs,
  },
});
