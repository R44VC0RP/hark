import { type ReactNode, useEffect, useRef, useState } from "react";
import { AppIcon, type AppTile, Island, LockScreen, PhoneNote, StatusBar, Tap } from "./Phone";
import {
  type AppCopy,
  type NoteCopy,
  PAGE_AVATAR,
  type PageCopy,
  SCENE_STEPS,
  type Scene,
  type TeamCopy,
} from "./slides";

function Check({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} viewBox="0 0 16 16" width={size}>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function Bell() {
  return (
    <svg aria-hidden="true" className="hark-bell" fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 1.5a1 1 0 0 1 1 1v.6a4.5 4.5 0 0 1 3.5 4.4v2.6l1.2 1.6a.6.6 0 0 1-.5 1H2.8a.6.6 0 0 1-.5-1l1.2-1.6V7.5A4.5 4.5 0 0 1 7 3.1v-.6a1 1 0 0 1 1-1ZM6.2 13.8h3.6a1.8 1.8 0 0 1-3.6 0Z" />
    </svg>
  );
}

/* Notifications: one webhook (or one agent question) lands on the Lock Screen. */

function NotifyNote({ note, step }: { note: NoteCopy; step: number }) {
  if (step < 1) return null;
  const answered = step >= 2;
  return (
    <PhoneNote
      avatar={note.avatar}
      body={note.body}
      eyebrow={note.eyebrow ? <span className="hark-note-tag">{note.eyebrow}</span> : null}
      title={note.title}
    >
      {note.approval ? (
        answered ? (
          <div className="hark-note-result">
            <Check /> {note.approval.result}
          </div>
        ) : (
          <div className="hark-note-actions">
            <span>{note.approval.deny}</span>
            <span className="is-primary is-tapped">
              {note.approval.approve}
              <i aria-hidden="true" className="hark-note-tap" />
            </span>
          </div>
        )
      ) : null}
    </PhoneNote>
  );
}

/* Paging: one page repeats until someone acknowledges it. */

const PAGE_CLAIMED = SCENE_STEPS.page.length - 1;

function PageNote({ page, step }: { page: PageCopy; step: number }) {
  if (step < 1) return null;
  const claimed = step >= PAGE_CLAIMED;
  const who = page.claimedBy;
  return (
    <PhoneNote
      avatar={claimed && who !== "you" ? { text: who.charAt(0), bg: "#2F55D4" } : PAGE_AVATAR}
      body={claimed ? page.claimedBody : page.body}
      className={claimed ? "" : "is-page"}
      eyebrow={
        claimed ? (
          <span className="hark-note-tag is-claimed">
            <Check size={12} /> Claimed by {who}
          </span>
        ) : (
          <span className="hark-note-eyebrow-row">
            <span className="hark-note-tag is-urgent">
              {/* Keyed by ring, so the bell swings again on every repeat. */}
              <Bell key={step} /> Time Sensitive
            </span>
            <span className="hark-note-repeat" key={step}>
              Ringing · {step}×
            </span>
          </span>
        )
      }
      title={page.title}
    >
      {claimed ? null : (
        <div className="hark-note-actions">
          <span>Escalate</span>
          <span className="is-primary">Acknowledge</span>
        </div>
      )}
    </PhoneNote>
  );
}

/* Team: the same alert reaches everyone on the team. */

const TEAM_COLORS = ["#2FB58F", "#2F55D4", "#C93B2C", "#F3C53C", "#8A9A94", "#635BFF"];

function TeamNote({ team, step }: { team: TeamCopy; step: number }) {
  if (step < 1) return null;
  const { note } = team;
  return (
    <PhoneNote
      avatar={note.avatar}
      body={note.body}
      eyebrow={note.eyebrow ? <span className="hark-note-tag">{note.eyebrow}</span> : null}
      title={note.title}
    >
      {step >= 2 ? (
        <div className="hark-note-shared">
          <span className="hark-note-shared-faces">
            {TEAM_COLORS.slice(0, team.people).map((bg) => (
              <i key={bg} style={{ background: bg }} />
            ))}
          </span>
          Shared with {team.team} · {team.people} people
        </div>
      ) : null}
    </PhoneNote>
  );
}

function LockNote({ scene, step }: { scene: Scene; step: number }) {
  switch (scene.kind) {
    case "notify":
    case "approve":
      return <NotifyNote note={scene.note} step={step} />;
    case "page":
      return <PageNote page={scene.page} step={step} />;
    case "team":
      return <TeamNote step={step} team={scene.team} />;
    case "app":
      return null;
  }
}

/** How long a replaced notification takes to fade out. */
const LEAVE_MS = 280;

/**
 * Shows `children` for moment `id`. When the moment changes, the last
 * notification it showed stays a little longer to fade out instead of
 * vanishing.
 */
function NoteSwap({ id, children }: { id: string; children: ReactNode }) {
  const shown = useRef<ReactNode>(null);
  const [currentId, setCurrentId] = useState(id);
  const [leaving, setLeaving] = useState<{ id: string; node: ReactNode } | null>(null);

  if (currentId !== id) {
    setCurrentId(id);
    setLeaving(shown.current ? { id: currentId, node: shown.current } : null);
  }

  useEffect(() => {
    shown.current = children;
  });

  useEffect(() => {
    if (!leaving) return;
    const timeout = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(timeout);
  }, [leaving]);

  return (
    <>
      {leaving ? (
        <div aria-hidden="true" className="hark-note-leaving" key={`leaving-${leaving.id}`}>
          {leaving.node}
        </div>
      ) : null}
      <div className="hark-note-slot" key={id}>
        {children}
      </div>
    </>
  );
}

/* Mini apps: tap your own app in Hark and it opens signed in. */

const OTHER_APPS: AppTile[] = [
  { name: "Deploys", glyph: "▲", bg: "#171713", fg: "#fff" },
  { name: "Runbooks", glyph: "R", bg: "#F3C53C", fg: "#171713" },
  { name: "Ops Log", glyph: "O", bg: "#fff", fg: "#035B49" },
];

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

function WebApp({ app }: { app: AppCopy }) {
  const { chart } = app;
  return (
    <div className="hark-webapp">
      <div className="hark-webapp-bar">
        <span className="hark-webapp-done">Done</span>
        <span className="hark-webapp-url">
          <LockIcon /> {app.url}
        </span>
        <span className="hark-webapp-more">•••</span>
      </div>
      <div className="hark-webapp-pass">
        <Check size={13} /> {app.signedIn}
      </div>
      <div className="hark-webapp-body">
        <div className="hark-webapp-kicker">{app.kicker}</div>
        <div className="hark-webapp-title">{app.headline}</div>
        <div className="hark-webapp-list">
          {app.rows.map((row) => (
            <div className="hark-webapp-row" key={row.label}>
              <span>{row.label}</span>
              <span className="hark-webapp-muted">{row.value}</span>
            </div>
          ))}
        </div>
        {chart ? (
          <div className="hark-webapp-chart">
            <div className="hark-webapp-chart-head">
              <span>{chart.label}</span>
              <span className="hark-webapp-chart-delta">{chart.delta}</span>
            </div>
            <div className="hark-webapp-bars">
              {chart.values.map((value, index) => (
                <span
                  className={index === chart.values.length - 1 ? "is-today" : ""}
                  // biome-ignore lint/suspicious/noArrayIndexKey: one bar per weekday.
                  key={index}
                >
                  <i style={{ height: `${value}%`, animationDelay: `${index * 40}ms` }} />
                  {DAYS[index]}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="11" viewBox="0 0 14 18" width="9">
      <path d="M7 0a4.5 4.5 0 0 0-4.5 4.5V7H2a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-.5V4.5A4.5 4.5 0 0 0 7 0Zm-3 4.5a3 3 0 0 1 6 0V7H4V4.5Z" />
    </svg>
  );
}

/** The Hark app's tab bar icons, drawn as simple SF Symbol-like strokes. */
const TAB_ICONS: Record<string, ReactNode> = {
  Inbox: (
    <path d="M3 13.5 5.4 6.2A2 2 0 0 1 7.3 5h9.4a2 2 0 0 1 1.9 1.2L21 13.5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4.5Zm0 0h5l1.5 2.5h5l1.5-2.5h5" />
  ),
  Apps: (
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3Zm10 0A1.5 1.5 0 0 1 15.5 4h3A1.5 1.5 0 0 1 20 5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 8.5v-3Zm-10 10A1.5 1.5 0 0 1 5.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3Zm10 0a1.5 1.5 0 0 1 1.5-1.5h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3Z" />
  ),
  "On call": (
    <path d="M12 3.5a5.5 5.5 0 0 1 5.5 5.5v3.6l1.6 2.6a.8.8 0 0 1-.7 1.3H5.6a.8.8 0 0 1-.7-1.3l1.6-2.6V9A5.5 5.5 0 0 1 12 3.5Zm-2.2 15h4.4a2.2 2.2 0 0 1-4.4 0Z" />
  ),
  Settings: <path d="M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5v5M9 14.5v5" />,
};

function AppTabs() {
  return (
    <div className="hark-app-tabs">
      {Object.entries(TAB_ICONS).map(([tab, icon]) => (
        <span className={tab === "Apps" ? "is-current" : ""} key={tab}>
          <svg
            aria-hidden="true"
            fill={tab === "Apps" ? "currentColor" : "none"}
            height="24"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
            width="24"
          >
            {icon}
          </svg>
          {tab}
        </span>
      ))}
    </div>
  );
}

const APP_TAP = 1;

function AppScene({ app, step }: { app: AppCopy; step: number }) {
  const tiles: AppTile[] = [
    { name: app.name, glyph: app.glyph, bg: app.bg, fg: app.fg },
    ...OTHER_APPS.filter((tile) => tile.name !== app.name),
  ].slice(0, 4);
  return (
    <div className="hark-app-screen">
      <div className="hark-app-title">Apps</div>
      <div className="hark-app-section">
        <div className="hark-app-section-head">
          <span>My apps</span>
        </div>
        <div className="hark-app-grid">
          {tiles.map((tile, index) => (
            <AppIcon app={tile} key={tile.name} pressed={index === 0 && step === APP_TAP} />
          ))}
        </div>
      </div>
      <AppTabs />
      {step === APP_TAP ? <Tap style={{ left: 66, top: 216 }} /> : null}
      <div className={`hark-webapp-sheet ${step > APP_TAP ? "is-open" : ""}`}>
        <WebApp app={app} />
      </div>
    </div>
  );
}

/**
 * Everything on the phone's screen. The Lock Screen, status bar and Dynamic
 * Island stay mounted from one moment to the next, so only what changes
 * moves: notifications swap, and the app moments unlock the phone (the Lock
 * Screen slides up) instead of cutting to a new screen.
 */
export function PhoneStage({ id, scene, step }: { id: string; scene: Scene; step: number }) {
  const isApp = scene.kind === "app";
  // The app stays under the Lock Screen as it was, so locking again doesn't
  // show it resetting. It starts fresh (keyed by moment) on the next unlock.
  const [lastApp, setLastApp] = useState<{ id: string; app: AppCopy; step: number } | null>(null);
  if (isApp && (lastApp?.id !== id || lastApp.step !== step || lastApp.app !== scene.app)) {
    setLastApp({ id, app: scene.app, step });
  }
  const app = isApp ? { id, app: scene.app, step } : lastApp;

  return (
    <>
      {app ? <AppScene app={app.app} key={app.id} step={app.step} /> : null}
      <LockScreen className={isApp ? "is-unlocked" : ""}>
        <NoteSwap id={id}>
          <LockNote scene={scene} step={step} />
        </NoteSwap>
      </LockScreen>
      <StatusBar dark={isApp && step > APP_TAP} time={isApp} />
      <Island mode="idle" />
    </>
  );
}
