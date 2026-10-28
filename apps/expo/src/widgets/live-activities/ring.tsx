import { Gauge, HStack, Image, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  activityBackgroundTint,
  font,
  foregroundStyle,
  gaugeStyle,
  lineLimit,
  monospacedDigit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityLayout } from "expo-widgets";
import type { HarkLiveActivityEnvironment, HarkLiveActivityProps } from "./types";

export function RingLiveActivityStyle(
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

  // The native gauge's current-value label is dropped by the widget renderer,
  // so keep the percentage overlaid in a ZStack.
  const ringHero =
    props.progress !== undefined ? (
      <ZStack>
        <Gauge value={props.progress} modifiers={[gaugeStyle("circularCapacity"), tint(accent)]} />
        {percentage ? (
          <Text
            modifiers={[
              font({ size: 11, weight: "semibold" }),
              monospacedDigit(),
              foregroundStyle(accent),
            ]}
          >
            {percentage}
          </Text>
        ) : null}
      </ZStack>
    ) : (
      <Image systemName={symbol} color={accent} size={30} />
    );

  // In the expanded island the percentage sits top right like the other
  // progress styles, so the ring there carries no label of its own.
  const islandRing =
    props.progress !== undefined ? (
      <Gauge value={props.progress} modifiers={[gaugeStyle("circularCapacity"), tint(accent)]} />
    ) : (
      <Image systemName={symbol} color={accent} size={30} />
    );

  const banner = (
    <HStack
      spacing={13}
      modifiers={[
        padding({ horizontal: 16, vertical: 14 }),
        activityBackgroundTint("#0B1512"),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      {ringHero}
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ textStyle: "headline", weight: "semibold" }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {title}
        </Text>
        <Text
          modifiers={[
            font({ textStyle: "subheadline", weight: "medium" }),
            foregroundStyle(accent),
            lineLimit(1),
          ]}
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
      <Spacer />
    </HStack>
  );

  const expandedBottom = (
    <HStack
      spacing={14}
      modifiers={[
        padding({ leading: 7, trailing: 7, bottom: 7 }),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      {islandRing}
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[
            font({ textStyle: "headline", weight: "semibold" }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {title}
        </Text>
        <Text
          modifiers={[
            font({ textStyle: "subheadline", weight: "semibold" }),
            foregroundStyle(accent),
            lineLimit(1),
          ]}
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
      <Spacer />
    </HStack>
  );

  return {
    banner,
    bannerSmall: standard.bannerSmall,
    compactLeading: standard.compactLeading,
    compactTrailing: standard.compactTrailing,
    minimal: standard.minimal,
    expandedLeading: standard.expandedLeading,
    expandedTrailing: standard.expandedTrailing,
    expandedBottom,
  };
}
