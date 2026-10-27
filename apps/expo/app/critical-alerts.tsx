import type { CriticalAlertState } from "@hark/contracts";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton, ScreenHeader, SecondaryButton, ui } from "../src/components/screen-parts";
import {
  criticalAlertsEnabled,
  readCriticalAlertState,
  requestCriticalAlerts,
} from "../src/lib/critical-alerts";
import { colors, fonts, tightTracking } from "../src/lib/theme";

/**
 * Explains Critical Alerts before iOS asks, so the one-time system prompt
 * comes with context. Only reachable when the build has the entitlement.
 */
export default function CriticalAlertsScreen() {
  const router = useRouter();
  const enabled = criticalAlertsEnabled();
  const [state, setState] = useState<CriticalAlertState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void readCriticalAlertState().then(setState);
  }, []);

  const allow = async () => {
    setBusy(true);
    try {
      setState(await requestCriticalAlerts());
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={ui.container}>
      <StatusBar style="dark" />
      <ScreenHeader title="Critical Alerts" />
      <ScrollView contentContainerStyle={[ui.scroll, styles.content]}>
        <View style={styles.icon}>
          <SymbolView
            name="bell.and.waves.left.and.right.fill"
            size={34}
            tintColor={colors.danger}
          />
        </View>
        <Text style={styles.title}>Never sleep through a page</Text>
        <Text style={ui.body}>
          Critical Alerts let on-call pages ring at full volume even when your iPhone is on silent
          or in a Focus like Sleep or Do Not Disturb.
        </Text>
        <Text style={ui.body}>
          Hark only uses them for on-call pages sent to you. Every other notification keeps your
          normal sound settings. You can turn them off any time in Settings › Notifications › Hark.
        </Text>

        {!enabled || state === "unavailable" ? (
          <Text style={ui.muted}>This version of Hark can’t send Critical Alerts yet.</Text>
        ) : state === "authorized" ? (
          <>
            <Text style={ui.muted}>
              Critical Alerts are on. Pages will ring through silent mode.
            </Text>
            <SecondaryButton label="Done" onPress={() => router.back()} />
          </>
        ) : state === "denied" ? (
          <>
            <Text style={ui.muted}>
              Critical Alerts are off. Turn them on in Settings › Notifications › Hark.
            </Text>
            <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
            <SecondaryButton label="Not now" onPress={() => router.back()} />
          </>
        ) : (
          <>
            <PrimaryButton busy={busy} label="Allow Critical Alerts" onPress={() => void allow()} />
            <SecondaryButton label="Not now" onPress={() => router.back()} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingTop: 12,
  },
  icon: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 22,
    letterSpacing: tightTracking(22),
  },
});
