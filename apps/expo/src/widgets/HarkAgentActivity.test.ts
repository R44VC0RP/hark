import type { LiveActivityProps } from "@hark/contracts";
import { describe, expect, it, vi } from "vitest";

// The widget function is serialized by the expo-widgets babel plugin and
// evaluated in JavaScriptCore, where every @expo/ui export is a global that
// returns plain `{ type, props }` nodes (see expo-widgets/bundle). These mocks
// reproduce that runtime: components become node factories and modifiers
// become tagged records, so the tests exercise the exact branching logic the
// widget extension will run.
const { component, modifier } = vi.hoisted(() => ({
  component:
    (type: string) =>
    (props: Record<string, unknown> = {}) => ({ type, props }),
  modifier:
    (name: string) =>
    (...args: unknown[]) => ({ $modifier: name, args }),
}));

vi.mock("expo-widgets", () => ({
  createLiveActivity: (name: string, layout: unknown) => ({ name, layout }),
}));
vi.mock("@expo/ui/swift-ui", () => ({
  Button: component("Button"),
  Capsule: component("Capsule"),
  Circle: component("Circle"),
  Divider: component("Divider"),
  Gauge: component("Gauge"),
  HStack: component("HStack"),
  Image: component("Image"),
  ProgressView: component("ProgressView"),
  Spacer: component("Spacer"),
  Text: component("Text"),
  VStack: component("VStack"),
  ZStack: component("ZStack"),
}));
vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  accessibilityElement: modifier("accessibilityElement"),
  accessibilityLabel: modifier("accessibilityLabel"),
  activityBackgroundTint: modifier("activityBackgroundTint"),
  buttonBorderShape: modifier("buttonBorderShape"),
  buttonStyle: modifier("buttonStyle"),
  controlSize: modifier("controlSize"),
  fixedSize: modifier("fixedSize"),
  font: modifier("font"),
  foregroundStyle: modifier("foregroundStyle"),
  frame: modifier("frame"),
  gaugeStyle: modifier("gaugeStyle"),
  kerning: modifier("kerning"),
  lineLimit: modifier("lineLimit"),
  minimumScaleFactor: modifier("minimumScaleFactor"),
  monospacedDigit: modifier("monospacedDigit"),
  padding: modifier("padding"),
  progressViewStyle: modifier("progressViewStyle"),
  shadow: modifier("shadow"),
  textCase: modifier("textCase"),
  tint: modifier("tint"),
}));

import HarkAgentActivity from "./HarkAgentActivity";

type Node = { type: string; props: Record<string, unknown> };

const { layout } = HarkAgentActivity as unknown as {
  name: string;
  layout: (
    props: LiveActivityProps,
    environment: Record<string, unknown>,
  ) => Record<string, unknown>;
};

/**
 * The test process compiles JSX with React's lazy jsx-runtime, while the
 * widget bundle's stub invokes function components immediately. Walking the
 * element tree and invoking each component restores the widget semantics.
 */
function materialize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(materialize).filter((child) => child !== null && child !== undefined);
  }
  if (value === null || value === undefined || typeof value !== "object") return value;
  const element = value as { type?: unknown; props?: Record<string, unknown> };
  if (typeof element.type !== "function") return value;
  const produced = (element.type as (props: unknown) => Node)(element.props ?? {});
  const props = { ...produced.props };
  if ("children" in props) props.children = materialize(props.children);
  return { type: produced.type, props };
}

function render(
  props: LiveActivityProps,
  environment: Record<string, unknown> = {},
): Record<string, unknown> {
  const slots = layout(props, environment);
  const rendered: Record<string, unknown> = {};
  for (const key of Object.keys(slots)) rendered[key] = materialize(slots[key]);
  return rendered;
}

function findAll(node: unknown, type: string, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, type, out);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const element = node as Node;
  if (element.type === type) out.push(element);
  findAll(element.props?.children, type, out);
  return out;
}

function texts(node: unknown): unknown[] {
  return findAll(node, "Text").map((text) => text.props.children);
}

function modifierNames(node: Node): string[] {
  const modifiers = (node.props.modifiers ?? []) as Array<{ $modifier: string }>;
  return modifiers.map((entry) => entry.$modifier);
}

function fontArgs(node: Node | undefined): unknown {
  const modifiers = (node?.props.modifiers ?? []) as Array<{ $modifier: string; args: unknown[] }>;
  return modifiers.find((entry) => entry.$modifier === "font")?.args[0];
}

const SLOTS = [
  "banner",
  "bannerSmall",
  "compactLeading",
  "compactTrailing",
  "minimal",
  "expandedLeading",
  "expandedTrailing",
  "expandedBottom",
] as const;

