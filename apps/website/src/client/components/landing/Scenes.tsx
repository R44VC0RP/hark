import { AppIcon, type AppTile, Island, LockScreen, PhoneNote, StatusBar, Tap } from "./Phone";
import {
  type AppCopy,
  type NoteCopy,
  PAGE_AVATAR,
  type PageCopy,
  SLIDE_STEPS,
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

export function NotifyScene({ note, step }: { note: NoteCopy; step: number }) {
  const answered = step >= 2;
  return (
    <LockScreen>
      {step >= 1 ? (
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
                <span className="is-primary">{note.approval.approve}</span>
              </div>
            )
          ) : null}
        </PhoneNote>
      ) : null}
    </LockScreen>
  );
}

/* Paging: one page repeats until someone acknowledges it. */

const PAGE_CLAIMED = SLIDE_STEPS.page.length - 1;

export function PageScene({ page, step }: { page: PageCopy; step: number }) {
  if (step < 1) return <LockScreen />;
  const claimed = step >= PAGE_CLAIMED;
  const who = page.claimedBy === "you" ? "you" : page.claimedBy;
  return (
    <LockScreen>
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
                <Bell /> Time Sensitive
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
    </LockScreen>
  );
}

/* Mini apps: tap your own app in Hark and it opens signed in. */

const OTHER_APPS: AppTile[] = [
  { name: "Deploys", glyph: "▲", bg: "#171713", fg: "#fff" },
  { name: "Runbooks", glyph: "R", bg: "#F3C53C", fg: "#171713" },
  { name: "Ops Log", glyph: "O", bg: "#fff", fg: "#035B49" },
];

/** The last 24 hours, one bar each; the second row had a slow hour. */
const HOURS = Array.from({ length: 24 }, (_, hour) => `h${hour}`);

function WebApp({ app }: { app: AppCopy }) {
  return (
    <div className="hark-webapp">
      <div className="hark-webapp-status">9:41</div>
      <div className="hark-webapp-bar">
        <span className="hark-webapp-done">Done</span>
        <span className="hark-webapp-url">
          <span className="hark-webapp-lock">●</span> {app.url}
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
          {app.rows.map((row, index) => (
            <div className="hark-webapp-row" key={row.label}>
              <span>{row.label}</span>
              {row.value === "bars" ? (
                <span className="hark-webapp-bars">
                  {HOURS.map((hour) => (
                    <i className={index === 1 && hour === "h17" ? "is-warn" : ""} key={hour} />
                  ))}
                </span>
              ) : (
                <span className="hark-webapp-muted">{row.value}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const APP_TAP = 1;

export function AppScene({ app, step }: { app: AppCopy; step: number }) {
  const tiles: AppTile[] = [
    { name: app.name, glyph: app.glyph, bg: app.bg, fg: app.fg },
    ...OTHER_APPS.filter((tile) => tile.name !== app.name),
  ].slice(0, 4);
  return (
    <div className="hark-app-screen">
      <StatusBar time />
      <Island mode="idle" />
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
      <div className="hark-app-tabs">
        {["Inbox", "Apps", "On call", "Settings"].map((tab) => (
          <span className={tab === "Apps" ? "is-current" : ""} key={tab}>
            {tab}
          </span>
        ))}
      </div>
      {step === APP_TAP ? <Tap style={{ left: 50, top: 196 }} /> : null}
      <div className={`hark-webapp-sheet ${step > APP_TAP ? "is-open" : ""}`}>
        <WebApp app={app} />
      </div>
    </div>
  );
}

/* Team: the same alert reaches everyone on the team. */

const TEAM_COLORS = ["#035B49", "#2F55D4", "#C93B2C", "#F3C53C", "#6B7A75", "#635BFF"];

export function TeamScene({ team, step }: { team: TeamCopy; step: number }) {
  const { note } = team;
  return (
    <LockScreen>
      {step >= 1 ? (
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
      ) : null}
    </LockScreen>
  );
}
