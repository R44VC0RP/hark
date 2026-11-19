import type { AppDto } from "@hark/contracts";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, type ScrollView, StyleSheet, View } from "react-native";
import {
  AppGrid,
  AppListRow,
  type GridGeometry,
  useGridGeometry,
} from "../../../../src/components/apps/app-tile";
import {
  refreshDirectory,
  useDirectory,
  useDirectoryLoadFailed,
} from "../../../../src/lib/app-directory";
import { groupAppsByTeam, memberCountLabel } from "../../../../src/lib/teams";
import { TabRootToolbar } from "../../../../src/ui/account-button";
import { EmptyState, ErrorState, LoadingState } from "../../../../src/ui/empty-state";
import { List, Section } from "../../../../src/ui/list";
import { useReduceMotion } from "../../../../src/ui/motion";
import { Text } from "../../../../src/ui/text";
import { colors, metrics, radius, space } from "../../../../src/ui/tokens";

/** How long after the tab first appears its search bar starts hiding on scroll. */
const SEARCH_SETTLE_MS = 500;
const ADD_APP_COMMAND = 'harkctl apps create --name "My app" --url https://…';

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Case-insensitive match on the app's name or host. */
function matches(app: AppDto, query: string): boolean {
  return app.name.toLowerCase().includes(query) || hostOf(app.origin).toLowerCase().includes(query);
}

/** A grid at default text sizes, rows at accessibility sizes (each row is a section row). */
function appsContent(apps: AppDto[], geometry: GridGeometry) {
  if (geometry.list) return apps.map((app) => <AppListRow app={app} key={app.id} />);
  return <AppGrid apps={apps} geometry={geometry} />;
}

/**
 * Apps (DESIGN.md 5.8), the launcher people open every day: your apps, then
 * one section per team, searchable by name or host. Tapping a tile opens the
 * web app at once (the directory already holds it); a long press offers App
 * Info and Safari. Data is the shared directory the tabs keep fresh; pull to
 * refresh reloads it.
 */
