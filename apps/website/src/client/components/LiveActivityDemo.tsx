import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "../lib/motion";

/** A deploy that runs, finishes, and starts over: [progress, status, detail]. */
const STEPS: [number, string, string][] = [
  [0.04, "Starting", "Queued on raven-cobra"],
  [0.18, "Installing", "pnpm install --frozen-lockfile"],
  [0.36, "Building", "Compiling packages/website-runtime"],
  [0.55, "Building", "Bundling apps/website (vite)"],
  [0.72, "Testing", "230 tests in apps/website"],
  [0.88, "Deploying", "Restarting hark on raven-cobra"],
  [1, "Deployed", "hark.fyi is healthy"],
];
const STEP_MS = 1700;
const FADE_MS = 180;

export function Gear() {
  return (
    <svg aria-hidden="true" className="hark-gear" fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zm6.4 3.9-1.3.3a5.1 5.1 0 0 1-.6 1.4l.7 1.2-1.3 1.3-1.2-.7a5.1 5.1 0 0 1-1.4.6l-.3 1.3H7.2l-.3-1.3a5.1 5.1 0 0 1-1.4-.6l-1.2.7L3 12.2l.7-1.2a5.1 5.1 0 0 1-.6-1.4l-1.3-.3V6.9l1.3-.3c.1-.5.3-1 .6-1.4L3 4l1.3-1.3 1.2.7c.4-.3.9-.5 1.4-.6l.3-1.3h1.6l.3 1.3c.5.1 1 .3 1.4.6l1.2-.7L13 4l-.7 1.2c.3.4.5.9.6 1.4l1.3.3z" />
    </svg>
  );
}

/** The real iOS status-bar glyphs: signal, Wi-Fi and battery. */
export function StatusBarIcons() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="19" viewBox="0 0 82 22" width="72">
      <path d="M3.7 13H2.5a1 1 0 0 0-1 1v2.5a1 1 0 0 0 1 1h1.2a1 1 0 0 0 1-1V14a1 1 0 0 0-1-1m5.2-2.5H7.7a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h1.2a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1M14.1 8h-1.2a1 1 0 0 0-1 1v7.5a1 1 0 0 0 1 1h1.2a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1m5.2-2.5h-1.2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1.2a1 1 0 0 0 1-1v-10a1 1 0 0 0-1-1" />
      <path
        clipRule="evenodd"
        d="M36.57 7.8c2.49 0 4.88.92 6.68 2.58.14.13.36.12.49 0l1.3-1.27a.34.34 0 0 0 0-.5 12.55 12.55 0 0 0-16.93 0 .34.34 0 0 0 0 .5l1.3 1.26c.13.13.34.14.48 0a10 10 0 0 1 6.68-2.57m0 4.22a5.4 5.4 0 0 1 3.67 1.44c.14.13.35.13.48 0l1.3-1.33a.37.37 0 0 0-.01-.52 7.9 7.9 0 0 0-10.88 0 .37.37 0 0 0 0 .52l1.29 1.32c.13.14.34.14.48 0 1-.92 2.31-1.43 3.67-1.43m2.52 2.8q0 .15-.1.28l-2.18 2.45a.3.3 0 0 1-.24.11.3.3 0 0 1-.24-.1l-2.18-2.46a.43.43 0 0 1 .01-.56 3.44 3.44 0 0 1 4.82 0 .4.4 0 0 1 .11.28"
        fillRule="evenodd"
      />
      {/* iOS 26: a solid capsule (no outline ring) and a small terminal. */}
      <rect height="13" rx="4.3" width="25.6" x="52.5" y="5" />
      <path d="M78.9 9.6v3.8a1.9 1.9 0 0 0 1-1.9 1.9 1.9 0 0 0-1-1.9" />
    </svg>
  );
}

/**
 * A live Lock Screen Live Activity and the matching Dynamic Island, both built
 * in code. The percentage and bar move with each step; status text fades
 * between values.
 */
export function LiveActivityDemo() {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (reduced) return;
    const interval = window.setInterval(() => {
      setStep((current) => (current + 1) % STEPS.length);
    }, STEP_MS);
    return () => window.clearInterval(interval);
  }, [reduced]);

  // Fade the text out, swap it, fade back in.
  useEffect(() => {
    if (step === shown) return;
    setVisible(false);
    const timeout = window.setTimeout(() => {
      setShown(step);
      setVisible(true);
    }, FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [step, shown]);

  const [progress] = STEPS[step] as [number, string, string];
  const [, status, detail] = STEPS[shown] as [number, string, string];
  const pct = `${Math.round(progress * 100)}%`;

  return (
    <div aria-hidden="true" className="mt-[18px] flex max-w-[24.5rem] flex-col gap-3">
      <div className="hark-la">
        <div className="flex items-center justify-between">
          <div className="hark-la-label">
            <Gear />
            <span>Deploy #184</span>
          </div>
          <div className="hark-la-pct">{pct}</div>
        </div>
        <div className="hark-la-status" style={{ opacity: visible ? 1 : 0 }}>
          {status}
        </div>
        <div className="hark-la-detail" style={{ opacity: visible ? 1 : 0 }}>
          {detail}
        </div>
        <div className="hark-la-bar">
          <i style={{ width: pct }} />
        </div>
      </div>
      <div className="hark-island-row">
        <span className="hark-island-clock">9:41</span>
        <div className="hark-island">
          <Gear />
          <span className="hark-la-pct">{pct}</span>
        </div>
        <span className="hark-island-sys">
          <StatusBarIcons />
        </span>
      </div>
    </div>
  );
}
