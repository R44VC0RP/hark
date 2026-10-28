import type { AppDto } from "@hark/contracts";

/**
 * Pure helpers for Hark web apps: launch URL resolution, the JavaScript bridge
 * injected into the web view, and bridge message parsing. Kept free of React
 * Native imports so they stay unit-testable.
 */

/** Name of the hidden resolver the native side calls to settle `getToken()`. */
const RESOLVER = "__harkBridgeResolve";

export type BridgeMessage =
  | { type: "getToken"; id: string }
  | { type: "close" }
  | { type: "menu" }
  | { type: "theme"; color: string | null; background: string | null }
  | { type: "viewport"; cover: boolean };

export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function isAppOrigin(url: string, origin: string): boolean {
  return originOf(url) === origin;
}

/** Opens a requested deep URL only when it belongs to the app; otherwise its launch URL. */
export function resolveLaunchUrl(app: Pick<AppDto, "url" | "origin">, requested?: string): string {
  if (requested && isAppOrigin(requested, app.origin)) return requested;
  return app.url;
}

/**
 * Defines `window.hark` at document start in the main frame, but only while
 * the page is on the app origin. The pass itself is never embedded in the
 * script: each `getToken()` asks native code, which re-checks the origin of
 * the requesting frame before answering.
 */
export function buildBridgeScript(origin: string): string {
  return `(function () {
  var ORIGIN = ${JSON.stringify(origin)};
  if (window.location.origin !== ORIGIN || window.hark) return;
  var pending = {};
  var sequence = 0;
  // Whether the page asked for viewport-fit=cover; null until first read.
  var cover = null;
  function send(message) {
    var bridge = window.ReactNativeWebView;
    if (bridge) bridge.postMessage(JSON.stringify(message));
    else window.webkit.messageHandlers.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  Object.defineProperty(window, ${JSON.stringify(RESOLVER)}, {
    value: function (id, error, token) {
      var entry = pending[id];
      if (!entry) return;
      delete pending[id];
      if (error) entry.reject(new Error(error));
      else entry.resolve(token);
    },
  });
  Object.defineProperty(window, "hark", {
    value: Object.freeze({
      version: 1,
      getToken: function () {
        return new Promise(function (resolve, reject) {
          var id = String(++sequence);
          pending[id] = { resolve: resolve, reject: reject };
          send({ hark: 1, type: "getToken", id: id });
        });
      },
      close: function () {
        send({ hark: 1, type: "close" });
      },
      // True while the page opted into edge to edge (viewport-fit=cover):
      // Hark then draws it under the status bar and home indicator, and
      // env(safe-area-inset-*) reports the real insets.
      get edgeToEdge() {
        return cover === true;
      },
    }),
  });
  // A still two-finger hold opens the Hark menu. Movement or a changing
  // spread (pinch zoom, two-finger scroll) cancels it.
  var hold = null;
  function touchPair(event) {
    var a = event.touches[0];
    var b = event.touches[1];
    return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
  }
  function cancelHold() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  }
  document.addEventListener("touchstart", function (event) {
    cancelHold();
    if (event.touches.length !== 2) return;
    hold = { start: touchPair(event), timer: setTimeout(function () {
      hold = null;
      send({ hark: 1, type: "menu" });
    }, 450) };
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", function (event) {
    if (!hold) return;
    if (event.touches.length !== 2) return cancelHold();
    var now = touchPair(event);
    if (Math.abs(now.x - hold.start.x) > 14 || Math.abs(now.y - hold.start.y) > 14 || Math.abs(now.d - hold.start.d) > 14) cancelHold();
  }, { capture: true, passive: true });
  document.addEventListener("touchend", cancelHold, { capture: true, passive: true });
  document.addEventListener("touchcancel", cancelHold, { capture: true, passive: true });
  function reportTheme() {
    var meta = document.querySelector('meta[name="theme-color"]');
    var background = document.body ? window.getComputedStyle(document.body).backgroundColor : null;
    send({ hark: 1, type: "theme", color: meta ? meta.getAttribute("content") : null, background: background });
  }
  // Safari's opt-in for drawing under the status bar and home indicator.
  function reportViewport() {
    var meta = document.querySelector('meta[name="viewport"]');
    var content = meta ? meta.getAttribute("content") || "" : "";
    var next = /(^|[,;\\s])viewport-fit\\s*=\\s*cover(?![\\w-])/i.test(content);
    if (next === cover) return;
    cover = next;
    send({ hark: 1, type: "viewport", cover: next });
  }
  function start() {
    reportTheme();
    reportViewport();
    // Pages (and frameworks) can add or edit the viewport meta later.
    new MutationObserver(reportViewport).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["content", "name"],
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
true;`;
}

