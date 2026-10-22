import { API_ERROR_CODE_CONSENT_REQUIRED, type AppDto } from "@hark/contracts";
import * as Device from "expo-device";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { AppIcon } from "../../src/components/app-icon";
import { ApiError, api } from "../../src/lib/api";
import { isHttpUrl, openExternalLink } from "../../src/lib/inbox-body";
import { previewApps } from "../../src/lib/inbox-preview";
import { colors, fonts, tightTracking } from "../../src/lib/theme";
import {
  buildBridgeScript,
  buildResolveScript,
  cacheApps,
  cachedApp,
  isAppOrigin,
  isDarkColor,
  parseBridgeMessage,
  pickStripColor,
  resolveLaunchUrl,
} from "../../src/lib/web-apps";
import { clearWebsiteDataForOrigin } from "../../src/lib/website-data";

type Phase = "loading" | "consent" | "ready" | "error";

interface Pass {
  token: string;
  expiresAt: number;
}

const HINT_COUNT_KEY = "hark.webApps.hintCount";
const HINT_SHOWS = 3;
/** Reuse a prefetched pass only while it has comfortable validity left. */
const PASS_REUSE_MARGIN_MS = 30_000;

export default function WebAppScreen() {
  const params = useLocalSearchParams<{ id: string; url?: string }>();
  const id = String(params.id);
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const webView = useRef<WebView>(null);
  const prefetched = useRef<Pass | null>(null);
  const currentUrl = useRef<string | null>(null);
  const [app, setApp] = useState<AppDto | null>(() => cachedApp(id) ?? null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [stripColor, setStripColor] = useState("#FFFFFF");
  const [reloadKey, setReloadKey] = useState(0);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/apps");
  }, [router]);

  const issuePass = useCallback(
    async (input: Parameters<typeof api.getAppPass>[1] = {}): Promise<Pass> => {
      if (simulatorPreview) {
        return {
          token: `preview.${Date.now().toString(36)}.pass`,
          expiresAt: Date.now() + 120_000,
        };
      }
      const result = await api.getAppPass(id, input);
      cacheApps([result.app]);
      setApp(result.app);
      return { token: result.token, expiresAt: Date.parse(result.expiresAt) };
    },
    [id, simulatorPreview],
  );

  const start = useCallback(async () => {
    setPhase("loading");
    setErrorMessage(null);
    try {
      let current = cachedApp(id) ?? null;
      if (simulatorPreview) current = current ?? previewApps.find((item) => item.id === id) ?? null;
      else if (!current) current = (await api.getApp(id)).app;
      if (!current) throw new Error("This app is no longer available.");
      cacheApps([current]);
      setApp(current);
      if (!current.consentedAt) {
        setPhase("consent");
        return;
      }
      prefetched.current = await issuePass();
      setPhase("ready");
    } catch (error) {
      if (error instanceof ApiError && error.code === API_ERROR_CODE_CONSENT_REQUIRED) {
        setPhase("consent");
        return;
      }
      setErrorMessage(
        error instanceof ApiError && error.status === 404
          ? "This app was removed."
          : error instanceof Error
            ? error.message
            : "Couldn’t open this app.",
      );
      setPhase("error");
    }
  }, [id, issuePass, simulatorPreview]);

  useEffect(() => {
    void start();
  }, [start]);

  // The left-edge swipe walks back through the page's history first and only
  // returns to Hark once the web view is on its first page.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !canGoBack });
  }, [canGoBack, navigation]);

  const appUrl = app?.url;
  const appOriginValue = app?.origin;
  // Keyed on primitives so refreshed app metadata never reloads the page.
  const launchUrl = useMemo(
    () =>
      appUrl && appOriginValue
        ? resolveLaunchUrl({ url: appUrl, origin: appOriginValue }, params.url)
        : null,
    [appUrl, appOriginValue, params.url],
  );
  const bridgeScript = useMemo(
    () => (appOriginValue ? buildBridgeScript(appOriginValue) : ""),
    [appOriginValue],
  );

  const approve = async (sharing: { shareName: boolean; shareEmail: boolean }) => {
    if (!app) return;
    setPhase("loading");
    try {
      if (simulatorPreview) {
        const approved = { ...app, ...sharing, consentedAt: new Date().toISOString() };
        cacheApps([approved]);
        setApp(approved);
      }
      prefetched.current = await issuePass({ consent: true, ...sharing });
      setPhase("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Couldn’t sign in.");
      setPhase("error");
    }
  };

  const takePass = async (): Promise<string> => {
    const cached = prefetched.current;
    prefetched.current = null;
    if (cached && cached.expiresAt - Date.now() > PASS_REUSE_MARGIN_MS) return cached.token;
    return (await issuePass()).token;
  };

  const onMessage = (event: WebViewMessageEvent) => {
    if (!app) return;
    const message = parseBridgeMessage(event.nativeEvent.data);
    if (!message) return;
    // Only the app's own origin, in a frame that is currently on that origin, may ask.
    const topUrl = currentUrl.current ?? launchUrl;
    const fromAppOrigin =
      isAppOrigin(event.nativeEvent.url, app.origin) &&
      topUrl !== null &&
      isAppOrigin(topUrl, app.origin);
    if (message.type === "theme") {
      if (!fromAppOrigin) return;
      const color = pickStripColor(message.color, message.background);
      if (color) setStripColor(color);
      return;
    }
    if (message.type === "close") {
      if (fromAppOrigin) close();
      return;
    }
    if (message.type === "menu") {
      if (fromAppOrigin) showMenu();
      return;
    }
    if (!fromAppOrigin) return;
    void takePass()
      .then((token) => {
        webView.current?.injectJavaScript(buildResolveScript(app.origin, message.id, { token }));
      })
      .catch((error: unknown) => {
        const code =
          error instanceof ApiError && error.code === API_ERROR_CODE_CONSENT_REQUIRED
            ? "consent_required"
            : "unavailable";
        webView.current?.injectJavaScript(
          buildResolveScript(app.origin, message.id, { error: code }),
        );
      });
  };

  // Every top-frame exit is confirmed with its destination; links back into
  // Hark are dropped by the shared link policy.
  const openOutside = (url: string) => {
    if (!app) return;
    const appName = app.name;
    const signInHost = new URL(app.origin).host;
    void openExternalLink(
      url,
      {
        openUrl: (target) => Linking.openURL(target),
        confirm: (target, label) =>
          new Promise((resolve) => {
            const web = isHttpUrl(target);
            Alert.alert(
              web ? `This link leaves ${appName}` : "Open in another app?",
              web
                ? `It opens ${label} in Safari. Your Hark sign-in stays with ${signInHost}.`
                : `${appName} wants to open ${target}`,
              [
                { text: `Stay in ${appName}`, style: "cancel", onPress: () => resolve(false) },
                { text: web ? "Open in Safari" : "Open", onPress: () => resolve(true) },
              ],
            );
          }),
      },
      { confirmHttp: true },
    );
  };

  const onShouldStartLoad = (request: ShouldStartLoadRequest): boolean => {
    if (!app) return false;
    if (!request.isTopFrame) return true;
    if (request.url.startsWith("about:")) return true;
    if (isAppOrigin(request.url, app.origin)) return true;
    openOutside(request.url);
    return false;
  };

  const stopSigningIn = () => {
    if (!app) return;
    Alert.alert(
      `Stop signing in to ${app.name}?`,
      `Hark will stop sending passes to ${new URL(app.origin).host}. Its saved data on this iPhone is cleared too.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop signing in",
          style: "destructive",
          onPress: () => {
            const done = () => close();
            if (simulatorPreview) return done();
            void Promise.all([
              api
                .revokeApp(app.id)
                .then((result) => cacheApps([result.app]))
                .catch(() => {}),
              clearWebsiteDataForOrigin(app.origin),
            ]).finally(done);
          },
        },
      ],
    );
  };

  const showMenu = () => {
    if (!app) return;
    const options = [
      "Back to Hark",
      "Reload",
      "Open in Safari",
      "App info",
      "Stop signing in",
      "Cancel",
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: app.name,
        message: `Signed in with Hark on ${new URL(app.origin).host}`,
        options,
        destructiveButtonIndex: 4,
        cancelButtonIndex: 5,
      },
      (index) => {
        if (index === 0) close();
        else if (index === 1) webView.current?.reload();
        else if (index === 2) {
          // Safari never receives a pass, so the page opens signed out there.
          void Linking.openURL(currentUrl.current ?? app.url).catch(() => {});
        } else if (index === 3) router.push({ pathname: "/apps/[id]", params: { id: app.id } });
        else if (index === 4) stopSigningIn();
      },
    );
  };

  if (phase === "consent" && app) {
    return <ConsentView app={app} onApprove={approve} onCancel={close} />;
  }

  if (phase === "error" || (phase === "ready" && !launchUrl)) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <StatusBar style="dark" />
        {app ? <AppIcon iconUrl={app.iconUrl} name={app.name} size={56} /> : null}
        <Text style={styles.centerTitle}>Couldn’t open {app?.name ?? "this app"}</Text>
        <Text style={styles.centerBody}>{errorMessage ?? "Something went wrong."}</Text>
        <View style={styles.centerActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void start()}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>Try again</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={close} style={styles.textButton}>
            <Text style={styles.textButtonLabel}>Back to Hark</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (phase !== "ready" || !app || !launchUrl) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <StatusBar style="dark" />
        {app ? <AppIcon iconUrl={app.iconUrl} name={app.name} size={64} /> : null}
        <Text style={styles.centerTitle}>Signing you in…</Text>
        <Text style={styles.centerBody}>
          {app ? `Getting your Hark pass for ${new URL(app.origin).host}` : "Opening app"}
        </Text>
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: stripColor }]}>
      <StatusBar style={isDarkColor(stripColor) ? "light" : "dark"} />
      {/*
        iOS keeps status-bar touches for itself, so this strip mainly serves
        VoiceOver; people open the menu with a two-finger hold on the page.
      */}
      <Pressable
        accessibilityHint="Shows Hark options"
        accessibilityLabel="Hark menu"
        accessibilityRole="button"
        delayLongPress={400}
        onLongPress={showMenu}
        onPress={showMenu}
        style={{ height: insets.top, backgroundColor: stripColor }}
      />
      <WebView
        allowsBackForwardNavigationGestures={canGoBack}
        allowsInlineMediaPlayback
        applicationNameForUserAgent="Hark"
        contentInsetAdjustmentBehavior="automatic"
        injectedJavaScriptBeforeContentLoaded={bridgeScript}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        key={reloadKey}
        onContentProcessDidTerminate={() => setReloadKey((key) => key + 1)}
        onError={(event) => {
          setErrorMessage(event.nativeEvent.description || "The page couldn’t be loaded.");
          setPhase("error");
        }}
        onMessage={onMessage}
        onNavigationStateChange={(state) => {
          currentUrl.current = state.url;
          setCanGoBack(state.canGoBack);
        }}
        onOpenWindow={(event) => {
          const target = event.nativeEvent.targetUrl;
          if (isAppOrigin(target, app.origin)) {
            webView.current?.injectJavaScript(
              `window.location.assign(${JSON.stringify(target)}); true;`,
            );
          } else openOutside(target);
        }}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        originWhitelist={["*"]}
        ref={webView}
        source={{ uri: launchUrl }}
        // Matches the page so the home-indicator inset never shows a white band.
        style={[styles.webView, { backgroundColor: stripColor }]}
        webviewDebuggingEnabled={__DEV__}
      />
      <HoldHint top={insets.top} />
    </View>
  );
}

/** Briefly teaches the hidden gesture on the first few opens. */
function HoldHint({ top }: { top: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void SecureStore.getItemAsync(HINT_COUNT_KEY).then((value) => {
      const count = Number(value ?? 0);
      if (cancelled || count >= HINT_SHOWS) return;
      void SecureStore.setItemAsync(HINT_COUNT_KEY, String(count + 1));
      setVisible(true);
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.delay(2600),
        Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]).start(() => {
        if (!cancelled) setVisible(false);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [opacity]);

  if (!visible) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.hint, { top: top + 8, opacity }]}>
      <View style={styles.hintDot} />
      <Text style={styles.hintText}>
        Hold two fingers for Hark · swipe from the left edge to go back
      </Text>
    </Animated.View>
  );
}

function ConsentView({
  app,
  onApprove,
  onCancel,
}: {
  app: AppDto;
  onApprove: (sharing: { shareName: boolean; shareEmail: boolean }) => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [shareName, setShareName] = useState(app.shareName);
  const [shareEmail, setShareEmail] = useState(app.shareEmail);
  const host = new URL(app.origin).host;

  return (
    <View style={[styles.consent, { paddingTop: insets.top, paddingBottom: insets.bottom + 12 }]}>
      <StatusBar style="dark" />
      <View style={styles.consentHeader}>
        <Pressable
          accessibilityLabel="Close"
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <SymbolView name="xmark" size={13} tintColor={colors.ink} weight="semibold" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.consentScroll}>
        <View style={styles.identity}>
          <AppIcon iconUrl={app.iconUrl} name={app.name} size={56} />
          <View style={styles.identityCopy}>
            <Text style={styles.consentTitle}>Sign in to {app.name}?</Text>
            <Text style={styles.consentHost}>{host}</Text>
          </View>
        </View>
        <Text style={styles.consentBody}>
          Hark gives {app.name} a one-time pass that proves it’s you. It only works on this site and
          expires in 2 minutes.
        </Text>
        <Text style={styles.sectionLabel}>Shared with {app.name}</Text>
        <View style={styles.shareRow}>
          <View style={styles.shareCopy}>
            <Text style={styles.shareLabel}>Hark ID</Text>
            <Text style={styles.shareValue}>A private ID made just for this app</Text>
          </View>
          <Text style={styles.always}>Always</Text>
        </View>
        <SharingSwitch label="Name" onChange={setShareName} value={shareName} />
        <SharingSwitch label="Email" onChange={setShareEmail} value={shareEmail} />
      </ScrollView>
      <View style={styles.consentActions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onApprove({ shareName, shareEmail })}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Not now</Text>
        </Pressable>
        {app.team ? (
          <Text style={styles.footnote}>
            Shared with {app.team.name}
            {app.addedBy ? ` · ${app.addedBy} added this` : ""}
          </Text>
        ) : app.createdBy ? (
          <Text style={styles.footnote}>Added by {app.createdBy}</Text>
        ) : null}
      </View>
    </View>
  );
}

function SharingSwitch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.shareRow}>
      <View style={styles.shareCopy}>
        <Text style={styles.shareLabel}>{label}</Text>
        <Text style={styles.shareValue}>{value ? "Shared" : "Not shared"}</Text>
      </View>
      <Switch
        accessibilityLabel={`Share ${label.toLowerCase()}`}
        onValueChange={onChange}
        trackColor={{ true: colors.accent, false: colors.line }}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webView: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 32,
    backgroundColor: colors.paper,
  },
  centerTitle: {
    marginTop: 8,
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 17,
    textAlign: "center",
    letterSpacing: tightTracking(17),
  },
  centerBody: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    letterSpacing: tightTracking(13),
  },
  centerActions: {
    alignSelf: "stretch",
    gap: 4,
    marginTop: 18,
  },
  spinner: {
    marginTop: 8,
  },
  hint: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "rgba(23, 23, 19, 0.88)",
  },
  hintDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#5ED8B7",
  },
  hintText: {
    color: "#FFFFFF",
    fontFamily: fonts.medium,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  consent: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  consentHeader: {
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  closeButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "#F2F1ED",
  },
  consentScroll: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 24,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  identityCopy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  consentTitle: {
    color: colors.ink,
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: tightTracking(22),
  },
  consentHost: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    letterSpacing: tightTracking(13),
  },
  consentBody: {
    marginTop: 20,
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: tightTracking(15),
  },
  sectionLabel: {
    marginTop: 26,
    paddingBottom: 8,
    color: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  shareRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  shareCopy: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  shareLabel: {
    color: colors.ink,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  shareValue: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    letterSpacing: tightTracking(12),
  },
  always: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  consentActions: {
    gap: 4,
    paddingHorizontal: 24,
  },
  primaryButton: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontFamily: fonts.medium,
    fontSize: 16,
    letterSpacing: tightTracking(16),
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  textButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  textButtonLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: tightTracking(14),
  },
  footnote: {
    color: colors.soft,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    letterSpacing: tightTracking(12),
  },
});
