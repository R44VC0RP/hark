import type { CriticalAlertState } from "@hark/contracts";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { AppState, Linking, StyleSheet, View } from "react-native";
import { closeSheet } from "../src/components/teams/close-sheet";
import {
  criticalAlertsEnabled,
  readCriticalAlertState,
  requestCriticalAlerts,
} from "../src/lib/critical-alerts";
import { deviceNoun } from "../src/lib/layout";
import { List } from "../src/ui/list";
import { Text } from "../src/ui/text";
import { colors, metrics, palette, radius, space } from "../src/ui/tokens";

const TILE = 64;

function stateLine(state: CriticalAlertState): string | null {
  switch (state) {
    case "authorized":
      return "Critical Alerts are on. Pages will ring through silent mode.";
    case "denied":
      return "Critical Alerts are off. Turn them on in Settings › Notifications › Hark.";
    case "unavailable":
      return "This version of Hark can’t send Critical Alerts yet.";
    default:
      return null;
  }
}

/**
 * Explains Critical Alerts before iOS asks (DESIGN.md 5.20), so the one-time
 * system prompt comes with context. One centered prominent action in the
 * sheet's bottom toolbar: allow, open Settings, or done.
 */
export default function CriticalAlertsSheet() {
  const enabled = criticalAlertsEnabled();
  const [state, setState] = useState<CriticalAlertState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const read = () => void readCriticalAlertState().then(setState);
    read();
    // Back from iOS Settings: show what changed there.
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") read();
    });
    return () => appState.remove();
  }, []);

  const allow = async () => {
    setBusy(true);
    try {
      setState(await requestCriticalAlerts());
    } finally {
      setBusy(false);
    }
  };

  const shown: CriticalAlertState | null = !enabled ? "unavailable" : state;
  const line = shown ? stateLine(shown) : null;

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          accessibilityLabel="Close"
          icon="xmark"
          onPress={() => closeSheet("/oncall")}
        />
      </Stack.Toolbar>
      <List alwaysBounceVertical={false} reading>
        <View style={styles.hero}>
          <View style={styles.tile}>
            <SymbolView
              accessibilityElementsHidden
              name="bell.and.waves.left.and.right.fill"
              size={34}
              tintColor={colors.danger}
            />
          </View>
          {/*
            The same hero as Join (V-18): title1, one centred paragraph in
            secondary ink; the fine print below it reads left-aligned, like
            Join's footnote, instead of a second centred block.
          */}
          <Text accessibilityRole="header" align="center" variant="title1">
            {"Never Sleep Through a\u00A0Page"}
          </Text>
          <Text align="center" color="secondaryLabel" variant="body">
            {`Critical Alerts let on-call pages ring at full volume even when your ${deviceNoun} is on silent or in a Focus like Sleep or Do Not Disturb.`}
          </Text>
        </View>
        <View style={styles.notes}>
          <Text color="secondaryLabel" variant="footnote">
            Hark only uses them for on-call pages sent to you. Every other notification keeps your
            normal sound settings. You can turn them off any time in Settings › Notifications ›
            Hark.
          </Text>
          {line ? (
            <Text accessibilityLiveRegion="polite" color="secondaryLabel" variant="footnote">
              {line}
            </Text>
          ) : null}
        </View>
      </List>
      {shown ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.Spacer />
          {shown === "notDetermined" ? (
            <Stack.Toolbar.Button
              disabled={busy}
              onPress={() => void allow()}
              tintColor={palette.accent}
              variant="prominent"
            >
              Allow Critical Alerts
            </Stack.Toolbar.Button>
          ) : shown === "denied" ? (
            <Stack.Toolbar.Button
              accessibilityHint="Opens Hark in the Settings app"
              onPress={() => void Linking.openSettings()}
              tintColor={palette.accent}
              variant="prominent"
            >
              Open Settings
            </Stack.Toolbar.Button>
          ) : (
            <Stack.Toolbar.Button
              onPress={() => closeSheet("/oncall")}
              tintColor={palette.accent}
              variant="prominent"
            >
              Done
            </Stack.Toolbar.Button>
          )}
          <Stack.Toolbar.Spacer />
        </Stack.Toolbar>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    gap: space.s,
    marginTop: space.l,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
  notes: {
    gap: space.xs,
    marginTop: space.l,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
  tile: {
    width: TILE,
    height: TILE,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.xxs,
    borderRadius: radius.inner(10),
    borderCurve: "continuous",
    backgroundColor: colors.cell,
  },
});
