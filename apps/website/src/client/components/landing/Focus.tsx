import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePrefersReducedMotion } from "../../lib/motion";
import { useSiteTheme } from "../../lib/theme";
import { PHONE_H, PHONE_W, PhoneFrame } from "./Phone";
import { PhoneStage } from "./Scenes";
import { ShuffleText } from "./ShuffleText";
import { HALLOWEEN_STEPS, pinnedStep, SCENE_STEPS, type Scene, STEPS } from "./slides";

/** A clicked step stays this long before the rotation picks up again. */
const HOLD_MS = 5000;

/** True while the tab is in the background, so the rotation stops. */
function usePageHidden(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
    () => document.hidden,
    () => false,
  );
}

/**
 * `?niche=` from the address bar. Prerendered markup is the first step; the
 * server snapshot keeps hydration clean before the real value applies.
 */
function useNicheParam(): string | null {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("popstate", onChange);
      return () => window.removeEventListener("popstate", onChange);
    },
    () => new URLSearchParams(window.location.search).get("niche"),
    () => null,
  );
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
        setFit({ scale: Math.min((width * 0.8) / PHONE_W, 0.74), cropped: true });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, fit };
}

function sceneLabel(scene: Scene): string {
  switch (scene.kind) {
    case "notify":
      return `An iPhone Lock Screen gets a notification from ${scene.note.title}.`;
    case "page":
      return `A page from ${scene.page.title} rings until ${scene.page.claimedBy} claims it.`;
    case "app":
      return `The ${scene.app.name} app opens inside Hark, already signed in.`;
    case "approve":
      return `${scene.note.title} asks for approval on the Lock Screen; it is pressed and approved.`;
    case "team":
      return `A ${scene.team.note.title} notification that the whole team gets.`;
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg aria-hidden="true" fill="currentColor" height="10" viewBox="0 0 10 10" width="10">
      {playing ? (
        <path d="M2 1h2v8H2zM6 1h2v8H6z" />
      ) : (
        <path d="M2.5 1.2v7.6a.5.5 0 0 0 .76.43l6.1-3.8a.5.5 0 0 0 0-.86l-6.1-3.8a.5.5 0 0 0-.76.43Z" />
      )}
    </svg>
  );
}

interface Story {
  index: number;
  step: number;
  /** Changes with every new moment (picked or rotated), so re-picking one restarts it. */
  epoch: number;
  /** A picked step holds a while before the rotation goes on. */
  hold: boolean;
  /** Swap the headline without a transition (applying `?niche=`). */
  instant: boolean;
}

/**
 * The landing page's one focal point: "The everything app for" plus one
 * audience, one matching line and one phone moment, every five seconds.
 * The rotation pauses on hover, focus, in a hidden tab and with the pause
 * button. `?niche=` and reduced motion don't rotate until play is pressed;
 * reduced motion also shows each moment's final state, without transitions.
 */
