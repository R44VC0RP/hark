import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { fallbackTint } from "../lib/web-apps";
import { Text } from "../ui/text";

/**
 * Rounded app tile (DESIGN.md 3.4): the registered icon, or a deterministic
 * letter tile. The corner is the Home Screen's continuous curve at
 * `size × 0.225`; the letter is the system font and keeps its size at every
 * text size, like the icon around it.
 */
export function AppIcon({
  name,
  iconUrl,
  size,
}: {
  name: string;
  iconUrl: string | null;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  const frame = { width: size, height: size, borderRadius: size * 0.225 };
  if (iconUrl && !failed) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        onError={() => setFailed(true)}
        source={{ uri: iconUrl }}
        style={[styles.tile, frame]}
      />
    );
  }
  const tint = fallbackTint(name);
  return (
    <View style={[styles.tile, styles.fallback, frame, { backgroundColor: tint.background }]}>
      <Text
        allowFontScaling={false}
        style={{
          color: tint.foreground,
          fontSize: Math.round(size * 0.4),
          lineHeight: Math.round(size * 0.5),
        }}
        weight="600"
      >
        {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexShrink: 0,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#0000001A",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
});
