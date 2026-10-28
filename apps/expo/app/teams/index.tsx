import type { TeamDto } from "@hark/contracts";
import * as Device from "expo-device";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  PersonAvatar,
  PrimaryButton,
  ScreenHeader,
  SectionLabel,
  ui,
} from "../../src/components/screen-parts";
import { api } from "../../src/lib/api";
import { useSession } from "../../src/lib/auth";
import { previewTeams } from "../../src/lib/inbox-preview";
import { isUnsupportedRoute, memberCountLabel, roleLabel } from "../../src/lib/teams";
import { colors } from "../../src/lib/theme";

export default function TeamsScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const [teams, setTeams] = useState<TeamDto[] | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (simulatorPreview) {
      setTeams([...previewTeams]);
      return;
    }
    try {
      const result = await api.listTeams();
      setTeams(result.teams);
      setError(null);
    } catch (cause) {
      if (isUnsupportedRoute(cause)) setUnsupported(true);
      else setError(cause instanceof Error ? cause.message : "Couldn’t load teams.");
    }
  }, [simulatorPreview]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!isPending && !session && !simulatorPreview) return <Redirect href="/" />;

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      let team: TeamDto;
      if (simulatorPreview) {
        team = {
          id: `team_preview${Date.now().toString(36)}`,
          name: trimmed,
          role: "owner",
          memberCount: 1,
          appCount: 0,
          oncallGroupCount: 0,
          seats: { used: 1, available: 0, billable: 0 },
          plan: "free",
          createdAt: new Date().toISOString(),
        };
        previewTeams.push(team);
      } else {
        team = (await api.createTeam(trimmed)).team;
      }
      setName("");
      setCreating(false);
      setTeams((current) => [...(current ?? []), team]);
      router.push({ pathname: "/teams/[id]", params: { id: team.id } });
    } catch (cause) {
      Alert.alert("Couldn’t create team", cause instanceof Error ? cause.message : "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={ui.container}>
      <StatusBar style="dark" />
      <ScreenHeader fallback="/settings" title="Teams" />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={ui.scroll} keyboardShouldPersistTaps="handled">
          {unsupported ? (
            <Text style={ui.message}>This Hark server doesn’t support teams yet.</Text>
          ) : teams === null ? (
            error ? (
              <Text style={ui.message}>{error}</Text>
            ) : (
              <ActivityIndicator color={colors.accent} style={ui.loading} />
            )
          ) : (
            <>
              <Text style={[ui.muted, { marginTop: 4 }]}>
                Share apps with the people you work with and take turns being on call.
              </Text>
              <SectionLabel>Your teams</SectionLabel>
              {teams.length === 0 ? (
                <Text style={[ui.muted, { paddingBottom: 12 }]}>
                  You’re not on a team yet. Create one, or open an invite link from a teammate.
                </Text>
              ) : null}
              {teams.map((team, index) => (
                <Pressable
                  accessibilityHint="Shows members, invites and seats"
                  accessibilityLabel={`${team.name}, ${roleLabel(team.role)}, ${memberCountLabel(team.memberCount)}`}
                  accessibilityRole="button"
                  key={team.id}
                  onPress={() => router.push({ pathname: "/teams/[id]", params: { id: team.id } })}
                  style={({ pressed }) => [
                    ui.row,
                    index === teams.length - 1 && !creating && ui.lastRow,
                    pressed && ui.rowPressed,
                  ]}
                >
                  <PersonAvatar name={team.name} size={34} />
                  <View style={ui.rowCopy}>
                    <Text style={ui.rowLabel}>{team.name}</Text>
                    <Text style={ui.rowValue}>
                      {roleLabel(team.role)} · {memberCountLabel(team.memberCount)}
                      {team.appCount > 0
                        ? ` · ${team.appCount} app${team.appCount === 1 ? "" : "s"}`
                        : ""}
                    </Text>
                  </View>
                  <SymbolView name="chevron.right" size={12} tintColor={colors.soft} />
                </Pressable>
              ))}
              {creating ? (
                <View style={[ui.row, ui.lastRow, { paddingVertical: 14 }]}>
                  <View style={{ flex: 1, gap: 10 }}>
                    <TextInput
                      accessibilityLabel="Team name"
                      autoFocus
                      maxLength={60}
                      onChangeText={setName}
                      onSubmitEditing={() => void create()}
                      placeholder="Team name"
                      placeholderTextColor={colors.soft}
                      returnKeyType="done"
                      style={ui.input}
                      value={name}
                    />
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <PrimaryButton
                          busy={saving}
                          disabled={!name.trim()}
                          label="Create team"
                          onPress={() => void create()}
                        />
                      </View>
                      <Pressable
                        accessibilityLabel="Cancel"
                        accessibilityRole="button"
                        onPress={() => {
                          setCreating(false);
                          setName("");
                        }}
                        style={({ pressed }) => [
                          ui.secondaryButton,
                          { minHeight: 48 },
                          pressed && ui.secondaryButtonPressed,
                        ]}
                      >
                        <Text style={ui.secondaryButtonText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityLabel="New team"
                  accessibilityRole="button"
                  onPress={() => setCreating(true)}
                  style={({ pressed }) => [
                    ui.row,
                    teams.length === 0 && ui.lastRow,
                    pressed && ui.rowPressed,
                  ]}
                >
                  <View style={[ui.avatar, { width: 34, height: 34, borderRadius: 17 }]}>
                    <SymbolView name="plus" size={14} tintColor={colors.accent} weight="semibold" />
                  </View>
                  <Text style={[ui.rowLabel, { color: colors.accent }]}>New team</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
