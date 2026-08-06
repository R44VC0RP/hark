import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config: _config }: ConfigContext): ExpoConfig => ({
  name: "Hark",
  slug: "hark",
  version: "1.0.2",
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
      "com.apple.developer.siri": true,
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
      "expo-notifications",
      {
        enableBackgroundRemoteNotifications: true,
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
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? "0fce08a7-f312-4b58-a907-85a648113946",
    },
  },
});