export function Focus({ cta, hint }: { cta: ReactNode; hint: ReactNode }) {
  const pinned = pinnedStep(useNicheParam());
  /** The same steps, in Halloween copy while that theme is on (see /theme.js). */
  const slides = useSiteTheme() === "halloween" ? HALLOWEEN_STEPS : STEPS;
  const reduced = usePrefersReducedMotion();
  const hidden = usePageHidden();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  /** The pause button's choice; `null` until pressed. */
  const [choice, setChoice] = useState<boolean | null>(null);
  const [story, setStory] = useState<Story>({
    index: 0,
    step: 0,
    epoch: 0,
    hold: false,
    instant: false,
  });
  const remaining = useRef<{ key: string; ms: number } | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const { ref: stageRef, fit } = usePhoneFit();

  // A pinned step applies after hydration, swapped in without a transition.
  useLayoutEffect(() => {
    if (pinned === null) return;
    setStory((s) => ({
      ...s,
      index: pinned,
      step: 0,
      epoch: s.epoch + 1,
      instant: true,
    }));
  }, [pinned]);

  const current = slides[story.index] ?? slides[0];
  if (!current) throw new Error("No landing steps");
  const steps = SCENE_STEPS[current.scene.kind];
  const last = steps.length - 1;
  /** Rotates through the steps (else the current moment plays and stays). */
  const rotating = choice ?? !(reduced || pinned !== null);
  /** Anything moves at all: the pause button stops everything. */
  const moving = !hidden && !hovered && !focused && choice !== false;
  const step = reduced ? last : story.step;
  const total = sum(steps) + (story.hold ? HOLD_MS : 0);

  useEffect(() => {
    if (!moving) return;
    if (story.step === last && !rotating) return;
    const key = `${story.index}:${story.step}:${story.epoch}`;
    let duration = steps[story.step] ?? 0;
    if (story.step === last && story.hold) duration += HOLD_MS;
    if (remaining.current?.key === key) duration = remaining.current.ms;
    remaining.current = null;
    const start = performance.now();
    let fired = false;
    const timeout = window.setTimeout(() => {
      fired = true;
      setStory((s) =>
        s.step < last
          ? { ...s, step: s.step + 1 }
          : {
              index: (s.index + 1) % STEPS.length,
              step: 0,
              epoch: s.epoch + 1,
              hold: false,
              instant: false,
            },
      );
    }, duration);
    return () => {
      window.clearTimeout(timeout);
      // Paused mid-step: resume with what was left, so the progress bar stays in sync.
      if (!fired) remaining.current = { key, ms: duration - (performance.now() - start) };
    };
  }, [moving, rotating, story, steps, last]);

  const select = useCallback((index: number, focus: boolean) => {
    setStory((s) => ({
      index,
      step: 0,
      epoch: s.epoch + 1,
      hold: true,
      instant: false,
    }));
    if (focus) tabs.current[index]?.focus();
  }, []);

  const togglePlay = () => {
    if (rotating) {
      setChoice(false);
      return;
    }
    // From a pinned or reduced-motion start, play the current step from the top.
    if (choice === null) {
      setStory((s) => ({ ...s, step: 0, epoch: s.epoch + 1, hold: false }));
    }
    setChoice(true);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const end = slides.length - 1;
    const target =
      event.key === "ArrowRight"
        ? index === end
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? end
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? end
              : null;
    if (target === null) return;
    event.preventDefault();
    select(target, true);
  };

  const panelId = `${baseId}-panel`;
  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const hover = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };
  /** Pinned and reduced-motion starts don't count down: the bar is just full. */
  const still = choice === null && !rotating;

  return (
    <div className={`hark-focus ${moving ? "" : "is-paused"}`}>
      <div className="hark-focus-copy">
        <h1 className="hark-focus-title">
          The everything app for{" "}
          <span className="hark-focus-phrases">
            {/* Every phrase, invisible, in one grid cell: the longest sets the size. */}
            {slides.map((s) => (
              <span aria-hidden="true" className="hark-focus-phrase" key={s.id}>
                {s.phrase}
              </span>
            ))}
            <ShuffleText instant={story.instant || reduced} text={current.phrase} />
            <span className="sr-only">{current.phrase}</span>
          </span>
        </h1>
        <p className="hark-focus-line" key={`${current.id}-${story.epoch}`}>
          {current.line}
        </p>
      </div>

      <div className="hark-focus-cta">{cta}</div>

      <div className="hark-focus-nav" {...hover}>
        <div
          aria-label="Who Hark is for"
          className="hark-focus-tabs"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
          }}
          onFocus={(event) => {
            // Keyboard focus pauses; a mouse click only holds the picked step.
            if (event.target.matches(":focus-visible")) setFocused(true);
          }}
          role="tablist"
        >
          {slides.map((s, index) => {
            const selected = index === story.index;
            return (
              <button
                aria-controls={panelId}
                aria-label={`For ${s.phrase.replace(/\.$/, "")}`}
                aria-selected={selected}
                className={`hark-focus-tab ${selected ? "is-selected" : ""}`}
                id={tabId(s.id)}
                key={s.id}
                onClick={() => select(index, false)}
                onKeyDown={(event) => onTabKey(event, index)}
                ref={(el) => {
                  tabs.current[index] = el;
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <span aria-hidden="true" className="hark-focus-tab-label">
                  {s.label}
                </span>
                <span aria-hidden="true" className="hark-focus-tab-track">
                  {selected ? (
                    <i
                      className={still || reduced ? "is-full" : ""}
                      key={`${story.index}-${story.epoch}`}
                      style={{ animationDuration: `${total}ms` }}
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <button
          aria-label={rotating ? "Pause" : "Play"}
          className="hark-focus-play"
          onClick={togglePlay}
          type="button"
        >
          <PlayIcon playing={rotating} />
        </button>
      </div>

      <div
        aria-labelledby={tabId(current.id)}
        className={`hark-focus-stage ${fit?.cropped ? "is-cropped" : ""} ${story.instant ? "is-instant" : ""}`}
        id={panelId}
        ref={stageRef}
        role="tabpanel"
        {...hover}
      >
        {fit ? (
          <div className="hark-focus-stage-inner">
            <div aria-label={sceneLabel(current.scene)} role="img">
              <PhoneFrame cropped={fit.cropped} scale={fit.scale}>
                <PhoneStage id={`${current.id}-${story.epoch}`} scene={current.scene} step={step} />
              </PhoneFrame>
            </div>
          </div>
        ) : null}
      </div>

      <div className="hark-focus-hint">{hint}</div>
    </div>
  );
}