const baseProps: LiveActivityProps = {
  schemaVersion: 1,
  activityId: "act_test",
  title: "Deploy #184",
  status: "Building",
  detail: "apps/website · main @ 51ab6ab",
  progress: 0.42,
  updatedAt: "2026-07-25T12:00:00.000Z",
  symbol: "build",
  privacyMode: "standard",
  accentColor: "#FF9F0A",
};

describe("HarkAgentActivity layout styles", () => {
  it("renders the standard layout when style is missing, and identically when explicit", () => {
    const implicit = render(baseProps);
    const explicit = render({ ...baseProps, style: "standard" });
    expect(implicit).toEqual(explicit);
    expect(findAll(implicit.banner, "Gauge")).toHaveLength(0);
    expect(findAll(implicit.banner, "ProgressView")).toHaveLength(1);
    expect(texts(implicit.banner)).toContain("Deploy #184");
  });

  it("defines every slot for every style", () => {
    for (const style of [
      "standard",
      "ring",
      "hero",
      "terminal",
      "steps",
      "approval",
      "shell",
      "verdict",
      "signal",
    ] as const) {
      const props: LiveActivityProps =
        style === "approval" || style === "shell" || style === "verdict" || style === "signal"
          ? {
              ...baseProps,
              style,
              interaction: {
                id: "int_slots",
                kind: "approval",
                prompt: "Deploy to production?",
                primaryLabel: "Approve",
                secondaryLabel: "Deny",
                primaryAction: "approve",
                secondaryAction: "deny",
                state: "pending",
              },
            }
          : { ...baseProps, style };
      const slots = render(props);
      for (const slot of SLOTS) {
        expect(slots[slot], `${style}.${slot}`).toBeDefined();
      }
    }
  });

  it("renders canonical interactive approval targets with custom labels", () => {
    const interaction = {
      id: "int_1",
      kind: "approval",
      prompt: "Send the prepared release email?",
      primaryLabel: "Send",
      secondaryLabel: "Deny",
      primaryAction: "approve",
      secondaryAction: "deny",
      state: "pending",
    } as const;
    const props: LiveActivityProps = {
      ...baseProps,
      style: "approval",
      status: "Approval needed",
      progress: undefined,
      interaction,
    };
    const slots = render(props, {
      harkInteractionId: "int_1",
      harkInteractionCredential: "c".repeat(43),
      harkInteractionDeviceId: "dev_1",
      harkInteractionDeliveryId: "lad_1",
    });
    const buttons = findAll(slots.banner, "Button");
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.props.target)).toEqual(["approve", "deny"]);
    expect(texts(buttons[0])).toContain("Send");
    expect(texts(buttons[1])).toContain("Deny");
    expect(buttons[0]?.props).toMatchObject({
      harkInteractionId: "int_1",
      harkInteractionCredential: "c".repeat(43),
      harkInteractionDeviceId: "dev_1",
      harkInteractionDeliveryId: "lad_1",
    });
    for (const button of buttons) {
      expect(button.props.modifiers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            $modifier: "buttonBorderShape",
            args: ["roundedRectangle", 8],
          }),
          expect.objectContaining({
            $modifier: "controlSize",
            args: ["regular"],
          }),
          expect.objectContaining({
            $modifier: "frame",
            args: [{ height: 46, maxWidth: Infinity }],
          }),
        ]),
      );
    }
    expect(findAll(slots.expandedBottom, "Button")).toHaveLength(2);

    const previewProps = {
      ...props,
      labInteractionPreview: true,
    } as LiveActivityProps;
    expect(findAll(render(previewProps).banner, "Button")).toHaveLength(2);

    const resolved = render({
      ...props,
      status: "Approved",
      detail: "Sent to the agent.",
      interaction: { ...interaction, state: "approved" },
    });
    expect(findAll(resolved.banner, "Button")).toHaveLength(0);
  });

  it("ring leads with a determinate circular gauge and the percent overlaid", () => {
    const slots = render({ ...baseProps, style: "ring" });
    const gauges = findAll(slots.banner, "Gauge");
    expect(gauges).toHaveLength(1);
    expect(gauges[0]?.props.value).toBe(0.42);
    expect(gauges[0]?.props.modifiers as Array<{ $modifier: string; args: unknown[] }>).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ $modifier: "gaugeStyle", args: ["circularCapacity"] }),
      ]),
    );
    const stack = findAll(slots.banner, "ZStack");
    expect(stack).toHaveLength(1);
    expect(texts(stack[0])).toContain("42%");
    // The ring carries progress; no linear bar and no spinner stand-in.
    expect(findAll(slots.banner, "ProgressView")).toHaveLength(0);
    expect(findAll(slots.expandedBottom, "Gauge")).toHaveLength(1);
  });

  it("ring degrades to the large symbol when there is no progress", () => {
    const slots = render({ ...baseProps, style: "ring", progress: undefined });
    expect(findAll(slots.banner, "Gauge")).toHaveLength(0);
    const images = findAll(slots.banner, "Image");
    expect(images[0]?.props.size).toBe(30);
  });

  it("hero makes status the headline and uses a full-bleed bar", () => {
    const slots = render({ ...baseProps, style: "hero" });
    const banner = slots.banner as Node;
    // Root carries no padding so the trailing ProgressView reaches the card edges.
    expect(modifierNames(banner)).not.toContain("padding");
    const rootChildren = banner.props.children as Node[];
    expect(rootChildren.at(-1)?.type).toBe("ProgressView");
    const statusText = findAll(banner, "Text").find((text) => text.props.children === "Building");
    expect(statusText).toBeDefined();
    expect(fontArgs(statusText)).toMatchObject({ size: 22, weight: "bold" });
    expect(texts(banner)).not.toContain("Deploy #184");
  });

  it("terminal renders a monospace prompt line and a comment detail", () => {
    const slots = render({ ...baseProps, style: "terminal" });
    const bannerTexts = texts(slots.banner);
    expect(bannerTexts).toContain("❯");
    expect(bannerTexts).toContain("building");
    expect(bannerTexts).toContain("# apps/website · main @ 51ab6ab");
    expect(findAll(slots.banner, "ProgressView")).toHaveLength(1);
    const prompt = findAll(slots.banner, "Text").find((text) => text.props.children === "building");
    expect(fontArgs(prompt)).toMatchObject({ design: "monospaced" });
    const noProgress = render({ ...baseProps, style: "terminal", progress: undefined });
    expect(texts(noProgress.compactTrailing)).toContain("❯_");
  });

  it("steps quantizes progress into five pips with thresholds at n/5", () => {
    const slots = render({ ...baseProps, style: "steps" });
    const pips = findAll(slots.banner, "Capsule");
    expect(pips).toHaveLength(5);
    const fills = pips.map(
      (pip) =>
        (pip.props.modifiers as Array<{ $modifier: string; args: unknown[] }>).find(
          (entry) => entry.$modifier === "foregroundStyle",
        )?.args[0],
    );
    // progress 0.42 fills two of five pips.
    expect(fills).toEqual(["#FF9F0A", "#FF9F0A", "#FFFFFF29", "#FFFFFF29", "#FFFFFF29"]);
    const complete = render({ ...baseProps, style: "steps", progress: 1 });
    const completeFills = findAll(complete.banner, "Capsule").map(
      (pip) =>
        (pip.props.modifiers as Array<{ $modifier: string; args: unknown[] }>).find(
          (entry) => entry.$modifier === "foregroundStyle",
        )?.args[0],
    );
    expect(completeFills).toEqual(Array(5).fill("#FF9F0A"));
    // Status trails the title row; pips replace the percent readout.
    expect(texts(slots.banner)).toContain("Building");
    expect(texts(slots.banner)).not.toContain("42%");
    const withoutProgress = render({ ...baseProps, style: "steps", progress: undefined });
    expect(findAll(withoutProgress.banner, "Capsule")).toHaveLength(0);
  });

  it("keeps privacy mode masking across styles", () => {
    for (const style of ["ring", "hero", "terminal", "steps"] as const) {
      const slots = render({ ...baseProps, style, privacyMode: "private" });
      const bannerTexts = texts(slots.banner);
      expect(bannerTexts).not.toContain("Deploy #184");
      expect(bannerTexts).not.toContain("apps/website · main @ 51ab6ab");
      expect(JSON.stringify(slots)).not.toContain("51ab6ab");
    }
  });

  it("renders shipped interactive styles with functional banners and approval Island slots", () => {
    const approvalProps = {
      ...baseProps,
      style: "approval",
      status: "Approval needed",
      progress: undefined,
      interaction: {
        id: "int_styles",
        kind: "approval",
        prompt: "Deploy build #184 to production?",
        primaryLabel: "Send",
        secondaryLabel: "Cancel",
        primaryAction: "approve",
        secondaryAction: "deny",
        state: "pending",
      },
    } as LiveActivityProps;
    const environment = {
      harkInteractionId: "int_styles",
      harkInteractionCredential: "c".repeat(43),
      harkInteractionDeviceId: "dev_1",
      harkInteractionDeliveryId: "lad_1",
    };
    const approval = render(approvalProps, environment);

    for (const style of ["shell", "verdict", "signal"] as const) {
      const slots = render({ ...approvalProps, style }, environment);
      const buttons = findAll(slots.banner, "Button");
      expect(buttons, `${style}.banner`).toHaveLength(2);
      expect(buttons.map((button) => button.props.target)).toEqual(["approve", "deny"]);
      expect(buttons[0]?.props).toMatchObject(environment);
      for (const slot of SLOTS.filter((slot) => slot !== "banner")) {
        expect(slots[slot], `${style}.${slot}`).toEqual(approval[slot]);
      }
    }
  });
});
