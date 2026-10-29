import type { CSSProperties, ReactNode } from "react";
import { StatusBarIcons } from "../LiveActivityDemo";

/**
 * An iPhone 17 Pro, drawn in points from Apple's dimensional drawing
 * (71.85 × 150.01 mm body, 66.57 × 144.73 mm display = 6.04 pt/mm), then
 * scaled to fit. The display sits 16 pt (2.64 mm) inside the body on every
 * side, and the corners are concentric (display 62.5 pt, body 78.5 pt).
 */
export const SCREEN_W = 402;
export const SCREEN_H = 874;
const BEZEL = 16;
export const PHONE_W = SCREEN_W + BEZEL * 2;
export const PHONE_H = SCREEN_H + BEZEL * 2;

/**
 * The body: a metal frame band (7 pt seen from the front), the black glass
 * border, the display, and the side buttons at their drawn positions
 * (Action and volume on the left; side button and Camera Control on the right).
 */
export function PhoneFrame({
  scale,
  cropped = false,
  children,
}: {
  scale: number;
  /** Only the top shows, so content sits under the clock instead of at the bottom. */
  cropped?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="relative"
      style={{ width: PHONE_W * scale, height: PHONE_H * scale } satisfies CSSProperties}
    >
      <div
        className={`hark-phone ${cropped ? "is-cropped" : ""}`}
        style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})` }}
      >
        <span className="hark-phone-btn is-action" />
        <span className="hark-phone-btn is-vol-up" />
        <span className="hark-phone-btn is-vol-down" />
        <span className="hark-phone-btn is-side" />
        <span className="hark-phone-btn is-camera" />
        <div className="hark-phone-glass" />
        <div className="hark-phone-screen">
          {children}
          <div className="hark-phone-home" />
        </div>
      </div>
    </div>
  );
}

/** Hark's deep green with soft mint light: the wallpaper on every screen. */
export function Wallpaper() {
  return <div className="hark-wallpaper" />;
}

/**
 * The status bar stays put while screens change under it. The Lock Screen
 * shows no time there (the big clock does); apps show it. It turns dark over
 * light app content, as iOS does.
 */
export function StatusBar({ time = false, dark = false }: { time?: boolean; dark?: boolean }) {
  return (
    <div className={`hark-phone-status ${dark ? "is-dark" : ""}`}>
      <span className={`hark-phone-status-time ${time ? "" : "is-hidden"}`}>9:41</span>
      <StatusBarIcons />
    </div>
  );
}

export type IslandMode = "idle" | "compact" | "expanded";

/**
 * The Dynamic Island: one black pill that grows from idle to a compact
 * activity (leading + trailing) or the expanded view.
 */
export function Island({
  mode,
  leading,
  trailing,
  expanded,
}: {
  mode: IslandMode;
  leading?: ReactNode;
  trailing?: ReactNode;
  expanded?: ReactNode;
}) {
  return (
    <div className={`hark-dyn-island is-${mode}`}>
      <div className="hark-dyn-compact">
        <span>{leading}</span>
        <span>{trailing}</span>
      </div>
      <div className="hark-dyn-expanded">{expanded}</div>
    </div>
  );
}

/**
 * The bevel on the Lock Screen's glass clock: light from the upper left
 * catches each glyph's rounded edge (specular lighting on its blurred
 * outline), added over the translucent fill.
 */
function ClockGlass() {
  return (
    <svg aria-hidden="true" className="hark-clock-defs" height="0" width="0">
      <filter colorInterpolationFilters="sRGB" id="hark-clock-glass">
        <feGaussianBlur in="SourceAlpha" result="soft" stdDeviation="2" />
        <feSpecularLighting
          in="soft"
          lightingColor="#ffffff"
          result="light"
          specularConstant="1.1"
          specularExponent="22"
          surfaceScale="3"
        >
          <feDistantLight azimuth="235" elevation="38" />
        </feSpecularLighting>
        <feComposite in="light" in2="SourceAlpha" operator="in" result="rim" />
        <feComposite
          in="SourceGraphic"
          in2="rim"
          k2="1"
          k3="1.1"
          operator="arithmetic"
          result="lit"
        />
        <feDropShadow dx="0" dy="2" floodColor="#00140e" floodOpacity="0.35" stdDeviation="3" />
      </filter>
    </svg>
  );
}

/**
 * The iOS 27 Lock Screen, measured from the iPhone 17 Pro simulator: a short
 * date over a large glass clock, and notifications low on the screen. The
 * status bar and Dynamic Island sit above it, so it can slide away to unlock.
 * `dimmed` is the blur behind a pressed-and-held notification.
 */
export function LockScreen({
  children,
  className = "",
  date = "Tue Oct 27",
  dimmed = false,
}: {
  children?: ReactNode;
  className?: string;
  /** The short date over the clock. */
  date?: string;
  dimmed?: boolean;
}) {
  return (
    <div className={`hark-lock ${className}`}>
      <Wallpaper />
      <ClockGlass />
      <div className="hark-lock-head">
        <div className="hark-lock-date">{date}</div>
        <div className="hark-lock-clock">9:41</div>
      </div>
      <div className={`hark-lock-dim ${dimmed ? "is-on" : ""}`} />
      <div className="hark-lock-list">{children}</div>
    </div>
  );
}

export type Avatar = { text: string; bg: string } | { img: string };

/**
 * An iOS notification, measured from a real Hark push on the iPhone 17 Pro
 * simulator: a glass platter, a 38 pt icon, a 15 pt semibold title, an
 * optional subtitle, and up to four lines of body. With an `avatar` it is a
 * communication notification (sender picture with the small Hark icon);
 * without one it shows the Hark app icon. `stacked` draws the edges of older
 * notifications from the same app peeking out below.
 */
export function PhoneNote({
  avatar,
  title,
  subtitle,
  time = "now",
  body,
  stacked = 0,
  className = "",
}: {
  avatar?: Avatar;
  title: string;
  subtitle?: string;
  time?: string;
  body: ReactNode;
  stacked?: number;
  className?: string;
}) {
  return (
    <div className={`hark-ios-note-wrap ${className}`}>
      {stacked > 1 ? <div aria-hidden="true" className="hark-ios-note-layer is-second" /> : null}
      {stacked > 0 ? <div aria-hidden="true" className="hark-ios-note-layer is-first" /> : null}
      <div className="hark-ios-note">
        <div className="hark-ios-note-icon">
          {avatar ? (
            <>
              {"img" in avatar ? (
                <div className="hark-ios-note-avatar">
                  <img alt="" src={avatar.img} />
                </div>
              ) : (
                <div className="hark-ios-note-avatar" style={{ background: avatar.bg }}>
                  {avatar.text}
                </div>
              )}
              <span className="hark-ios-note-badge" />
            </>
          ) : (
            <span className="hark-ios-note-app" />
          )}
        </div>
        <div className="hark-ios-note-content">
          <div className="hark-ios-note-row">
            <span className="hark-ios-note-title">{title}</span>
            <time>{time}</time>
          </div>
          {subtitle ? <div className="hark-ios-note-subtitle">{subtitle}</div> : null}
          <div className="hark-ios-note-body">{body}</div>
        </div>
      </div>
    </div>
  );
}

/** The menu iOS shows under a pressed-and-held notification. */
export function NoteActions({
  actions,
  tapped,
}: {
  actions: { label: string; destructive?: boolean }[];
  tapped?: string;
}) {
  return (
    <div className="hark-ios-actions">
      {actions.map((action) => (
        <div
          className={`hark-ios-action ${action.destructive ? "is-destructive" : ""} ${
            tapped === action.label ? "is-tapped" : ""
          }`}
          key={action.label}
        >
          {action.label}
          {tapped === action.label ? <i aria-hidden="true" className="hark-note-tap" /> : null}
        </div>
      ))}
    </div>
  );
}

/** A fingertip press, drawn where the visitor would tap. */
export function Tap({ style }: { style: CSSProperties }) {
  return <span className="hark-tap" style={style} />;
}
