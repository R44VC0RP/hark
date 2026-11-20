import {
  getAppIconName,
  setAlternateAppIcon,
  supportsAlternateIcons,
} from "expo-alternate-app-icons";
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, StyleSheet, View } from "react-native";
import { type AppIconOption, appIconOptions } from "../../src/lib/app-icons";
import { haptic } from "../../src/lib/haptics";
import { Cell, List, Section } from "../../src/ui/list";
import { Text } from "../../src/ui/text";
import { colors, metrics, palette, radius } from "../../src/ui/tokens";

const ICON = 44;

/**
 * App Icon (DESIGN.md 5.16), pushed inside the Settings sheet: one row per
 * icon, a checkmark on the current one, a spinner over the icon while iOS
 * switches it. Devices that can't change icons see the list disabled.
 */
export default function AppIconScreen() {
  const [current, setCurrent] = useState<string | null>(() => getAppIconName());
  const [changing, setChanging] = useState<string | null>(null);

  const choose = async (option: AppIconOption) => {
    if (option.alternateName === current || changing) return;
    setChanging(option.id);
    try {
      setCurrent(await setAlternateAppIcon(option.alternateName));
    } catch (error) {
      haptic.error();
      Alert.alert(
        "Couldn’t Change App Icon",
        error instanceof Error ? error.message : "Try again.",
      );
    } finally {
      setChanging(null);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "App Icon" }} />
      <List>
        <Section
          footer={supportsAlternateIcons ? undefined : "This device can’t change app icons."}
        >
          {appIconOptions.map((option) => {
            const selected = option.alternateName === current;
            return (
              <Cell
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{
                  selected,
                  disabled: !supportsAlternateIcons || changing !== null,
                  busy: changing === option.id,
                }}
                accessible
                disabled={!supportsAlternateIcons || changing !== null}
                key={option.id}
                onPress={() => void choose(option)}
                separatorInset={metrics.rowPaddingHorizontal + ICON + metrics.rowAccessoryGap}
                style={supportsAlternateIcons ? null : styles.disabled}
              >
                <View>
                  <Image
                    accessibilityIgnoresInvertColors
                    source={option.image}
                    style={styles.icon}
                  />
                  {changing === option.id ? (
                    <View style={styles.spinner}>
                      <ActivityIndicator color={palette.onAccent} />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.label} variant="body">
                  {option.label}
                </Text>
                {selected ? (
                  <SymbolView
                    name="checkmark"
                    size={17}
                    tintColor={colors.accent}
                    weight="semibold"
                  />
                ) : null}
              </Cell>
            );
          })}
        </Section>
      </List>
    </>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: ICON,
    height: ICON,
    borderRadius: radius.icon(ICON),
    borderCurve: "continuous",
  },
  spinner: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.icon(ICON),
    borderCurve: "continuous",
    backgroundColor: "rgba(0, 0, 0, 0.32)",
  },
  label: {
    flex: 1,
  },
  disabled: {
    opacity: 0.4,
  },
});
