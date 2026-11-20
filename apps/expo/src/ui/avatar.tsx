import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { initialOf } from "../lib/teams";
import { Text } from "./text";
import { colors, radius } from "./tokens";

/**
 * Avatars and thumbnails (DESIGN.md 3.4, 3.6). A remote image when there is
 * one, otherwise a flat letter tile in the accent tint; never a remote
 * placeholder image. Every image has an explicit size.
 */

interface ImageTileProps {
  name: string;
  url?: string | null;
  size: number;
  borderRadius: number;
}

function ImageTile({ name, url, size, borderRadius }: ImageTileProps) {
  const [failed, setFailed] = useState(false);
  const frame = { width: size, height: size, borderRadius };
  if (url && !failed) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        onError={() => setFailed(true)}
        source={{ uri: url }}
        style={[styles.image, frame]}
      />
    );
  }
  return (
    <View style={[styles.letterTile, frame]}>
      <Text
        allowFontScaling={false}
        color="accent"
        style={{ fontSize: Math.round(size * 0.42), lineHeight: Math.round(size * 0.5) }}
        weight="600"
      >
        {initialOf(name)}
      </Text>
    </View>
  );
}

/** A person or team: photo or initial, in a circle. */
export function Avatar({
  name,
  image,
  size = 36,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  return <ImageTile borderRadius={size / 2} name={name} size={size} url={image} />;
}

/** The service that sent something (24, 30 or 32 pt): its image or its initial. */
export function SourceAvatar({
  name,
  url,
  size = 32,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  return <ImageTile borderRadius={size / 2} name={name} size={size} url={url} />;
}

/** A project's 40-pt rounded thumbnail: its latest image or a letter tile. */
export function Thumbnail({
  name,
  url,
  size = 40,
}: {
  name: string;
  url?: string | null;
  size?: number;
}) {
  return <ImageTile borderRadius={radius.thumb} name={name} size={size} url={url} />;
}

const styles = StyleSheet.create({
  image: {
    flexShrink: 0,
    borderCurve: "continuous",
    backgroundColor: colors.fill,
  },
  letterTile: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderCurve: "continuous",
    backgroundColor: colors.accentSoft,
  },
});