export default function AppsScreen() {
  const directory = useDirectory();
  const loadFailed = useDirectoryLoadFailed();
  const geometry = useGridGeometry();
  const [query, setQuery] = useState("");
  // UIKit starts a hide-when-scrolling search bar hidden. Showing it until
  // the tab has appeared, then turning hiding on, keeps it visible on arrival
  // (like Settings) and still tucks it away on scroll. Native tabs mount in
  // the background and focus before the tab is on screen, so hiding turns on
  // a moment after the first focus (a frame was too soon on iPad).
  const [hideSearchOnScroll, setHideSearchOnScroll] = useState(false);
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => setHideSearchOnScroll(true), SEARCH_SETTLE_MS);
      return () => clearTimeout(timer);
    }, []),
  );
  const [refreshing, setRefreshing] = useState(false);
  const params = useLocalSearchParams<{ team?: string }>();
  const highlightTeam = typeof params.team === "string" ? params.team : null;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshDirectory();
    } catch {
      // Keep the last apps on screen; only an empty screen shows the failure.
    } finally {
      setRefreshing(false);
    }
  };

  const apps = directory?.apps ?? [];
  const sections = useMemo(
    () => groupAppsByTeam(directory?.apps ?? [], directory?.teams ?? []),
    [directory],
  );
  const hasTeams = sections.teams.length > 0;
  const search = query.trim().toLowerCase();
  const results = useMemo(
    () => (search ? apps.filter((app) => matches(app, search)) : []),
    [apps, search],
  );

  const scrollView = useRef<ScrollView>(null);
  const sectionOffsets = useRef(new Map<string, number>());
  const headerHeight = useHeaderHeight();
  const headerHeightRef = useRef(headerHeight);
  headerHeightRef.current = headerHeight;
  const highlightReady = highlightTeam !== null && directory !== null;

  let content: ReactNode;
  if (directory === null) {
    content = loadFailed ? (
      <ErrorState
        onRetry={() => void refreshDirectory().catch(() => {})}
        title="Couldn't Load Apps"
      />
    ) : (
      <LoadingState />
    );
  } else if (search) {
    content =
      results.length > 0 ? (
        <Section bare={!geometry.list}>{appsContent(results, geometry)}</Section>
      ) : (
        <EmptyState
          message={`No apps match “${query.trim()}”.`}
          symbol="magnifyingglass"
          title="No Results"
        />
      );
  } else if (apps.length === 0 && !hasTeams) {
    content = (
      <View>
        <EmptyState
          style={styles.emptyWithCommand}
          message="Register any web app you run and open it here, already signed in with Hark. Ask an agent, or run:"
          symbol="square.grid.2x2"
          title="Your Apps Live Here"
        />
        <View style={styles.command}>
          <Text selectable style={styles.commandText} variant="footnote">
            {ADD_APP_COMMAND}
          </Text>
        </View>
      </View>
    );
  } else if (!hasTeams) {
    content = <Section bare={!geometry.list}>{appsContent(apps, geometry)}</Section>;
  } else {
    content = (
      <>
        <Section
          bare={!geometry.list}
          footer={
            sections.personal.length === 0 ? "Apps you add for yourself show up here." : undefined
          }
          prominent
          title="Yours"
        >
          {appsContent(sections.personal, geometry)}
        </Section>
        {sections.teams.map((section) => (
          <TeamSection
            highlighted={highlightReady && section.team.id === highlightTeam}
            key={section.team.id}
            onLayout={(y) => sectionOffsets.current.set(section.team.id, y)}
          >
            <Section
              bare={!geometry.list}
              detail={
                section.memberCount !== null ? memberCountLabel(section.memberCount) : undefined
              }
              footer={
                section.apps.length === 0
                  ? "No apps yet. Share one from its App Info, or add one with harkctl."
                  : undefined
              }
              prominent
              title={section.team.name}
            >
              {appsContent(section.apps, geometry)}
            </Section>
          </TeamSection>
        ))}
      </>
    );
  }

  // After joining a team (`/apps?team=`), bring its section under the header.
  useEffect(() => {
    if (!highlightReady || !highlightTeam) return;
    const timer = setTimeout(() => {
      const y = sectionOffsets.current.get(highlightTeam);
      if (y === undefined) return;
      scrollView.current?.scrollTo({
        y: Math.max(0, y - headerHeightRef.current),
        animated: true,
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [highlightReady, highlightTeam]);

  return (
    <>
      <Stack.SearchBar
        autoCapitalize="none"
        hideWhenScrolling={hideSearchOnScroll}
        onCancelButtonPress={() => setQuery("")}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        placeholder="Search Apps"
        placement="stacked"
      />
      <TabRootToolbar />
      <List
        onRefresh={directory || loadFailed ? () => void onRefresh() : undefined}
        ref={scrollView}
        refreshing={refreshing}
        variant="plain"
      >
        {content}
      </List>
    </>
  );
}

/**
 * A team's section, with the one-off tint after joining it (3.9): fades out
 * over 1.6 s, or holds for 1.5 s and goes with Reduce Motion. The tint is an
 * opacity on the native driver; nothing animates on scroll.
 */
function TeamSection({
  highlighted,
  onLayout,
  children,
}: {
  highlighted: boolean;
  onLayout: (y: number) => void;
  children: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const [tint] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!highlighted) return;
    tint.setValue(1);
    if (reduceMotion) {
      const timer = setTimeout(() => tint.setValue(0), 1500);
      return () => clearTimeout(timer);
    }
    const animation = Animated.timing(tint, {
      toValue: 0,
      duration: 1600,
      delay: 750,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [highlighted, reduceMotion, tint]);

  return (
    <View onLayout={(event) => onLayout(event.nativeEvent.layout.y)}>
      <Animated.View pointerEvents="none" style={[styles.tint, { opacity: tint }]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyWithCommand: {
    paddingBottom: space.m,
  },
  command: {
    alignSelf: "center",
    maxWidth: 480,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    borderRadius: radius.code,
    borderCurve: "continuous",
    backgroundColor: colors.fill,
  },
  commandText: {
    fontFamily: "Menlo",
    fontSize: 13,
    lineHeight: 18,
  },
  tint: {
    position: "absolute",
    top: metrics.sectionGap - space.xs,
    right: -space.xs,
    bottom: -space.xs,
    left: -space.xs,
    borderRadius: radius.section,
    borderCurve: "continuous",
    backgroundColor: colors.accentSoft,
  },
});
