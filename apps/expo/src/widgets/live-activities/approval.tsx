import { Button, HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  activityBackgroundTint,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityLayout } from "expo-widgets";
import type { HarkLiveActivityEnvironment, HarkLiveActivityProps } from "./types";

export function ApprovalLiveActivityStyle(
  props: HarkLiveActivityProps,
  environment: HarkLiveActivityEnvironment,
  standard: LiveActivityLayout,
): LiveActivityLayout {
  "widget";
  const accent = props.accentColor ?? "#5ED8B7";
  const primary = "#F4FBF9";
  const secondary = "#B8C9C4";
  const title = props.privacyMode === "private" ? "Agent task" : props.title;
  const status = props.privacyMode === "private" ? "In progress" : props.status;
  const detail = props.privacyMode === "private" ? undefined : props.detail;
  const interaction = props.interaction;
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
  const previewInteraction = props.labInteractionPreview === true;
  const harkInteractionId =
    environment.harkInteractionId ??
    (previewInteraction && interaction ? interaction.id : undefined);
  const harkInteractionCredential =
    environment.harkInteractionCredential ?? (previewInteraction ? "preview" : undefined);
  const harkInteractionDeviceId =
    environment.harkInteractionDeviceId ?? (previewInteraction ? "lab-device" : undefined);
  const harkInteractionDeliveryId =
    environment.harkInteractionDeliveryId ?? (previewInteraction ? "lab-delivery" : undefined);
  const canRespond =
    interaction?.state === "pending" &&
    harkInteractionId !== undefined &&
    harkInteractionCredential !== undefined &&
    harkInteractionDeviceId !== undefined &&
    harkInteractionDeliveryId !== undefined;
  const primaryButtonProps = interaction
    ? ({
        target: interaction.primaryAction,
        harkInteractionId,
        harkInteractionCredential,
        harkInteractionDeviceId,
        harkInteractionDeliveryId,
        modifiers: [
          buttonStyle("borderedProminent"),
          buttonBorderShape("roundedRectangle", 8),
          controlSize("regular"),
          tint("#FFFFFF"),
          frame({ height: 46, maxWidth: Infinity }),
        ],
      } as Parameters<typeof Button>[0] & Record<string, unknown>)
    : undefined;
  const secondaryButtonProps = interaction
    ? ({
        target: interaction.secondaryAction,
        role: "cancel",
        harkInteractionId,
        harkInteractionCredential,
        harkInteractionDeviceId,
        harkInteractionDeliveryId,
        modifiers: [
          buttonStyle("bordered"),
          buttonBorderShape("roundedRectangle", 8),
          controlSize("regular"),
          tint("#98989D"),
          frame({ height: 46, maxWidth: Infinity }),
        ],
      } as Parameters<typeof Button>[0] & Record<string, unknown>)
    : undefined;
  const approvalActions =
    canRespond && primaryButtonProps && secondaryButtonProps ? (
      <HStack spacing={9} modifiers={[frame({ maxWidth: Infinity })]}>
        <Button {...primaryButtonProps}>
          <Text
            modifiers={[
              font({ size: 13, weight: "semibold" }),
              foregroundStyle("#000000"),
              frame({ maxWidth: Infinity }),
            ]}
          >
            {interaction.primaryLabel}
          </Text>
        </Button>
        <Button {...secondaryButtonProps}>
          <Text
            modifiers={[
              font({ size: 13, weight: "semibold" }),
              foregroundStyle("#EBEBF0"),
              frame({ maxWidth: Infinity }),
            ]}
          >
            {interaction.secondaryLabel}
          </Text>
        </Button>
      </HStack>
    ) : null;

  // The expanded Dynamic Island has far rounder corners than the Lock Screen
  // banner, so its buttons are capsules to stay concentric with the island.
  // shell, verdict and signal reuse this expanded region.
  const islandActions =
    canRespond && primaryButtonProps && secondaryButtonProps ? (
      <HStack spacing={9} modifiers={[frame({ maxWidth: Infinity })]}>
        <Button
          {...primaryButtonProps}
          modifiers={[
            buttonStyle("borderedProminent"),
            buttonBorderShape("capsule"),
            controlSize("large"),
            tint("#FFFFFF"),
            frame({ maxWidth: Infinity }),
          ]}
        >
          <Text
            modifiers={[
              font({ size: 13, weight: "semibold" }),
              foregroundStyle("#000000"),
              frame({ maxWidth: Infinity }),
            ]}
          >
            {interaction.primaryLabel}
          </Text>
        </Button>
        <Button
          {...secondaryButtonProps}
          modifiers={[
            buttonStyle("bordered"),
            buttonBorderShape("capsule"),
            controlSize("large"),
            tint("#98989D"),
            frame({ maxWidth: Infinity }),
          ]}
        >
          <Text
            modifiers={[
              font({ size: 13, weight: "semibold" }),
              foregroundStyle("#EBEBF0"),
              frame({ maxWidth: Infinity }),
            ]}
          >
            {interaction.secondaryLabel}
          </Text>
        </Button>
      </HStack>
    ) : null;

  const banner = interaction ? (
    <VStack
      alignment="leading"
      spacing={9}
      modifiers={[padding({ horizontal: 16, vertical: 14 }), activityBackgroundTint("#0B1512")]}
    >
      <HStack spacing={8}>
        <Image
          systemName={interaction.state === "pending" ? "sparkles" : symbol}
          color={accent}
          size={18}
        />
        <Text
          modifiers={[
            font({ textStyle: "headline", weight: "semibold" }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {status}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ textStyle: "caption", weight: "semibold" }),
            foregroundStyle(accent),
            lineLimit(1),
          ]}
        >
          {title}
        </Text>
      </HStack>
      <Text
        modifiers={[font({ textStyle: "subheadline" }), foregroundStyle(secondary), lineLimit(2)]}
      >
        {interaction.state === "pending" ? interaction.prompt : (detail ?? status)}
      </Text>
      {approvalActions}
    </VStack>
  ) : null;

  const bannerSmall = interaction ? (
    <VStack
      alignment="leading"
      spacing={5}
      modifiers={[padding({ all: 10 }), activityBackgroundTint("#0B1512")]}
    >
      <HStack spacing={7}>
        <Image systemName="sparkles" color={accent} size={15} />
        <Text
          modifiers={[
            font({ textStyle: "subheadline", weight: "semibold" }),
            foregroundStyle(primary),
            lineLimit(1),
          ]}
        >
          {status}
        </Text>
      </HStack>
      <Text modifiers={[font({ textStyle: "caption" }), foregroundStyle(secondary), lineLimit(1)]}>
        {interaction.prompt}
      </Text>
    </VStack>
  ) : null;

  // The expanded island's top row sits beside the camera and its leading side
  // is capped near 100pt, too narrow for a status such as "Approval needed".
  // It holds only the icon; the prompt below is the headline, and the status
  // and title stay on the Lock Screen.
  const expandedLeading = (
    <Image
      systemName="sparkles"
      color={accent}
      size={17}
      modifiers={[padding({ leading: 7, top: 2 }), accessibilityLabel(status)]}
    />
  );

  const expandedBottom = interaction ? (
    <VStack
      alignment="leading"
      spacing={8}
      // 25pt from the island edge on the sides and bottom keeps the capsule
      // buttons (22.9pt radius) concentric with the island's 48pt corners.
      modifiers={[padding({ leading: 7, trailing: 7, bottom: 7 })]}
    >
      <Text
        modifiers={[
          font({ textStyle: "subheadline", weight: "medium" }),
          foregroundStyle(primary),
          lineLimit(2),
          frame({ maxWidth: Infinity, alignment: "leading" }),
        ]}
      >
        {interaction.state === "pending" ? interaction.prompt : (detail ?? status)}
      </Text>
      {islandActions}
    </VStack>
  ) : null;

  return {
    banner,
    bannerSmall,
    compactLeading: standard.compactLeading,
    compactTrailing: standard.compactTrailing,
    minimal: standard.minimal,
    expandedLeading,
    expandedTrailing: standard.expandedTrailing,
    expandedBottom,
  };
}
