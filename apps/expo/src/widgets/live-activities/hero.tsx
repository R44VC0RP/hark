import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  activityBackgroundTint,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  progressViewStyle,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityLayout } from "expo-widgets";
import type { HarkLiveActivityEnvironment, HarkLiveActivityProps } from "./types";

export function HeroLiveActivityStyle(
  props: HarkLiveActivityProps,
  _environment: HarkLiveActivityEnvironment,
  standard: LiveActivityLayout,
): LiveActivityLayout {
  "widget";
  const accent = props.accentColor ?? "#5ED8B7";
  const primary = "#F4FBF9";
  const secondary = "#B8C9C4";
  const title = props.privacyMode === "private" ? "Agent task" : props.title;
  const status = props.privacyMode === "private" ? "In progress" : props.status;
  const detail = props.privacyMode === "private" ? undefined : props.detail;
  const symbol =
    props.symbol === "code"
      ? "chevron.left.forwardslash.chevron.right"
      : props.symbol === "build"
        ? "gearshape.2.fill"
        : props.symbol === "success"
          ? "checkmark.circle.fill"
          : props.symbol === "warning"
            ? "exclamationmark.triangle.fill"
            : "terminal.fill";
  const percentage =
    props.progress === undefined ? undefined : `${Math.round(props.progress * 100)}%`;
  const a11ySummary = `${title}, ${status}${percentage ? `, ${percentage}` : ""}`;
  const linearBar =
    props.progress !== undefined ? (
      <ProgressView
        value={props.progress}
        modifiers={[progressViewStyle("linear"), tint(accent), frame({ maxWidth: Infinity })]}
      />
    ) : null;

  const banner = (
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[
        activityBackgroundTint("#0B1512"),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      <VStack
        alignment="leading"
        spacing={3}
        modifiers={[padding({ top: 13, leading: 16, trailing: 16, bottom: 12 })]}
      >
        <HStack spacing={8}>
          <Image systemName={symbol} color={accent} size={15} />
          <Spacer />
          {percentage ? (
            <Text
              modifiers={[
                font({ size: 13, weight: "semibold" }),
                monospacedDigit(),
                foregroundStyle(accent),
              ]}
            >
              {percentage}
            </Text>
          ) : null}
        </HStack>
        <Text
          modifiers={[font({ size: 22, weight: "bold" }), foregroundStyle(primary), lineLimit(1)]}
        >
          {status}
        </Text>
        {detail ? (
          <Text
            modifiers={[font({ textStyle: "footnote" }), foregroundStyle(secondary), lineLimit(1)]}
          >
            {detail}
          </Text>
        ) : null}
      </VStack>
      {linearBar}
    </VStack>
  );

  const expandedLeading = (
    <Image
      systemName={symbol}
      color={accent}
      size={20}
      modifiers={[padding({ leading: 7, top: 2 })]}
    />
  );

  const expandedBottom = (
    <VStack
      alignment="leading"
      spacing={7}
      modifiers={[
        padding({ leading: 7, trailing: 7, bottom: 7 }),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      <Text
        modifiers={[font({ size: 20, weight: "bold" }), foregroundStyle(primary), lineLimit(1)]}
      >
        {status}
      </Text>
      {linearBar}
    </VStack>
  );

  return {
    banner,
    bannerSmall: standard.bannerSmall,
    compactLeading: standard.compactLeading,
    compactTrailing: standard.compactTrailing,
    minimal: standard.minimal,
    expandedLeading,
    expandedTrailing: standard.expandedTrailing,
    expandedBottom,
  };
}
