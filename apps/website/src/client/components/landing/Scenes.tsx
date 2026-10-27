import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Island, LockScreen, NoteActions, PhoneNote, StatusBar, Tap } from "./Phone";
import { type AppCopy, type NoteCopy, type PageCopy, SCENE_STEPS, type Scene } from "./slides";

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

/* Notifications: one webhook lands on the Lock Screen. */

function NotifyNote({ note, step }: { note: NoteCopy; step: number }) {
  if (step < 1) return null;
  return (
    <PhoneNote avatar={note.avatar} body={note.body} subtitle={note.subtitle} title={note.title} />
  );
}

/*
 * An agent's question. iOS keeps a notification's actions out of sight until
 * it is pressed and held: then the Lock Screen blurs, the notification lifts
 * and its actions appear under it. After Approve, the agent's follow-up lands.
 */

const APPROVE_PRESSED = 2;
const APPROVE_DONE = 3;

function ApproveNote({ note, step }: { note: NoteCopy; step: number }) {
  if (step < 1 || !note.approval) return null;
  if (step >= APPROVE_DONE) {
    return (
      <PhoneNote avatar={note.avatar} body={note.approval.result} key="result" title={note.title} />
    );
  }
  const pressed = step === APPROVE_PRESSED;
  return (
    <div className={`hark-ios-press ${pressed ? "is-pressed" : ""}`} key="question">
      <PhoneNote avatar={note.avatar} body={note.body} title={note.title} />
      {pressed ? (
        <NoteActions
          actions={[
            { label: note.approval.approve },
            { label: note.approval.deny, destructive: true },
          ]}
          tapped={note.approval.approve}
        />
      ) : null}
    </div>
  );
}

/*
 * Paging: the page repeats as new notifications that stack on each other
 * until someone acknowledges it; then its notification says who claimed it.
 */

const PAGE_CLAIMED = SCENE_STEPS.page.length - 1;

function PageNote({ page, step }: { page: PageCopy; step: number }) {
  if (step < 1) return null;
  const claimed = step >= PAGE_CLAIMED;
  return (
    <PhoneNote
      body={claimed ? `Claimed by ${page.claimedBy}` : page.body}
      // Every ring and the claim are new notifications, so each one lands.
      key={step}
      stacked={Math.min(step - 1, 2)}
      title={page.title}
    />
  );
}

