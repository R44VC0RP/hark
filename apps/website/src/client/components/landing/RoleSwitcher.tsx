import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { usePrefersReducedMotion } from "../../lib/motion";
import { CodeBlock } from "../CodeBlock";
import { PHONE_H, PHONE_W, PhoneFrame } from "./Phone";
import { ONCALL, ROLES, type Role } from "./roles";
import { AgentScene, EngineerScene, EscalationLadder, OncallScene, TeamScene } from "./Scenes";

/** True while the tab is in the background, so the story stops spending timers. */
function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return hidden;
}

interface Fit {
  scale: number;
  /** The phone is taller than the stage: show its top and fade the rest out. */
  cropped: boolean;
}

/**
 * Scale the phone to its stage. When a whole phone would be too small to
 * read (narrow, short screens), keep it readable and crop the bottom instead.
 */
function usePhoneFit() {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height: outer } = el.getBoundingClientRect();
      // Room for the phone's shadow above and below.
      const height = outer - 28;
      if (width === 0 || height <= 0) return;
      const whole = Math.min(height / PHONE_H, width / PHONE_W, 0.92);
      if (whole >= 0.58 || width > height) {
        setFit({ scale: whole, cropped: false });
      } else {
        setFit({ scale: Math.min((width * 0.84) / PHONE_W, 0.78), cropped: true });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, fit };
}

const totalMs = (role: Role) => role.durations.reduce((sum, ms) => sum + ms, 0);

function Scene({ role, step }: { role: Role; step: number }) {
  switch (role.id) {
    case "engineer":
      return <EngineerScene step={step} />;
    case "oncall":
      return <OncallScene step={step} />;
    case "agent":
      return <AgentScene step={step} />;
    case "team":
      return <TeamScene step={step} />;
  }
}

function CodeCard({ role, step }: { role: Role; step: number }) {
  const snippet = role.snippets[role.snippetAt(step)] ?? role.snippets[0];
  const output = role.output(step);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  if (!snippet) return null;
  return (
    <div className="hark-code-card">
      <div className="flex h-9 items-center justify-between pr-1.5 pl-4">
        <span className="font-mono text-xs text-ink-faint">{snippet.label}</span>
        <button
          className="rounded-full px-2.5 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-white"
          onClick={() => {
            void navigator.clipboard?.writeText(snippet.code).then(() => setCopied(true));
          }}
          type="button"
        >
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <CodeBlock
        className="hark-code-body overflow-x-auto px-4 pb-3 font-mono text-[12.5px] leading-[1.6] text-code-ink"
        code={snippet.code}
        key={snippet.code}
        language={snippet.language}
      />
      <div className="hark-code-output">
        <span aria-hidden="true" className="text-mint">
          →
        </span>
        <span className="truncate" key={output ?? ""}>
          {output ?? "Waiting…"}
        </span>
      </div>
    </div>
  );
}

function PauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 12 12" width="12">
      <rect height="10" rx="1" width="3" x="2" y="1" />
      <rect height="10" rx="1" width="3" x="7" y="1" />
    </svg>
  ) : (
    <svg aria-hidden="true" fill="currentColor" height="12" viewBox="0 0 12 12" width="12">
      <path d="M3 1.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1l-7-4.4a.6.6 0 0 0-.9.5Z" />
    </svg>
  );
}

/**
 * The landing page's one interactive piece: four roles, each a short story
 * the phone replays. Roles advance on their own until the visitor picks one
 * (or pauses); the story itself keeps looping, and stops in a hidden tab.
 * With reduced motion every role shows its final state and nothing moves.
 */
export function RoleSwitcher({ intro, footer }: { intro: ReactNode; footer?: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const hidden = usePageHidden();
  const [story, setStory] = useState({ role: 0, step: 0 });
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [paused, setPaused] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const { ref: stageRef, fit } = usePhoneFit();

  const role = ROLES[story.role] ?? (ROLES[0] as Role);
  const running = !reduced && !hidden && !paused;
  const step = reduced ? role.durations.length - 1 : story.step;

  useEffect(() => {
    if (!running) return;
    const current = ROLES[story.role];
    if (!current) return;
    const timeout = window.setTimeout(() => {
      setStory(({ role: r, step: s }) => {
        if (s + 1 < current.durations.length) return { role: r, step: s + 1 };
        return { role: autoAdvance ? (r + 1) % ROLES.length : r, step: 0 };
      });
    }, current.durations[story.step]);
    return () => window.clearTimeout(timeout);
  }, [running, story, autoAdvance]);

  const select = useCallback((index: number, focus: boolean) => {
    setAutoAdvance(false);
    setStory({ role: index, step: 0 });
    if (focus) tabs.current[index]?.focus();
  }, []);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = ROLES.length - 1;
    const target =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    select(target, true);
  };

  const panelId = `${baseId}-panel`;
  const tabId = (id: string) => `${baseId}-tab-${id}`;

  return (
    <div className={`hark-roles ${running ? "" : "is-paused"}`}>
      <div className="hark-roles-copy">
        {intro}

        <div className="hark-roles-tabbar">
          <div aria-label="Who Hark is for" className="hark-segmented" role="tablist">
            {ROLES.map((r, index) => {
              const selected = index === story.role;
              return (
                <button
                  aria-controls={panelId}
                  aria-selected={selected}
                  className={`hark-segment ${selected ? "is-selected" : ""}`}
                  id={tabId(r.id)}
                  key={r.id}
                  onClick={() => select(index, false)}
                  onKeyDown={(event) => onTabKey(event, index)}
                  ref={(el) => {
                    tabs.current[index] = el;
                  }}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  {r.label}
                  {selected && autoAdvance && !reduced ? (
                    <span
                      aria-hidden="true"
                      className="hark-segment-progress"
                      key={story.role}
                      style={{ animationDuration: `${totalMs(role)}ms` }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          {reduced ? null : (
            <button
              aria-label={paused ? "Play the demo" : "Pause the demo"}
              className="hark-roles-pause"
              onClick={() => {
                setPaused((value) => !value);
                setAutoAdvance(false);
              }}
              type="button"
            >
              <PauseIcon playing={!paused} />
            </button>
          )}
        </div>

        <div
          aria-labelledby={tabId(role.id)}
          className="hark-roles-panel"
          id={panelId}
          role="tabpanel"
        >
          <p className="hark-roles-pitch" key={role.id}>
            {role.pitch}
          </p>
          <ul className="hark-roles-bullets">
            {role.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <div className="hark-roles-code">
            <CodeCard role={role} step={step} />
          </div>
          <code className="hark-roles-chip">{role.chip}</code>
        </div>

        {footer}
      </div>

      <div className={`hark-roles-stage ${fit?.cropped ? "is-cropped" : ""}`} ref={stageRef}>
        {fit ? (
          <div className="hark-roles-stage-inner">
            <div className="relative" style={{ "--phone-scale": fit.scale } as CSSProperties}>
              <div aria-label={role.description} role="img">
                <PhoneFrame
                  cropped={fit.cropped}
                  ringing={role.id === "oncall" && step >= ONCALL.ring && step < ONCALL.claimed}
                  scale={fit.scale}
                >
                  <Scene role={role} step={step} />
                </PhoneFrame>
              </div>
              {role.id === "oncall" && !fit.cropped ? <EscalationLadder step={step} /> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
