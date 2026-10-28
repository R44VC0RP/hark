import { Capsule, HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  activityBackgroundTint,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityLayout } from "expo-widgets";
import type { HarkLiveActivityEnvironment, HarkLiveActivityProps } from "./types";

export function StepsLiveActivityStyle(
  props: HarkLiveActivityProps,
  _environment: HarkLiveActivityEnvironment,
  standard: LiveActivityLayout,
): LiveActivityLayout {
  "widget";
  const accent = props.accentColor ?? "#5ED8B7";
  const primary = "#F4FBF9";
  const secondary = "#B8C9C4";
  const track = "#FFFFFF29";
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
  const stepsValue = (props.progress ?? 0) + 0.000000001;
  const pip1 = stepsValue >= 0.2 ? accent : track;
  const pip2 = stepsValue >= 0.4 ? accent : track;
  const pip3 = stepsValue >= 0.6 ? accent : track;
  const pip4 = stepsValue >= 0.8 ? accent : track;
  const pip5 = stepsValue >= 1 ? accent : track;
  const stepsPips = (
    <HStack spacing={5}>
      <Capsule modifiers={[frame({ height: 5, maxWidth: Infinity }), foregroundStyle(pip1)]} />
      <Capsule modifiers={[frame({ height: 5, maxWidth: Infinity }), foregroundStyle(pip2)]} />
      <Capsule modifiers={[frame({ height: 5, maxWidth: Infinity }), foregroundStyle(pip3)]} />
      <Capsule modifiers={[frame({ height: 5, maxWidth: Infinity }), foregroundStyle(pip4)]} />
      <Capsule modifiers={[frame({ height: 5, maxWidth: Infinity }), foregroundStyle(pip5)]} />
    </HStack>
  );

  const banner = (
    <VStack
      alignment="leading"
      spacing={9}
      modifiers={[
        padding({ horizontal: 16, vertical: 14 }),
        activityBackgroundTint("#0B1512"),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      <HStack spacing={10}>
        <Image systemName={symbol} color={accent} size={19} />
        <Text
          modifiers={[
            font({ textStyle: "headline", weight: "semibold" }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {title}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ textStyle: "subheadline", weight: "semibold" }),
            foregroundStyle(accent),
            lineLimit(1),
          ]}
        >
          {status}
        </Text>
      </HStack>
      {props.progress !== undefined ? stepsPips : null}
      {detail ? (
        <Text
          modifiers={[font({ textStyle: "footnote" }), foregroundStyle(secondary), lineLimit(2)]}
        >
          {detail}
        </Text>
      ) : null}
    </VStack>
  );

  const expandedTrailing = (
    <Text
      modifiers={[
        padding({ trailing: 4 }),
        font({ textStyle: "subheadline", weight: "semibold" }),
        foregroundStyle(accent),
        lineLimit(1),
      ]}
    >
      {status}
    </Text>
  );

  const expandedBottom = (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[
        padding({ horizontal: 4, vertical: 2 }),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      {props.progress !== undefined ? stepsPips : null}
      {detail ? (
        <Text
          modifiers={[font({ textStyle: "footnote" }), foregroundStyle(secondary), lineLimit(2)]}
        >
          {detail}
        </Text>
      ) : null}
    </VStack>
  );

  return {
    banner,
    bannerSmall: standard.bannerSmall,
    compactLeading: standard.compactLeading,
    compactTrailing: standard.compactTrailing,
    minimal: standard.minimal,
    expandedLeading: standard.expandedLeading,
    // standard's leading region is icon-only, so the title sits below the camera.
    expandedCenter: (
      <Text
        modifiers={[
          font({ textStyle: "headline", weight: "semibold" }),
          foregroundStyle(primary),
          lineLimit(1),
        ]}
      >
        {title}
      </Text>
    ),
    expandedTrailing,
    expandedBottom,
  };
}
