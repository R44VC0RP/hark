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
import { PHONE_H, PHONE_W, PhoneFrame } from "./Phone";
import { AppScene, NotifyScene, PageScene, TeamScene } from "./Scenes";
import { type Niche, nicheFor, SLIDE_STEPS, SLIDES, type SlideId } from "./slides";

/** A clicked slide stays this long before the rotation picks up again. */
const HOLD_MS = 8000;

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
 * `?niche=` from the address bar. Prerendered markup is the default niche;
 * the server snapshot keeps hydration clean before the real value applies.
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

function Scene({ id, niche, step }: { id: SlideId; niche: Niche; step: number }) {
  switch (id) {
    case "notify":
      return <NotifyScene note={niche.notify} step={step} />;
    case "page":
      return <PageScene page={niche.page} step={step} />;
    case "app":
      return <AppScene app={niche.app} step={step} />;
    case "team":
      return <TeamScene step={step} team={niche.team} />;
  }
}

const SCENE_LABELS: Record<SlideId, (niche: Niche) => string> = {
  notify: (n) => `An iPhone Lock Screen gets a notification from ${n.notify.title}.`,
  page: (n) => `A page from ${n.page.title} rings three times until ${n.page.claimedBy} claims it.`,
  app: (n) => `The ${n.app.name} app opens inside Hark, already signed in.`,
  team: (n) => `A notification shared with ${n.team.team}, ${n.team.people} people.`,
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/**
 * The landing page's one focal point: a fixed headline, one line that
 * matches the slide, and a phone that plays four short moments in turn.
 * Rotation pauses on hover, focus and in a hidden tab; a clicked slide
 * holds for a while. Reduced motion shows each slide's final state.
 */
export function Focus({ cta, hint }: { cta: ReactNode; hint: ReactNode }) {
  const niche = nicheFor(useNicheParam());
  const reduced = usePrefersReducedMotion();
  const hidden = usePageHidden();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // `epoch` changes on every click, so re-picking a slide restarts it.
  const [story, setStory] = useState({ slide: 0, step: 0, epoch: 0, hold: false });
  const remaining = useRef<{ key: string; ms: number } | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const { ref: stageRef, fit } = usePhoneFit();

  const slide = SLIDES[story.slide] ?? SLIDES[0];
  const id: SlideId = slide?.id ?? "notify";
  const steps = SLIDE_STEPS[id];
  const last = steps.length - 1;
  const running = !hidden && !hovered && !focused;
  const step = reduced ? last : story.step;
  const total = sum(steps) + (story.hold ? HOLD_MS : 0);

  useEffect(() => {
    if (!running) return;
    const key = `${story.slide}:${story.step}:${story.epoch}`;
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
          : { slide: (s.slide + 1) % SLIDES.length, step: 0, epoch: s.epoch, hold: false },
      );
    }, duration);
    return () => {
      window.clearTimeout(timeout);
      // Paused mid-step: resume with what was left, so the progress bar stays in sync.
      if (!fired) remaining.current = { key, ms: duration - (performance.now() - start) };
    };
  }, [running, story, steps, last]);

  const select = useCallback((index: number, focus: boolean) => {
    setStory((s) => ({ slide: index, step: 0, epoch: s.epoch + 1, hold: true }));
    if (focus) tabs.current[index]?.focus();
  }, []);

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const end = SLIDES.length - 1;
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
  const tabId = (slideId: string) => `${baseId}-tab-${slideId}`;
  const hover = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  return (
    <div className={`hark-focus ${running ? "" : "is-paused"}`}>
      <div className="hark-focus-copy">
        <h1 className="hark-focus-title">{niche.headline}</h1>
        <p className="hark-focus-line" key={`${id}-${niche.lines[id]}`}>
          {niche.lines[id]}
        </p>
      </div>

      <div className="hark-focus-cta">{cta}</div>

      <div
        aria-label="What Hark does"
        className="hark-focus-tabs"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
        onFocus={(event) => {
          // Keyboard focus pauses; a mouse click only holds the picked slide.
          if (event.target.matches(":focus-visible")) setFocused(true);
        }}
        role="tablist"
        {...hover}
      >
        {SLIDES.map((s, index) => {
          const selected = index === story.slide;
          return (
            <button
              aria-controls={panelId}
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
              <span className="hark-focus-tab-label">{s.label}</span>
              <span aria-hidden="true" className="hark-focus-tab-track">
                {selected ? (
                  <i
                    className={reduced ? "is-full" : ""}
                    key={`${story.slide}-${story.epoch}`}
                    style={{ animationDuration: `${total}ms` }}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={tabId(id)}
        className={`hark-focus-stage ${fit?.cropped ? "is-cropped" : ""}`}
        id={panelId}
        ref={stageRef}
        role="tabpanel"
        {...hover}
      >
        {fit ? (
          <div className="hark-focus-stage-inner">
            <div aria-label={SCENE_LABELS[id](niche)} role="img">
              <PhoneFrame cropped={fit.cropped} scale={fit.scale}>
                <div className="hark-focus-scene" key={`${id}-${story.epoch}`}>
                  <Scene id={id} niche={niche} step={step} />
                </div>
              </PhoneFrame>
            </div>
          </div>
        ) : null}
      </div>

      <div className="hark-focus-hint">{hint}</div>
    </div>
  );
}
