/**
 * Dev-only Live Activity lab.
 *
 * Deliberately unauthenticated and unlinked from the app's navigation so a
 * simulator can reach it without a Google sign-in:
 *   xcrun simctl openurl booted "hark://la-lab"
 *
 * Layout changes in src/widgets/live-activities/ are picked up on a Metro
 * reload — the style functions are re-serialized into the App Group every
 * time createLiveActivity() runs — so styling iterates without a native rebuild.
 */
import {
  LIVE_ACTIVITY_DEFAULT_ACCENT_COLOR,
  LIVE_ACTIVITY_SCHEMA_VERSION,
  LIVE_ACTIVITY_SYMBOLS,
  type LiveActivityProps,
  type LiveActivitySymbol,
  liveActivityStyleSchema,
} from "@hark/contracts";
import * as Notifications from "expo-notifications";
import { Redirect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { LiveActivity } from "expo-widgets";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import HarkAgentActivity from "../src/widgets/HarkAgentActivity";

const PROGRESS_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;
const ACCENTS = ["#5ED8B7", "#FF9F0A", "#64D2FF", "#FF6B8A"] as const;

export default function LiveActivityLab() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Lab />;
}

function Lab() {
  const instance = useRef<LiveActivity | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [title, setTitle] = useState("Deploy #184");
  const [status, setStatus] = useState("Building");
  const [detail, setDetail] = useState<string | undefined>(
    "Compiling packages/website-runtime on raven-cobra",
  );
  const [progress, setProgress] = useState<number | undefined>(0.25);
  const [symbol, setSymbol] = useState<LiveActivitySymbol>("build");
  const [privacy, setPrivacy] = useState<"standard" | "private">("standard");
  const [accentColor, setAccentColor] = useState<string>(LIVE_ACTIVITY_DEFAULT_ACCENT_COLOR);

  const note = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 12));
  }, []);

  const props = useCallback(
    (): LiveActivityProps => ({
      schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
      activityId: "lab",
      title,
      status,
      ...(detail ? { detail } : {}),
      ...(progress === undefined ? {} : { progress }),
      updatedAt: new Date().toISOString(),
      symbol,
      privacyMode: privacy,
      accentColor,
    }),
    [title, status, detail, progress, symbol, privacy, accentColor],
  );

  // A unique ts value retriggers the effect when recapturing the same style.
  const params = useLocalSearchParams<{ ts?: string; style?: string }>();
  useEffect(() => {
    const styleParam = liveActivityStyleSchema.safeParse(params.style);
    if (!styleParam.success) return;
    (async () => {
      try {
        // Delivered notifications stack under the activity on the Lock Screen
        // and shift it out of capture-la.sh's fixed crop.
        await Notifications.dismissAllNotificationsAsync();
        const existing = HarkAgentActivity.getInstances();
        const isInteractive =
          styleParam.data === "approval" ||
          styleParam.data === "shell" ||
          styleParam.data === "verdict" ||
          styleParam.data === "signal";
        const nextProps: LiveActivityProps = {
          schemaVersion: LIVE_ACTIVITY_SCHEMA_VERSION,
          activityId: `lab-style-${styleParam.data}-${params.ts ?? "manual"}`,
          title: "Deploy #184",
          status: isInteractive ? "Approval needed" : "Building",
          detail: isInteractive
            ? "harkctl requests approval to deploy to production"
            : "Compiling packages/website-runtime on raven-cobra",
          ...(isInteractive ? {} : { progress: 0.25 }),
          updatedAt: new Date().toISOString(),
          symbol: isInteractive ? "terminal" : "build",
          privacyMode: "standard",
          accentColor: LIVE_ACTIVITY_DEFAULT_ACCENT_COLOR,
          style: styleParam.data,
          ...(isInteractive
            ? {
                interaction: {
                  id: "lab-style-approval-interaction",
                  kind: "approval" as const,
                  prompt: "Deploy build #184 to production on raven-cobra?",
                  primaryLabel: styleParam.data === "verdict" ? "Allow" : "Approve",
                  secondaryLabel: styleParam.data === "verdict" ? "Don’t Allow" : "Deny",
                  primaryAction: "approve",
                  secondaryAction: "deny",
                  state: "pending" as const,
                },
                labInteractionPreview: true,
              }
            : {}),
        };
        const active = existing[0];
        if (active) {
          await active.update(nextProps);
          instance.current = active;
          for (const extra of existing.slice(1)) {
            try {
              await extra.end("immediate");
            } catch {
              // already gone
            }
          }
          note(`auto-updated style ${styleParam.data}`);
        } else {
          instance.current = await HarkAgentActivity.start(nextProps);
          note(`auto-started style ${styleParam.data}`);
        }
      } catch (error) {
        note(`auto-start failed: ${String(error)}`);
      }
    })();
  }, [params.style, params.ts, note]);

  const start = async () => {
    try {
      instance.current = await HarkAgentActivity.start(props());
      note(`started (${HarkAgentActivity.getInstances().length} active)`);
    } catch (error) {
      note(`start failed: ${String(error)}`);
    }
  };

  const update = async () => {
    const active = instance.current ?? HarkAgentActivity.getInstances()[0] ?? null;
    if (!active) return note("no active activity — press Start");
    instance.current = active;
    try {
      await active.update(props());
      note("updated");
    } catch (error) {
      note(`update failed: ${String(error)}`);
    }
  };

  const end = async () => {
    const active = instance.current ?? HarkAgentActivity.getInstances()[0] ?? null;
    if (!active) return note("nothing to end");
    try {
      await active.end("immediate");
      instance.current = null;
      note("ended");
    } catch (error) {
      note(`end failed: ${String(error)}`);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Live Activity lab</Text>
        <Text style={styles.caption}>
          Start one, then swipe to the Lock Screen or long-press the Dynamic Island.
        </Text>

        <Row>
          <Btn label="Start" onPress={start} kind="primary" />
          <Btn label="Update" onPress={update} />
          <Btn label="End" onPress={end} kind="danger" />
        </Row>

        <Section>
          <Row>
            {PROGRESS_STEPS.map((step) => (
              <Btn
                key={step}
                label={`${Math.round(step * 100)}%`}
                selected={progress === step}
                onPress={() => setProgress(step)}
              />
            ))}
            <Btn
              label="none"
              selected={progress === undefined}
              onPress={() => setProgress(undefined)}
            />
          </Row>
        </Section>

        <Section>
          <Row>
            {LIVE_ACTIVITY_SYMBOLS.map((value) => (
              <Btn
                key={value}
                label={value}
                selected={symbol === value}
                onPress={() => setSymbol(value)}
              />
            ))}
          </Row>
        </Section>

        <Section>
          <Row>
            {ACCENTS.map((value) => (
              <Btn
                key={value}
                label={value}
                selected={accentColor === value}
                onPress={() => setAccentColor(value)}
              />
            ))}
          </Row>
        </Section>

        <Section>
          <Row>
            <Btn
              label="Building"
              onPress={() => setStatus("Building")}
              selected={status === "Building"}
            />
            <Btn
              label="Deploying"
              onPress={() => setStatus("Deploying")}
              selected={status === "Deploying"}
            />
            <Btn label="Done" onPress={() => setStatus("Done")} selected={status === "Done"} />
          </Row>
          <Row>
            <Btn label="short title" onPress={() => setTitle("Deploy")} />
            <Btn
              label="long title"
              onPress={() => setTitle("Deploy #184 to raven-cobra production")}
            />
          </Row>
          <Row>
            <Btn
              label="detail on"
              selected={detail !== undefined}
              onPress={() => setDetail("Compiling packages/website-runtime on raven-cobra")}
            />
            <Btn
              label="detail off"
              selected={detail === undefined}
              onPress={() => setDetail(undefined)}
            />
          </Row>
          <Row>
            <Btn
              label="standard"
              selected={privacy === "standard"}
              onPress={() => setPrivacy("standard")}
            />
            <Btn
              label="private"
              selected={privacy === "private"}
              onPress={() => setPrivacy("private")}
            />
          </Row>
        </Section>

        <Section>
          {log.length === 0 ? <Text style={styles.logLine}>—</Text> : null}
          {log.map((line) => (
            <Text key={line} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <View style={styles.section}>{children}</View>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Btn({
  label,
  onPress,
  selected,
  kind,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  kind?: "primary" | "danger";
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        selected ? styles.btnSelected : null,
        kind === "primary" ? styles.btnPrimary : null,
        kind === "danger" ? styles.btnDanger : null,
        pressed ? styles.btnPressed : null,
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B1512" },
  content: { padding: 16, gap: 14 },
  heading: { color: "#F2FBF8", fontSize: 22, fontWeight: "700" },
  caption: { color: "#8FA8A1", fontSize: 13, lineHeight: 18 },
  section: { gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "#16302A",
    borderWidth: 1,
    borderColor: "#22453D",
  },
  btnSelected: { backgroundColor: "#1E5145", borderColor: "#5ED8B7" },
  btnPrimary: { backgroundColor: "#08715D", borderColor: "#5ED8B7" },
  btnDanger: { backgroundColor: "#5A1F1F", borderColor: "#B4514F" },
  btnPressed: { opacity: 0.7 },
  btnText: { color: "#F2FBF8", fontSize: 13, fontWeight: "600" },
  logLine: { color: "#8FA8A1", fontSize: 12, fontFamily: "Menlo" },
});
