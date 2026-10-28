import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../lib/motion";

interface FeedItem {
  sender: string;
  avatar: { text: string; bg: string } | { img: string };
  body: string;
  actions?: string[];
}

const FEED: FeedItem[] = [
  {
    sender: "Release agent",
    avatar: { text: "▲", bg: "#171713" },
    body: "Deploy version 2.4.1 to production?",
    actions: ["Deny", "Approve"],
  },
  {
    sender: "OpenCode",
    avatar: { img: "/agents/opencode.png" },
    body: "Refactor finished. 14 files changed, all tests passing.",
  },
  {
    sender: "GitHub",
    avatar: { text: "G", bg: "#24292F" },
    body: "Production deployed successfully.",
  },
  {
    sender: "Stripe",
    avatar: { text: "S", bg: "#635BFF" },
    body: "Payment received: $1,240.00 from Acme Inc.",
  },
  {
    sender: "Claude Code",
    avatar: { img: "/agents/claude.png" },
    body: "Allow `pnpm test` in ~/dev/hark?",
    actions: ["Deny", "Allow"],
  },
  {
    sender: "Uptime",
    avatar: { text: "U", bg: "#C93B2C" },
    body: "api.acme.dev is responding again after 3 minutes.",
  },
  {
    sender: "Support bot",
    avatar: { text: "S", bg: "#2F55D4" },
    body: "How should I reply to the customer asking for an extension?",
    actions: ["Reply"],
  },
];

/** Front card, then older ones tucked behind it: smaller, dimmer, peeking out below. */
const DEPTHS = [
  { y: 0, scale: 1, opacity: 1 },
  { y: 10, scale: 0.94, opacity: 0.7 },
  { y: 19, scale: 0.88, opacity: 0.4 },
];
const ARRIVAL_MS = 3000;
const EXIT_MS = 700;

interface Note {
  id: number;
  item: FeedItem;
  /** Arrival time; `null` for the cards present on first paint. */
  at: number | null;
  entered: boolean;
  gone: boolean;
}

const INITIAL: Note[] = [2, 1, 0].map((index) => ({
  id: index,
  item: FEED[index] as FeedItem,
  at: null,
  entered: true,
  gone: false,
}));

function ageLabel(at: number | null, mountedAt: number, now: number): string {
  const seconds = (now - (at ?? mountedAt)) / 1000;
  return seconds < 50 ? "now" : `${Math.round(seconds / 60)}m ago`;
}

/**
 * A live iOS notification stack built in code: a new message drops into the
 * front every few seconds while older ones recede. Cards are absolutely
 * positioned inside a fixed-height stage, so arrivals never move the page.
 * Every change is a transform/opacity transition; behind cards also take the
 * front card's height so the deck edge stays even.
 */
export function NotificationStack() {
  const reduced = usePrefersReducedMotion();
  const [notes, setNotes] = useState<Note[]>(INITIAL);
  const [now, setNow] = useState(0);
  const nextIndex = useRef(INITIAL.length);
  const mountedAt = useRef(0);
  const elements = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    mountedAt.current = Date.now();
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (reduced) return;
    const timeouts = new Set<number>();
    const interval = window.setInterval(() => {
      const id = nextIndex.current++;
      const item = FEED[id % FEED.length] as FeedItem;
      setNow(Date.now());
      setNotes((current) => {
        const visible = current.filter((note) => !note.gone);
        const next = [{ id, item, at: Date.now(), entered: false, gone: false }, ...visible];
        return next.map((note, depth) => (depth >= DEPTHS.length ? { ...note, gone: true } : note));
      });
      const cleanup = window.setTimeout(() => {
        timeouts.delete(cleanup);
        setNotes((current) => current.filter((note) => !note.gone));
      }, EXIT_MS);
      timeouts.add(cleanup);
    }, ARRIVAL_MS);
    return () => {
      window.clearInterval(interval);
      for (const timeout of timeouts) window.clearTimeout(timeout);
    };
  }, [reduced]);

  // Behind cards match the front card's height (actions make cards taller).
  useLayoutEffect(() => {
    // A new card has been laid out in its start pose (above, small, clear).
    // Flushing styles here and then moving it lets the transition run from
    // that pose, without waiting on animation frames.
    const arriving = notes.find((note) => !note.entered);
    if (arriving) {
      void elements.current.get(arriving.id)?.offsetHeight;
      setNotes((current) =>
        current.map((note) => (note.id === arriving.id ? { ...note, entered: true } : note)),
      );
    }
    const visible = notes.filter((note) => !note.gone);
    const front = visible[0] ? elements.current.get(visible[0].id) : undefined;
    if (!front) return;
    front.style.height = "";
    const frontHeight = front.offsetHeight;
    for (const note of visible.slice(1)) {
      const el = elements.current.get(note.id);
      if (!el) continue;
      if (!el.style.height) {
        el.style.height = `${el.offsetHeight}px`;
        void el.offsetHeight;
      }
      el.style.height = `${frontHeight}px`;
    }
  }, [notes]);

  let depth = 0;
  return (
    <div className="hark-note-stack">
      {notes.map((note) => {
        const d = note.gone ? DEPTHS.length : depth++;
        const pose = note.gone
          ? { transform: `translateY(${DEPTHS.length * 9}px) scale(0.82)`, opacity: 0 }
          : !note.entered
            ? { transform: "translateY(-22px) scale(0.97)", opacity: 0 }
            : {
                transform: `translateY(${DEPTHS[d]?.y}px) scale(${DEPTHS[d]?.scale})`,
                opacity: DEPTHS[d]?.opacity,
              };
        return (
          <div
            className={`hark-note ${d > 0 ? "is-behind" : ""}`}
            key={note.id}
            ref={(el) => {
              if (el) elements.current.set(note.id, el);
              else elements.current.delete(note.id);
            }}
            style={{ ...pose, zIndex: DEPTHS.length - d }}
          >
            <div className="hark-note-sender">
              {"img" in note.item.avatar ? (
                <div className="hark-note-avatar">
                  <img alt="" src={note.item.avatar.img} />
                </div>
              ) : (
                <div className="hark-note-avatar" style={{ background: note.item.avatar.bg }}>
                  {note.item.avatar.text}
                </div>
              )}
              <span className="hark-note-badge" />
            </div>
            <div className="hark-note-content">
              <div className="hark-note-row">
                <span className="hark-note-title">{note.item.sender}</span>
                <time>{now === 0 ? "now" : ageLabel(note.at, mountedAt.current, now)}</time>
              </div>
              <div className="hark-note-msg">{note.item.body}</div>
              {note.item.actions ? (
                <div className="hark-note-actions">
                  {note.item.actions.map((action, index, all) => (
                    <span className={index === all.length - 1 ? "is-primary" : ""} key={action}>
                      {action}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
