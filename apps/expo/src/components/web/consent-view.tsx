import type { AppDto } from "@hark/contracts";
import { Stack } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../../lib/auth";
import { spoken } from "../../ui/a11y";
import { Button } from "../../ui/button";
import {
  List,
  Row,
  readingColumn,
  Section,
  SwitchRow,
  useScreenMargin,
  useStackedRows,
} from "../../ui/list";
import { Text } from "../../ui/text";
import { colors, space } from "../../ui/tokens";
import { AppIcon } from "../app-icon";

/**
 * Asks once before Hark signs you in to a web app (DESIGN.md 5.11): who
 * asks, what a pass is, what it shares, then Continue or Not Now. The
 * screen's header (transparent, no title) is set by the web app screen; this
 * adds its Close button. The answers stay inline at the bottom, not in a
 * toolbar (3.12 rule 8).
 */
export function ConsentView({
  app,
  onApprove,
  onCancel,
}: {
  app: AppDto;
  onApprove: (sharing: { shareName: boolean; shareEmail: boolean }) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const margin = useScreenMargin();
  // At accessibility sizes the answers scroll with the text instead of
  // pinning to the bottom, where they would cover most of it, and the text
  // uses the full width instead of the 680-pt column.
  const inline = useStackedRows();
  const { data: session } = useSession();
  const [shareName, setShareName] = useState(app.shareName);
  const [shareEmail, setShareEmail] = useState(app.shareEmail);
  const host = new URL(app.origin).host;
  const addedBy = app.team
    ? `Shared with ${app.team.name}${app.addedBy ? ` · ${app.addedBy} added this` : ""}`
    : app.createdBy
      ? `Added by ${app.createdBy}`
      : null;

  const actions = (
    <View style={inline ? styles.actionsInline : styles.actions}>
      <Button
        onPress={() => onApprove({ shareName, shareEmail })}
        size="large"
        title="Continue"
        variant="prominent"
      />
      <Button onPress={onCancel} size="large" title="Not Now" variant="plain" />
      {addedBy ? (
        <Text align="center" color="secondaryLabel" variant="footnote">
          {addedBy}
        </Text>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button accessibilityLabel="Close" icon="xmark" onPress={onCancel} />
      </Stack.Toolbar>
      {/* The scroll view stays first in the chain, so the glass header finds it. */}
      <View collapsable={false} style={styles.screen}>
        <List reading={!inline}>
          <View
            accessibilityLabel={spoken(`Sign In to ${app.name}?`, host)}
            accessibilityRole="header"
            accessible
            style={[styles.identity, inline && styles.identityStacked]}
          >
            <AppIcon iconUrl={app.iconUrl} name={app.name} size={56} />
            <View style={styles.identityCopy}>
              <Text variant="title2">{`Sign In to ${app.name}?`}</Text>
              <Text color="secondaryLabel" variant="subheadline">
                {host}
              </Text>
            </View>
          </View>
          <Text style={styles.body} variant="body">
            {`Hark gives ${app.name} a one-time pass that proves it’s you. It only works on this site and expires in 2 minutes.`}
          </Text>
          <Section title={`Shared with ${app.name}`}>
            <Row subtitle="A private ID made just for this app" title="Hark ID" value="Always" />
            <SwitchRow
              onValueChange={setShareName}
              subtitle={session?.user.name || undefined}
              title="Name"
              value={shareName}
            />
            <SwitchRow
              onValueChange={setShareEmail}
              subtitle={session?.user.email || undefined}
              title="Email"
              value={shareEmail}
            />
          </Section>
          {inline ? actions : null}
        </List>
        {inline ? null : (
          <View
            style={[
              readingColumn,
              { paddingHorizontal: margin, paddingBottom: Math.max(insets.bottom, space.m) },
            ]}
          >
            {actions}
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.m,
    marginTop: space.xs,
  },
  identityStacked: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: space.s,
  },
  identityCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  body: {
    marginTop: space.l,
  },
  actions: {
    gap: space.xxs,
    paddingTop: space.s,
  },
  actionsInline: {
    gap: space.xxs,
    marginTop: space.xl,
  },
});
