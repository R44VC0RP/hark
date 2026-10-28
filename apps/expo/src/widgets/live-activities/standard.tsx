import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityElement,
  accessibilityLabel,
  activityBackgroundTint,
  fixedSize,
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

export function StandardLiveActivityStyle(
  props: HarkLiveActivityProps,
  _environment: HarkLiveActivityEnvironment,
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
      spacing={8}
      modifiers={[
        padding({ horizontal: 16, vertical: 14 }),
        activityBackgroundTint("#0B1512"),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      <HStack spacing={10}>
        <Image systemName={symbol} color={accent} size={20} />
        <VStack alignment="leading" spacing={2}>
          <Text
            modifiers={[
              font({ textStyle: "headline", weight: "semibold" }),
              foregroundStyle(primary),
              lineLimit(2),
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
        </VStack>
        <Spacer />
        {percentage ? (
          <Text
            modifiers={[
              font({ textStyle: "subheadline", weight: "semibold" }),
              monospacedDigit(),
              foregroundStyle(accent),
            ]}
          >
            {percentage}
          </Text>
        ) : null}
      </HStack>
      {detail ? (
        <Text
          modifiers={[font({ textStyle: "footnote" }), foregroundStyle(secondary), lineLimit(2)]}
        >
          {detail}
        </Text>
      ) : null}
      {linearBar}
    </VStack>
  );

  const bannerSmall = (
    <HStack spacing={8} modifiers={[padding({ all: 10 }), accessibilityElement("combine")]}>
      <Image systemName={symbol} color={accent} size={18} />
      <Text
        modifiers={[
          font({ textStyle: "subheadline", weight: "semibold" }),
          foregroundStyle(primary),
          lineLimit(1),
        ]}
      >
        {status}
      </Text>
      <Spacer />
      {percentage ? (
        <Text modifiers={[monospacedDigit(), foregroundStyle(accent)]}>{percentage}</Text>
      ) : null}
    </HStack>
  );

  const compactLeading = <Image systemName={symbol} color={accent} size={16} />;
  // The compact island grows with its trailing content, so a long status would
  // stretch it across the screen and truncate. Show the status only when it is
  // short; otherwise an ellipsis says the task is still running.
  const compactTrailing =
    percentage || status.length <= 8 ? (
      <Text
        modifiers={[
          font({ size: 12, weight: "semibold" }),
          monospacedDigit(),
          foregroundStyle(accent),
          lineLimit(1),
        ]}
      >
        {percentage ?? status}
      </Text>
    ) : (
      <Image systemName="ellipsis" color={accent} size={14} />
    );
  const minimal = (
    <Image
      systemName={symbol}
      color={accent}
      size={15}
      modifiers={[accessibilityLabel(`${title}, ${status}`)]}
    />
  );
  // The leading and trailing regions sit beside the camera and are only a few
  // characters wide, so they hold just the icon and percentage. The title
  // opens the full-width bottom region, aligned under the icon.
  const expandedLeading = (
    <Image
      systemName={symbol}
      color={accent}
      size={20}
      modifiers={[padding({ leading: 4, top: 2 })]}
    />
  );
  const expandedTrailing = percentage ? (
    <Text
      modifiers={[
        padding({ trailing: 4, top: 2 }),
        font({ textStyle: "headline", weight: "semibold" }),
        monospacedDigit(),
        foregroundStyle(accent),
        lineLimit(1),
        fixedSize({ horizontal: true }),
      ]}
    >
      {percentage}
    </Text>
  ) : undefined;
  const expandedBottom = (
    <VStack
      alignment="leading"
      spacing={7}
      modifiers={[
        padding({ horizontal: 4, vertical: 2 }),
        accessibilityElement("combine"),
        accessibilityLabel(a11ySummary),
      ]}
    >
      <VStack alignment="leading" spacing={1}>
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
      </VStack>
      {detail ? (
        <Text
          modifiers={[font({ textStyle: "footnote" }), foregroundStyle(secondary), lineLimit(2)]}
        >
          {detail}
        </Text>
      ) : null}
      {linearBar}
    </VStack>
  );

  return {
    banner,
    bannerSmall,
    compactLeading,
    compactTrailing,
    minimal,
    expandedLeading,
    expandedTrailing,
    expandedBottom,
  };
}
