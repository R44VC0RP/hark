import { GlassView } from "expo-glass-effect";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Text } from "../../ui/text";
import { colors, radius, space } from "../../ui/tokens";

const HINT_COUNT_KEY = "hark.webApps.hintCount";
/** Shown on the first three opens of any web app. */
const HINT_SHOWS = 3;
const DELAY_MS = 600;
const VISIBLE_MS = 2600;
const FADE_S = 0.25;
const DOT = 6;
/** Two `footnote` lines plus the 8-pt padding. */
const HEIGHT = 52;

/**
 * Teaches the hidden gesture on the first few opens of a web app on iPhone
 * (DESIGN.md 5.11): a real Liquid Glass capsule under the status bar, the
 * app's only custom glass. The glass materializes and dissolves through
 * `glassEffectStyle`; only the text fades, because animating opacity on a
 * `GlassView` or its parents breaks the effect. It takes no touches.
 */
export function HoldHint({ top }: { top: number }) {
  const [phase, setPhase] = useState<"hidden" | "shown" | "leaving">("hidden");
  // A capsule at any text size: the radius follows the measured height.
  const [height, setHeight] = useState(HEIGHT);
  const text = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    void SecureStore.getItemAsync(HINT_COUNT_KEY).then((value) => {
      const count = Number(value ?? 0);
      if (cancelled || count >= HINT_SHOWS) return;
      void SecureStore.setItemAsync(HINT_COUNT_KEY, String(count + 1));
      timers.push(
        setTimeout(() => {
          setPhase("shown");
          Animated.timing(text, {
            toValue: 1,
            duration: FADE_S * 1000,
            useNativeDriver: true,
          }).start();
        }, DELAY_MS),
        setTimeout(() => {
          setPhase("leaving");
          Animated.timing(text, {
            toValue: 0,
            duration: FADE_S * 1000,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished && !cancelled) setPhase("hidden");
          });
        }, DELAY_MS + VISIBLE_MS),
      );
    });
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [text]);

  if (phase === "hidden") return null;
  return (
    <View pointerEvents="none" style={[styles.anchor, { top: top + space.xs }]}>
      <GlassView
        colorScheme="light"
        glassEffectStyle={{
          style: phase === "shown" ? "regular" : "none",
          animate: true,
          animationDuration: FADE_S,
        }}
        onLayout={(event) => setHeight(Math.round(event.nativeEvent.layout.height))}
        style={[styles.capsule, { borderRadius: radius.capsule(height) }]}
      >
        <Animated.View
          accessibilityLabel="Hold two fingers for Hark. Swipe from the left edge to go back"
          accessibilityLiveRegion="polite"
          accessibilityRole="text"
          accessible
          style={[styles.content, { opacity: text }]}
        >
          <View style={styles.firstLine}>
            <View style={styles.dot} />
            <Text maxFontSizeMultiplier={1.3} variant="footnote" weight="600">
              Hold two fingers for Hark
            </Text>
          </View>
          <Text align="center" maxFontSizeMultiplier={1.3} variant="footnote">
            Swipe from the left edge to go back
          </Text>
        </Animated.View>
      </GlassView>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    right: space.m,
    left: space.m,
    alignItems: "center",
  },
  capsule: {
    minHeight: HEIGHT,
    justifyContent: "center",
    paddingHorizontal: space.l,
    paddingVertical: space.xs,
  },
  content: {
    alignItems: "center",
  },
  firstLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: colors.accent,
  },
});
