import type { CSSProperties, ReactNode } from "react";
import { StatusBarIcons } from "../LiveActivityDemo";

/** The phone is drawn at iPhone 15 Pro size in points, then scaled to fit. */
export const SCREEN_W = 393;
export const SCREEN_H = 852;
const BEZEL = 11;
export const PHONE_W = SCREEN_W + BEZEL * 2;
export const PHONE_H = SCREEN_H + BEZEL * 2;

/**
 * An iPhone body: titanium rim, black bezel, rounded screen and side buttons.
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
        <span className="hark-phone-btn is-power" />
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

export function StatusBar({ time = false }: { time?: boolean }) {
  return (
    <div className="hark-phone-status">
      <span className="hark-phone-status-time">{time ? "9:41" : ""}</span>
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

function LockGlyph() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="17" viewBox="0 0 14 18" width="13">
      <path d="M7 0a4.5 4.5 0 0 0-4.5 4.5V7H2a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-.5V4.5A4.5 4.5 0 0 0 7 0Zm-3 4.5a3 3 0 0 1 6 0V7H4V4.5Z" />
    </svg>
  );
}

function Flashlight() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="22" viewBox="0 0 12 22" width="12">
      <path d="M1 0h10v4L8.5 8v13a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V8L1 4Zm5 11a1.2 1.2 0 1 0 0 2.4A1.2 1.2 0 0 0 6 11Z" />
    </svg>
  );
}

function Camera() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 18" width="24">
      <path d="M8.5 0h7l1.6 2.5H21a3 3 0 0 1 3 3V15a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3V5.5a3 3 0 0 1 3-3h3.9Zm3.5 5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 1.6a2.9 2.9 0 1 1 0 5.8 2.9 2.9 0 0 1 0-5.8Z" />
    </svg>
  );
}

/**
 * The Lock Screen: date, big clock, then notifications and Live Activities
 * stacked under it (close to the clock, so a cropped phone still shows them).
 */
export function LockScreen({
  island,
  children,
  className = "",
}: {
  island?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`hark-lock ${className}`}>
      <Wallpaper />
      <StatusBar />
      {island ?? <Island mode="idle" />}
      <div className="hark-lock-head">
        <LockGlyph />
        <div className="hark-lock-date">Tuesday, October 27</div>
        <div className="hark-lock-clock">9:41</div>
      </div>
      <div className="hark-lock-list">{children}</div>
      <div className="hark-lock-quick is-left">
        <Flashlight />
      </div>
      <div className="hark-lock-quick is-right">
        <Camera />
      </div>
    </div>
  );
}

export interface AppTile {
  name: string;
  glyph: ReactNode;
  bg: string;
  fg: string;
}

export function AppIcon({ app, pressed = false }: { app: AppTile; pressed?: boolean }) {
  return (
    <div className={`hark-home-app ${pressed ? "is-pressed" : ""}`}>
      <div className="hark-home-icon" style={{ background: app.bg, color: app.fg }}>
        {app.glyph}
      </div>
      <span>{app.name}</span>
    </div>
  );
}

export type Avatar = { text: string; bg: string } | { img: string };

/**
 * An iOS notification in Hark's glass style (shares `.hark-note` with the
 * rest of the site). `badge` false hides the small Hark corner mark.
 */
export function PhoneNote({
  avatar,
  title,
  time = "now",
  eyebrow,
  body,
  children,
  className = "",
}: {
  avatar: Avatar;
  title: string;
  time?: string;
  eyebrow?: ReactNode;
  body: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`hark-note is-static ${className}`}>
      <div className="hark-note-sender">
        {"img" in avatar ? (
          <div className="hark-note-avatar">
            <img alt="" src={avatar.img} />
          </div>
        ) : (
          <div className="hark-note-avatar" style={{ background: avatar.bg }}>
            {avatar.text}
          </div>
        )}
        <span className="hark-note-badge" />
      </div>
      <div className="hark-note-content">
        {eyebrow ? <div className="hark-note-eyebrow">{eyebrow}</div> : null}
        <div className="hark-note-row">
          <span className="hark-note-title">{title}</span>
          <time>{time}</time>
        </div>
        <div className="hark-note-msg">{body}</div>
        {children}
      </div>
    </div>
  );
}

/** A fingertip press, drawn where the visitor would tap. */
export function Tap({ style }: { style: CSSProperties }) {
  return <span className="hark-tap" style={style} />;
}