function LockNote({ scene, step }: { scene: Scene; step: number }) {
  switch (scene.kind) {
    case "notify":
      return <NotifyNote note={scene.note} step={step} />;
    case "approve":
      return <ApproveNote note={scene.note} step={step} />;
    case "page":
      return <PageNote page={scene.page} step={step} />;
    case "team":
      return <NotifyNote note={scene.team.note} step={step} />;
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

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

function WebApp({ app }: { app: AppCopy }) {
  const { chart } = app;
  return (
    <div className="hark-webapp" style={{ "--app-theme": app.bg } as CSSProperties}>
      <div className="hark-webapp-head">
        <div className="hark-webapp-head-row">
          <span className="hark-webapp-name">{app.name}</span>
          <span className="hark-webapp-me">{app.signedInAs.charAt(0)}</span>
        </div>
        <div className="hark-webapp-kicker">{app.kicker}</div>
        <div className="hark-webapp-title">{app.headline}</div>
        <div className="hark-webapp-pass">
          <Check size={13} /> Signed in with Hark as {app.signedInAs}
        </div>
      </div>
      <div className="hark-webapp-body">
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
        {app.latest ? (
          <div className="hark-webapp-list">
            <div className="hark-webapp-list-head">Latest orders</div>
            {app.latest.map((row) => (
              <div className="hark-webapp-row" key={row.label}>
                <span>{row.label}</span>
                <span className="hark-webapp-muted">{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="hark-webapp-hint">
        <i />
        Hold two fingers for Hark · swipe from the left edge to go back
      </div>
    </div>
  );
}

/** Letter tiles for apps without an icon, the same colours the app picks. */
const FALLBACK_TINTS = [
  { bg: "#171713", fg: "#FAFAF9" },
  { bg: "#E7F0ED", fg: "#035B49" },
  { bg: "#2F55D4", fg: "#FFFFFF" },
  { bg: "#F3C53C", fg: "#171713" },
  { bg: "#E7E5E0", fg: "#171713" },
] as const;

function fallbackTint(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return FALLBACK_TINTS[hash % FALLBACK_TINTS.length] ?? FALLBACK_TINTS[0];
}

function LetterTile({ name }: { name: string }) {
  const tint = fallbackTint(name);
  return (
    <span className="hk-icon" style={{ background: tint.bg, color: tint.fg }}>
      {name.charAt(0)}
    </span>
  );
}

const YOURS = ["Releases", "Evals", "Ops Log"];
const TEAM_APPS = ["Status", "Billing", "Flags"];

function Chevron() {
  return (
    <svg aria-hidden="true" className="hk-chevron" fill="none" viewBox="0 0 8 13">
      <path
        d="m1.5 1.5 5 5-5 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

/** SF Symbols `tray.fill`, `gearshape.fill` and `bell.fill`, as the app draws them. */
function TrayIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 20 16" width="20">
      <path d="M3.6 0h12.8c1 0 1.9.6 2.2 1.6L20 8v5.5c0 1.4-1.1 2.5-2.5 2.5h-15C1.1 16 0 14.9 0 13.5V8l1.4-6.4C1.7.6 2.6 0 3.6 0Zm-1.5 7.3h4.3c.5 0 .8.4.8.8 0 1.6 1.3 2.9 2.8 2.9s2.8-1.3 2.8-2.9c0-.4.3-.8.8-.8h4.3L16.7 2a.8.8 0 0 0-.7-.5H4a.8.8 0 0 0-.7.5L2.1 7.3Z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="17" viewBox="0 0 20 20" width="17">
      <path d="M8.6 0h2.8l.5 2.6c.6.2 1.2.4 1.7.7l2.2-1.5 2 2-1.5 2.2c.3.5.6 1.1.7 1.7l2.6.5v2.8l-2.6.5c-.2.6-.4 1.2-.7 1.7l1.5 2.2-2 2-2.2-1.5c-.5.3-1.1.6-1.7.7l-.5 2.6H8.6l-.5-2.6c-.6-.2-1.2-.4-1.7-.7l-2.2 1.5-2-2 1.5-2.2c-.3-.5-.6-1.1-.7-1.7L.4 11.4V8.6L3 8.1c.2-.6.4-1.2.7-1.7L2.2 4.2l2-2 2.2 1.5c.5-.3 1.1-.6 1.7-.7L8.6 0ZM10 6.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8Z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="13" viewBox="0 0 16 16" width="13">
      <path d="M8 1.5a1 1 0 0 1 1 1v.6a4.5 4.5 0 0 1 3.5 4.4v2.6l1.2 1.6a.6.6 0 0 1-.5 1H2.8a.6.6 0 0 1-.5-1l1.2-1.6V7.5A4.5 4.5 0 0 1 7 3.1v-.6a1 1 0 0 1 1-1ZM6.2 13.8h3.6a1.8 1.8 0 0 1-3.6 0Z" />
    </svg>
  );
}

const APP_TAP = 1;

/**
 * Hark's own Apps screen, built from the app's styles (apps/expo/app/apps):
 * light paper, Inter Tight, the Hark mark, status rows, then your apps and
 * your team's apps as icon grids.
 */
function AppScene({ app, step }: { app: AppCopy; step: number }) {
  return (
    <div className="hark-app-screen">
      <div className="hark-app-under">
        <div className="hk-brand-row">
          <span className="hk-brand">
            <i />
            Hark
          </span>
          <span className="hk-actions">
            <span className="hk-action">
              <TrayIcon />
              <b>4</b>
            </span>
            <span className="hk-action">
              <GearIcon />
            </span>
          </span>
        </div>
        <div className="hk-row">
          <span className="hk-row-icon">
            <BellIcon />
          </span>
          On call for Platform until Mon 9:00 AM
          <Chevron />
        </div>
        <div className="hk-row">
          <span className="hk-row-icon">
            <i className="hk-dot" />
          </span>
          2 requests are waiting on you
          <Chevron />
        </div>
        <div className="hk-section">Yours</div>
        <div className="hk-grid">
          <div className={`hk-tile ${step === APP_TAP ? "is-pressed" : ""}`}>
            <span className="hk-icon" style={{ background: app.bg, color: app.fg }}>
              {app.glyph}
            </span>
            <span className="hk-label">{app.name}</span>
          </div>
          {YOURS.map((name) => (
            <div className="hk-tile" key={name}>
              <LetterTile name={name} />
              <span className="hk-label">{name}</span>
            </div>
          ))}
        </div>
        <div className="hk-section">
          Acme <span>4 members</span>
        </div>
        <div className="hk-grid">
          {TEAM_APPS.map((name) => (
            <div className="hk-tile" key={name}>
              <LetterTile name={name} />
              <span className="hk-label">{name}</span>
            </div>
          ))}
        </div>
      </div>
      {step === APP_TAP ? <Tap style={{ left: 64, top: 316 }} /> : null}
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
      <LockScreen
        className={isApp ? "is-unlocked" : ""}
        dimmed={scene.kind === "approve" && step === APPROVE_PRESSED}
      >
        <NoteSwap id={id}>
          <LockNote scene={scene} step={step} />
        </NoteSwap>
      </LockScreen>
      {/* Dark over Hark's light Apps screen, light again over the app's colour. */}
      <StatusBar dark={isApp && step <= APP_TAP} time={isApp} />
      <Island mode="idle" />
    </>
  );
}