/** Script that settles one pending `getToken()` call, guarded by origin again. */
export function buildResolveScript(
  origin: string,
  id: string,
  result: { token: string } | { error: string },
): string {
  const error = "error" in result ? result.error : null;
  const token = "token" in result ? result.token : null;
  return `(function () {
  if (window.location.origin !== ${JSON.stringify(origin)}) return;
  var resolve = window[${JSON.stringify(RESOLVER)}];
  if (resolve) resolve(${JSON.stringify(id)}, ${JSON.stringify(error)}, ${JSON.stringify(token)});
})();
true;`;
}

export function parseBridgeMessage(data: string): BridgeMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.hark !== 1) return null;
  if (record.type === "getToken" && typeof record.id === "string" && record.id.length <= 32) {
    return { type: "getToken", id: record.id };
  }
  if (record.type === "close") return { type: "close" };
  if (record.type === "menu") return { type: "menu" };
  if (record.type === "viewport" && typeof record.cover === "boolean") {
    return { type: "viewport", cover: record.cover };
  }
  if (record.type === "theme") {
    return {
      type: "theme",
      color: typeof record.color === "string" ? record.color.slice(0, 64) : null,
      background: typeof record.background === "string" ? record.background.slice(0, 64) : null,
    };
  }
  return null;
}

/**
 * Picks the status-strip color from the page: `theme-color` first, then the
 * body background, ignoring transparent values. Only simple hex and rgb()
 * forms are accepted so arbitrary CSS never reaches native styles.
 */
export function pickStripColor(color: string | null, background: string | null): string | null {
  for (const candidate of [color, background]) {
    if (!candidate) continue;
    const value = candidate.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value;
    const rgb = value.match(/^rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*([\d.]+))?\)$/i);
    if (rgb) {
      if (rgb[4] !== undefined && Number(rgb[4]) < 1) continue;
      return `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
    }
  }
  return null;
}

/** Relative luminance check used to choose a light or dark status bar. */
export function isDarkColor(color: string): boolean {
  let r: number;
  let g: number;
  let b: number;
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex?.[1]) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : hex[1];
    r = Number.parseInt(digits.slice(0, 2), 16);
    g = Number.parseInt(digits.slice(2, 4), 16);
    b = Number.parseInt(digits.slice(4, 6), 16);
  } else {
    const rgb = color.match(/^rgb\((\d{1,3}), (\d{1,3}), (\d{1,3})\)$/);
    if (!rgb) return false;
    r = Number(rgb[1]);
    g = Number(rgb[2]);
    b = Number(rgb[3]);
  }
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}

const FALLBACK_TINTS = [
  { background: "#171713", foreground: "#FAFAF9" },
  { background: "#E7F0ED", foreground: "#035B49" },
  { background: "#2F55D4", foreground: "#FFFFFF" },
  { background: "#F3C53C", foreground: "#171713" },
  { background: "#E7E5E0", foreground: "#171713" },
] as const;

/** Deterministic letter-tile colors for apps without an icon. */
export function fallbackTint(name: string): (typeof FALLBACK_TINTS)[number] {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return FALLBACK_TINTS[hash % FALLBACK_TINTS.length] ?? FALLBACK_TINTS[0];
}

/** Short in-memory cache so the web view opens without waiting on the list request. */
const cache = new Map<string, AppDto>();

export function cacheApps(apps: AppDto[]): void {
  for (const app of apps) cache.set(app.id, app);
}

export function cachedApp(id: string): AppDto | undefined {
  return cache.get(id);
}
