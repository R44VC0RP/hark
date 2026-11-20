import type { OncallPageDto } from "@hark/contracts";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, View } from "react-native";
import { goTo } from "../lib/navigation";
import { Text } from "../ui/text";
import { colors, metrics } from "../ui/tokens";

/** Accessory text stays inside the fixed-height glass capsule at large text sizes. */
const MAX_SCALE = 1.3;

function newest(pages: OncallPageDto[]): OncallPageDto | undefined {
  let latest: OncallPageDto | undefined;
  for (const page of pages) {
    if (!latest || Date.parse(page.createdAt) > Date.parse(latest.createdAt)) latest = page;
  }
  return latest;
}

/**
 * The tab bar's bottom accessory while pages need a response (DESIGN.md
 * 5.0). iOS renders it twice (regular and inline), so it takes everything
 * through props and keeps no state. One page opens its sheet; several open
 * On Call.
 */
export function PagesAccessory({ pages }: { pages: OncallPageDto[] }) {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  const page = newest(pages);
  if (!page) return null;
  const count = pages.length;
  const one = count === 1;
  const title = one ? "1 Page Needs You" : `${count} Pages Need You`;
  const detail = `${page.groupName} · ${page.title}`;

  // By the links' rule (src/lib/navigation.ts): a sheet on top closes
  // first; On Call opens as Teams › On Call.
  const open = () => goTo(one ? `/pages/${encodeURIComponent(page.id)}` : "/oncall");

  return (
    <Pressable
      accessibilityHint={one ? "Opens the page" : "Shows your open pages"}
      accessibilityLabel={`${one ? "1 page needs you" : `${count} pages need you`}. ${page.groupName}, ${page.title}`}
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [styles.accessory, pressed && styles.pressed]}
    >
      <SymbolView name="bell.badge.fill" size={17} tintColor={colors.danger} />
      {placement === "inline" ? (
        <Text
          maxFontSizeMultiplier={MAX_SCALE}
          numberOfLines={1}
          variant="subheadline"
          weight="600"
        >
          {one ? "1 Page" : `${count} Pages`}
        </Text>
      ) : (
        <View style={styles.copy}>
          <Text
            maxFontSizeMultiplier={MAX_SCALE}
            numberOfLines={1}
            variant="subheadline"
            weight="600"
          >
            {title}
          </Text>
          <Text
            color="secondaryLabel"
            maxFontSizeMultiplier={MAX_SCALE}
            numberOfLines={1}
            variant="footnote"
          >
            {detail}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  accessory: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: metrics.rowAccessoryGap,
    paddingHorizontal: metrics.rowPaddingHorizontal,
  },
  pressed: {
    opacity: 0.6,
  },
  copy: {
    minWidth: 0,
    flex: 1,
  },
});
