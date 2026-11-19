import { API_ERROR_CODE_CONSENT_REQUIRED, type AppDto } from "@hark/contracts";
import * as Device from "expo-device";
import { Stack, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { useActionSheet } from "../../src/components/apps/action-sheet";
import { ConsentView } from "../../src/components/web/consent-view";
import { HoldHint } from "../../src/components/web/hold-hint";
import { LaunchErrorView, SigningInView } from "../../src/components/web/launch-state";
import { WebBarItems, type WebChrome, webHeaderOptions } from "../../src/components/web/web-header";
import { ApiError, api } from "../../src/lib/api";
import { isHttpUrl, openExternalLink } from "../../src/lib/inbox-body";
import { previewApps } from "../../src/lib/inbox-preview";
import { onKeyCommand } from "../../src/lib/key-commands";
import { deviceNoun, useLayout } from "../../src/lib/layout";
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
import { palette } from "../../src/ui/tokens";

type Phase = "loading" | "consent" | "ready" | "error";

interface Pass {
  token: string;
  expiresAt: number;
}

/** Reuse a prefetched pass only while it has comfortable validity left. */
const PASS_REUSE_MARGIN_MS = 30_000;

/**
 * Apps whose page last asked for `viewport-fit=cover`, so reopening one
 * starts edge to edge instead of jumping once the page reports it again.
 */
const edgeToEdgeApps = new Set<string>();

/**
 * Each app's last reported theme colour, so reopening it paints the strip,
 * the iPad bar and the page background in its colour from the first frame
 * instead of flashing paper first.
 */
const stripColors = new Map<string, string>();

/**
 * A web app, signed in with a Hark pass (DESIGN.md 5.11).
 *
 * iPhone and compact windows keep the chromeless contract web-app authors
 * build for: no header, a status strip in the page's colour, a two-finger
 * hold for the Hark menu, the left-edge swipe walking page history first.
 * The first opens teach the gesture with a Liquid Glass hint.
 *
 * iPad regular windows get the native navigation bar in the page's colour
 * with glass items: Close, Back, Forward, Reload; Open in Safari, App Info,
 * Switch App and More (Stop Signing In).
 */
export default function WebAppScreen() {
  const params = useLocalSearchParams<{ id: string; url?: string }>();
  const id = String(params.id);
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const simulatorPreview = __DEV__ && !Device.isDevice;
  const webView = useRef<WebView>(null);
  // The pass requested while the page starts loading; the page's first
  // getToken() takes it (or a fresh one when it failed or is about to expire).
  const prefetched = useRef<Promise<Pass> | null>(null);
  const currentUrl = useRef<string | null>(null);
  const [app, setApp] = useState<AppDto | null>(() => cachedApp(id) ?? null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The app is gone (404): trying again can't help, only Back to Hark.
  const [removed, setRemoved] = useState(false);
  // "Signing you in…" stays over the web view until its first page has
  // loaded, so opening an app never shows a blank page.
  const [pageLoaded, setPageLoaded] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  // iPad-sized windows get the native bar instead of the hidden two-finger menu.
  const { regular } = useLayout();
  const [stripColor, setStripColor] = useState(() => stripColors.get(id) ?? palette.background);
  const [reloadKey, setReloadKey] = useState(0);
  // Safari's rule: a page that sets viewport-fit=cover draws under the status
  // bar and home indicator and handles the edges with env(safe-area-inset-*).
  // Other pages keep Hark's status strip and the system's insets.
  const [edgeToEdge, setEdgeToEdge] = useState(() => edgeToEdgeApps.has(id));

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
    setRemoved(false);
    setPageLoaded(false);
    try {
      let current = cachedApp(id) ?? null;
      if (simulatorPreview) current = current ?? previewApps.find((item) => item.id === id) ?? null;
      else if (!current) current = (await api.getApp(id)).app;
      if (!current) {
        setRemoved(true);
        throw new Error("This app is no longer available.");
      }
      cacheApps([current]);
      setApp(current);
      if (!current.consentedAt) {
        setPhase("consent");
        return;
      }
      // The page starts loading while its pass is issued; a failure still
      // ends in consent or the error view below.
      const pass = issuePass();
      prefetched.current = pass;
      setPhase("ready");
      await pass;
    } catch (error) {
      if (error instanceof ApiError && error.code === API_ERROR_CODE_CONSENT_REQUIRED) {
        setPhase("consent");
        return;
      }
      if (error instanceof ApiError && error.status === 404) setRemoved(true);
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

  // Stable page actions, shared by the iPad bar, the Hark menu and ⌘ keys.
  const goBack = useCallback(() => webView.current?.goBack(), []);
  const goForward = useCallback(() => webView.current?.goForward(), []);
  const reload = useCallback(() => webView.current?.reload(), []);
  const appId = app?.id;
  const appUrlForSafari = app?.url;
  // Safari never receives a pass, so the page opens signed out there.
  const openInSafari = useCallback(() => {
    const target = currentUrl.current ?? appUrlForSafari;
    if (target) void Linking.openURL(target).catch(() => {});
  }, [appUrlForSafari]);
  const showAppInfo = useCallback(() => {
    if (appId) router.push({ pathname: "/apps/[id]", params: { id: appId, from: "web" } });
  }, [appId, router]);

  // ⌘R, ⌘[, ⌘] and ⌘W from a hardware keyboard, while this app is in front.
  useFocusEffect(
    useCallback(() => {
      const subscriptions = [
        onKeyCommand("reload", reload),
        onKeyCommand("back", goBack),
        onKeyCommand("forward", goForward),
        onKeyCommand("close", close),
      ];
      return () => {
        for (const unsubscribe of subscriptions) unsubscribe();
      };
    }, [close, goBack, goForward, reload]),
  );

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
      const pass = issuePass({ consent: true, ...sharing });
      prefetched.current = pass;
      await pass;
      setPhase("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Couldn’t sign in.");
      setPhase("error");
    }
  };

  const takePass = async (): Promise<string> => {
    const pending = prefetched.current;
    prefetched.current = null;
    const cached = pending ? await pending.catch(() => null) : null;
    if (cached && cached.expiresAt - Date.now() > PASS_REUSE_MARGIN_MS) return cached.token;
    return (await issuePass()).token;
  };

  const stopSigningIn = useCallback(() => {
    if (!app) return;
    Alert.alert(
      `Stop Signing In to ${app.name}?`,
      `Hark will stop sending passes to ${new URL(app.origin).host}. Its saved data on this ${deviceNoun} is cleared too.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Stop Signing In",
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
  }, [app, close, simulatorPreview]);

  // The Hark menu: a two-finger hold on the page (or VoiceOver's action on
  // the status strip). On iPad the same actions live in the bar; a hold there
  // shows this sheet as a centred popover, with the shield over the page so
  // the tap that closes it never reaches the page.
  const actionSheet = useActionSheet();
  const showMenu = () => {
    if (!app) return;
    actionSheet.show(
      {
        title: app.name,
        message: `Signed in with Hark on ${new URL(app.origin).host}`,
        options: [
          "Back to Hark",
          "Reload",
          "Open in Safari",
          "App Info",
          "Stop Signing In",
          "Cancel",
        ],
        destructiveButtonIndex: 4,
        cancelButtonIndex: 5,
      },
      (index) => {
        if (index === 0) close();
        else if (index === 1) reload();
        else if (index === 2) openInSafari();
        else if (index === 3) showAppInfo();
        else if (index === 4) stopSigningIn();
      },
    );
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
    if (message.type === "viewport") {
      if (!fromAppOrigin) return;
      if (message.cover) edgeToEdgeApps.add(id);
      else edgeToEdgeApps.delete(id);
      setEdgeToEdge(message.cover);
      return;
    }
    if (message.type === "theme") {
      if (!fromAppOrigin) return;
      const color = pickStripColor(message.color, message.background);
      if (color) {
        stripColors.set(id, color);
        setStripColor(color);
      }
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
              web ? `This Link Leaves ${appName}` : "Open in Another App?",
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

  const failed = phase === "error" || (phase === "ready" && !launchUrl);
  const ready = phase === "ready" && app !== null && launchUrl !== null;
  const chrome: WebChrome = phase === "consent" ? "close" : regular ? "bar" : "none";
  const appName = app?.name ?? "";
  // One options object per change: in-page options re-apply whenever it changes.
  const headerOptions = useMemo(
    () => webHeaderOptions(chrome, { color: stripColor, title: appName }),
    [appName, chrome, stripColor],
  );

  let content: ReactNode;
  if (phase === "consent" && app) {
    content = <ConsentView app={app} onApprove={approve} onCancel={close} />;
  } else if (failed) {
    content = (
      <>
        <StatusBar style="dark" />
        <LaunchErrorView
          app={app}
          message={errorMessage ?? "Something went wrong."}
          onClose={close}
          onRetry={removed ? undefined : () => void start()}
        />
      </>
    );
  } else if (!ready || !app || !launchUrl) {
    content = (
      <>
        <StatusBar style="dark" />
        <SigningInView app={app} />
      </>
    );
  } else {
    content = (
      <View style={[styles.container, { backgroundColor: stripColor }]}>
        <StatusBar style={isDarkColor(stripColor) ? "light" : "dark"} />
        {chrome === "bar" ? null : edgeToEdge ? (
          // Edge to edge, nothing native may sit on the page: the menu button is
          // for VoiceOver only (an action on an element that takes no touches).
          // Everyone else opens the menu with a two-finger hold on the page.
          <View
            accessibilityActions={[{ name: "activate" }]}
            accessibilityHint="Shows Hark options"
            accessibilityLabel="Hark menu"
            accessibilityRole="button"
            accessible
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "activate") showMenu();
            }}
            pointerEvents="none"
            style={[styles.menuOverlay, { height: insets.top }]}
          />
        ) : (
          /*
            iOS keeps status-bar touches for itself, so this strip mainly serves
            VoiceOver; people open the menu with a two-finger hold on the page.
          */
          <Pressable
            accessibilityHint="Shows Hark options"
            accessibilityLabel="Hark menu"
            accessibilityRole="button"
            delayLongPress={400}
            onLongPress={showMenu}
            onPress={showMenu}
            style={{ height: insets.top, backgroundColor: stripColor }}
          />
        )}
        <WebView
          allowsBackForwardNavigationGestures={canGoBack}
          allowsInlineMediaPlayback
          applicationNameForUserAgent="Hark"
          // Edge to edge, WebKit gets the real safe area, so the page's
          // env(safe-area-inset-*) values are the device's, not 0.
          automaticallyAdjustContentInsets={!edgeToEdge}
          contentInsetAdjustmentBehavior={edgeToEdge ? "never" : "automatic"}
          injectedJavaScriptBeforeContentLoaded={bridgeScript}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          key={reloadKey}
          onContentProcessDidTerminate={() => setReloadKey((key) => key + 1)}
          onLoadEnd={() => setPageLoaded(true)}
          onError={(event) => {
            setErrorMessage(event.nativeEvent.description || "The page couldn’t be loaded.");
            setPhase("error");
          }}
          onMessage={onMessage}
          onNavigationStateChange={(state) => {
            currentUrl.current = state.url;
            setCanGoBack(state.canGoBack);
            setCanGoForward(state.canGoForward);
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
        {chrome === "bar" ? null : <HoldHint top={insets.top} />}
        {pageLoaded ? null : (
          <View style={styles.cover}>
            <StatusBar style="dark" />
            <SigningInView app={app} />
          </View>
        )}
        {actionSheet.shield}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={headerOptions} />
      {chrome === "bar" ? (
        <WebBarItems
          app={app}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={goBack}
          onClose={close}
          onForward={goForward}
          onInfo={showAppInfo}
          onReload={reload}
          onSafari={openInSafari}
          onStopSigningIn={stopSigningIn}
          ready={ready}
        />
      ) : null}
      {content}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webView: {
    flex: 1,
  },
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 5,
  },
  menuOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    left: 0,
    zIndex: 1,
  },
});
