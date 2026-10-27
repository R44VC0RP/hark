import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Critical Alerts need an entitlement Apple grants on request. Leave this off
 * until Apple approves it: with it on, the build asks for an entitlement the
 * provisioning profile doesn't have and signing fails. Set
 * `HARK_CRITICAL_ALERTS=1` in the build environment (EAS profile `env`) once
 * the App ID has the capability.
 */
const criticalAlerts = process.env.HARK_CRITICAL_ALERTS === "1";

export default ({ config: _config }: ConfigContext): ExpoConfig => ({
  name: "Hark",
  slug: "hark",
  version: "1.3",
  icon: "./assets/icon.png",
  scheme: "hark",
  orientation: "portrait",
  userInterfaceStyle: "light",
  platforms: ["ios"],
  ios: {
    bundleIdentifier: "ceo.ryan.hark",
    usesAppleSignIn: true,
    icon: "./assets/icon.png",
    supportsTablet: false,
    // Communication Notifications + SiriKit. `aps-environment` is managed by
    // EAS capability sync but included so bare prebuilds get push entitlements.
    entitlements: {
      "aps-environment": "development",
      "com.apple.developer.usernotifications.communication": true,
      // Without this, iOS delivers interruptionLevel "time-sensitive" pushes
      // (on-call pages) as ordinary alerts that Focus can silence.
      "com.apple.developer.usernotifications.time-sensitive": true,
      "com.apple.developer.siri": true,
      ...(criticalAlerts ? { "com.apple.developer.usernotifications.critical-alerts": true } : {}),
    },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSUserActivityTypes: ["INSendMessageIntent"],
    },
  },
  plugins: [
    "./plugins/with-ios-scene-delegate",
    "expo-router",
    "expo-apple-authentication",
    "expo-secure-store",
    [
      "expo-alternate-app-icons",
      [
        {
          name: "Teal",
          ios: "./assets/app-icons/teal.png",
          android: {
            foregroundImage: "./assets/app-icons/teal.png",
            backgroundColor: "#09606B",
          },
        },
        {
          name: "Blue",
          ios: "./assets/app-icons/blue.png",
          android: {
            foregroundImage: "./assets/app-icons/blue.png",
            backgroundColor: "#245493",
          },
        },
        {
          name: "Indigo",
          ios: "./assets/app-icons/indigo.png",
          android: {
            foregroundImage: "./assets/app-icons/indigo.png",
            backgroundColor: "#414781",
          },
        },
        {
          name: "Violet",
          ios: "./assets/app-icons/violet.png",
          android: {
            foregroundImage: "./assets/app-icons/violet.png",
            backgroundColor: "#66437D",
          },
        },
        {
          name: "Rose",
          ios: "./assets/app-icons/rose.png",
          android: {
            foregroundImage: "./assets/app-icons/rose.png",
            backgroundColor: "#84465F",
          },
        },
        {
          name: "Red",
          ios: "./assets/app-icons/red.png",
          android: {
            foregroundImage: "./assets/app-icons/red.png",
            backgroundColor: "#8D403D",
          },
        },
        {
          name: "Orange",
          ios: "./assets/app-icons/orange.png",
          android: {
            foregroundImage: "./assets/app-icons/orange.png",
            backgroundColor: "#925134",
          },
        },
        {
          name: "Gold",
          ios: "./assets/app-icons/gold.png",
          android: {
            foregroundImage: "./assets/app-icons/gold.png",
            backgroundColor: "#80651F",
          },
        },
        {
          name: "Black",
          ios: "./assets/app-icons/black.png",
          android: {
            foregroundImage: "./assets/app-icons/black.png",
            backgroundColor: "#292D2C",
          },
        },
      ],
    ],
    [
      "expo-notifications",
      {
        enableBackgroundRemoteNotifications: true,
        // Alarm for on-call pages (generated, 28 s, under the 30 s iOS limit).
        sounds: ["./assets/sounds/hark-page.caf"],
      },
    ],
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#035B49",
      },
    ],
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "16.4",
        },
      },
    ],
    [
      "expo-widgets",
      {
        bundleIdentifier: "ceo.ryan.hark.widgets",
        groupIdentifier: "group.ceo.ryan.hark",
        enablePushNotifications: true,
        frequentUpdates: true,
      },
    ],
    [
      "@bacons/apple-targets",
      {
        appleTeamId: process.env.APPLE_TEAM_ID ?? "9G68SMNHEU",
      },
    ],
  ],
  extra: {
    /** Read by the app to decide whether to offer the Critical Alerts prompt. */
    criticalAlerts,
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? "0fce08a7-f312-4b58-a907-85a648113946",
    },
  },
});
