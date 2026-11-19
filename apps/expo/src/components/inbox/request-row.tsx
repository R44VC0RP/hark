import type { InboxInteractionDto } from "@hark/contracts";
import { SymbolView } from "expo-symbols";
import { memo } from "react";
import { type AccessibilityActionEvent, StyleSheet, View } from "react-native";
import { formatAgo, formatTimeLeft, spokenTime } from "../../lib/dates";
import { type RequestAnswer, type RequestOutcome, useHasReplyDraft } from "../../lib/inbox-cache";
import { spoken } from "../../ui/a11y";
import { SourceAvatar } from "../../ui/avatar";
import { Button } from "../../ui/button";
import { Cell, useStackedRows, useTextMeasure } from "../../ui/list";
import { Text, useFontScale } from "../../ui/text";
import { colors, metrics, space } from "../../ui/tokens";
import { outcomeLine } from "./format";

export type RequestAction = Exclude<RequestAnswer, "reply">;

interface RequestRowProps {
  item: InboxInteractionDto;
  projectName: string | null;
  /** This row's response is being sent. */
  sending: boolean;
  /** Any response is being sent: every action waits. */
  busy: boolean;
  /**
   * The request stopped waiting while on screen (answered here or on
   * another device, expired, withdrawn): what happened shows where the
   * buttons were.
   */
  outcome: RequestOutcome | null;
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
 * Once it stops waiting, the row keeps its exact size and shows what
 * happened ("Approved", "Approved on another device", "Expired") over the
 * space its buttons held, which no longer take touches; the countdown goes
 * and the title quietens. Nothing moves, so a tap on its way can't land on
 * the next request.
 */
export const RequestRow = memo(function RequestRow({
  item,
  projectName,
  sending,
  busy,
  outcome,
  now,
  onRespond,
  onReply,
}: RequestRowProps) {
  const stacked = useStackedRows();
  const measure = useTextMeasure();
  const wide = measure !== null;
  const scale = useFontScale();
  // A saved reply shows on the button, as Mail and Messages mark drafts (P2-07).
  const draft = useHasReplyDraft(item.id);
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
  const result = outcome ? outcomeLine(outcome) : null;
  const label = spoken(
    item.title,
    item.prompt,
    source,
    result ? result.text : spokenTime(formatTimeLeft(item.expiresAt, now)),
    result?.note,
  );
  const actions = outcome
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
  const settled = outcome !== null;
  const inactive = busy || settled;
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
      <Text
        color={settled ? "secondaryLabel" : "label"}
        numberOfLines={stacked ? undefined : 2}
        variant="headline"
      >
        {item.title}
      </Text>
      <Text color="secondaryLabel" numberOfLines={stacked ? undefined : 6} variant="subheadline">
        {item.prompt}
      </Text>
      {/*
        Settled: the countdown no longer applies. An answer from another
        device says so in its place; otherwise the line keeps its space.
      */}
      {result?.note ? (
        <View importantForAccessibility="no-hide-descendants" style={styles.meta}>
          <Text color="secondaryLabel" variant="footnote">
            {result.note}
          </Text>
        </View>
      ) : (
        <View
          accessibilityElementsHidden={settled}
          importantForAccessibility={settled ? "no-hide-descendants" : "auto"}
          style={[styles.meta, settled && styles.spent]}
        >
          <SymbolView name="clock" size={Math.round(12 * scale)} tintColor={colors.tertiaryLabel} />
          <Text color="tertiaryLabel" tabular variant="footnote">
            {formatTimeLeft(item.expiresAt, now)}
          </Text>
        </View>
      )}
    </View>
  );
  const buttons = (
    <View style={styles.full}>
      {/*
        Settled: the buttons keep their space (so the row keeps its
        height) but are invisible, hidden from VoiceOver and take no
        touches; what happened sits on top of that space.
      */}
      <View
        accessibilityElementsHidden={settled}
        importantForAccessibility={settled ? "no-hide-descendants" : "auto"}
        pointerEvents={settled ? "none" : "auto"}
        style={[styles.actions, stacked && styles.actionsStacked, settled && styles.spent]}
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
            accessibilityHint={draft ? "Opens your saved reply" : "Opens a reply sheet"}
            disabled={inactive}
            onPress={() => onReply(item, projectName)}
            style={stacked ? null : styles.action}
            symbol={draft ? "pencil" : "arrowshape.turn.up.left"}
            title={draft ? "Edit Draft…" : "Reply…"}
            variant="bordered"
          />
        )}
      </View>
      {result ? <OutcomeLine {...result} scale={scale} trailing={wide} /> : null}
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

/**
 * "✓ Approved" (accent), "✕ Denied" or "Expired" (secondary) where the
 * buttons were: centred under the request, or on the trailing edge of a
 * wide row, where the time above it sits.
 */
function OutcomeLine({
  text,
  symbol,
  done,
  scale,
  trailing,
}: ReturnType<typeof outcomeLine> & { scale: number; trailing: boolean }) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={[styles.answer, trailing && styles.answerTrailing]}
    >
      <SymbolView
        name={symbol}
        size={Math.round(17 * scale)}
        tintColor={done ? colors.accent : colors.secondaryLabel}
      />
      <Text
        color={done ? "accent" : "secondaryLabel"}
        style={styles.answerText}
        variant="subheadline"
        weight="600"
      >
        {text}
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
  answerTrailing: {
    justifyContent: "flex-end",
  },
  answerText: {
    flexShrink: 1,
  },
});
