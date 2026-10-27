import { Gear } from "../LiveActivityDemo";
import {
  AppIcon,
  type AppTile,
  HomeScreen,
  Island,
  LockScreen,
  PhoneNote,
  StatusBar,
  Tap,
} from "./Phone";
import {
  AGENT,
  DEPLOY_STEPS,
  ENGINEER_NOTIFY_STEP,
  ENGINEER_UNLOCK_STEP,
  ONCALL,
  TEAM,
} from "./roles";

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

/* -------------------------------------------------------------------------- */
/* Engineer: Live Activity on the Lock Screen, then the Island, then a webhook */
/* -------------------------------------------------------------------------- */

function DeployActivity({ step }: { step: number }) {
  const [progress, status, detail] = DEPLOY_STEPS[Math.min(step, DEPLOY_STEPS.length - 1)] ?? [
    0,
    "",
    "",
  ];
  const pct = `${Math.round(progress * 100)}%`;
  return (
    <div className="hark-la">
      <div className="flex items-center justify-between">
        <div className="hark-la-label">
          <Gear />
          <span>Deploy #184</span>
        </div>
        <div className="hark-la-pct">{pct}</div>
      </div>
      <div className="hark-la-status" key={status}>
        {status}
      </div>
      <div className="hark-la-detail" key={detail}>
        {detail}
      </div>
      <div className="hark-la-bar">
        <i style={{ width: pct }} />
      </div>
    </div>
  );
}

export function EngineerScene({ step }: { step: number }) {
  const unlocked = step >= ENGINEER_UNLOCK_STEP;
  const [progress] = DEPLOY_STEPS[Math.min(step, DEPLOY_STEPS.length - 1)] ?? [0];
  const done = progress >= 1;
  const mode = step >= ENGINEER_NOTIFY_STEP ? "idle" : done ? "expanded" : "compact";
  return (
    <>
      <HomeScreen
        island={
          <Island
            expanded={
              <div className="hark-dyn-deploy">
                <div className="hark-dyn-deploy-icon">
                  <Check size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="hark-dyn-deploy-title">Deployed</div>
                  <div className="hark-dyn-deploy-detail">
                    Deploy #184 · hark.ryan.ceo is healthy
                  </div>
                </div>
                <div className="hark-la-pct">100%</div>
              </div>
            }
            leading={<Gear />}
            mode={unlocked ? mode : "idle"}
            trailing={<span className="hark-la-pct">{Math.round(progress * 100)}%</span>}
          />
        }
      >
        {step >= ENGINEER_NOTIFY_STEP ? (
          <div className="hark-banner">
            <PhoneNote
              avatar={{ text: "G", bg: "#24292F" }}
              body="Production deployed successfully. 3 commits by Ryan."
              title="GitHub"
            />
          </div>
        ) : null}
      </HomeScreen>
      <LockScreen className={unlocked ? "is-unlocked" : ""}>
        <DeployActivity step={step} />
        <PhoneNote
          avatar={{ text: "S", bg: "#635BFF" }}
          body="New subscription: Pro plan, $8.00/month."
          className="is-older"
          time="2h ago"
          title="Stripe"
        />
      </LockScreen>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* On call: ring, repeat, escalate to Ben, "Claimed by Ben", low urgency       */
/* -------------------------------------------------------------------------- */

export function OncallScene({ step }: { step: number }) {
  const ringing = step >= ONCALL.ring && step < ONCALL.claimed;
  const repeat = Math.min(step, 3);
  return (
    <LockScreen
      island={
        <Island
          leading={<Bell />}
          mode={ringing ? "compact" : "idle"}
          trailing={<span className="hark-dyn-page">Paging</span>}
        />
      }
    >
      {step >= ONCALL.low ? (
        <PhoneNote
          avatar={{ text: "P", bg: "#6B7A75" }}
          body="Cert expires in 20 days."
          eyebrow={<span className="hark-note-tag">Low urgency · one alert</span>}
          key="low"
          title="Platform on-call"
        />
      ) : null}
      {ringing ? (
        <PhoneNote
          avatar={{ text: "P", bg: "#C93B2C" }}
          body={
            step >= ONCALL.escalate ? (
              <>
                API error rate above 20%.{" "}
                <span className="hark-note-strong">No answer in 5m, now paging Ben.</span>
              </>
            ) : (
              "API error rate above 20%. 5xx since 14:02."
            )
          }
          className="is-page"
          eyebrow={
            <span className="hark-note-eyebrow-row">
              <span className="hark-note-tag is-urgent">
                <Bell /> Time Sensitive
              </span>
              <span className="hark-note-repeat" key={repeat}>
                {step >= ONCALL.escalate ? "Level 1 · Ben" : `Repeat ×${repeat}`}
              </span>
            </span>
          }
          key="page"
          title="Platform on-call"
        >
          <div className="hark-note-actions">
            <span>Escalate</span>
            <span className="is-primary">Acknowledge</span>
          </div>
        </PhoneNote>
      ) : null}
      {step >= ONCALL.claimed ? (
        <PhoneNote
          avatar={{ text: "B", bg: "#2F55D4" }}
          body="API error rate above 20%. You can stand down."
          className="is-quiet"
          key="claimed"
          time={step >= ONCALL.low ? "1m ago" : "now"}
          title="Claimed by Ben"
        />
      ) : null}
      <PhoneNote
        avatar={{ text: "G", bg: "#24292F" }}
        body="Production deployed successfully."
        className="is-older"
        key="older"
        time="18m ago"
        title="GitHub"
      />
    </LockScreen>
  );
}

const LEVELS = [
  { name: "Ryan", role: "On call · level 0", initial: "R", bg: "#035B49" },
  { name: "Ben", role: "Next up · after 5m", initial: "B", bg: "#2F55D4" },
  { name: "Platform", role: "Whole group · +10m", initial: "P", bg: "#6B7A75" },
];

/** Who is being paged at each level, beside the phone on wide screens. */
export function EscalationLadder({ step }: { step: number }) {
  const state = (level: number): { label: string; tone: string } => {
    if (step >= ONCALL.low) {
      return level === 0
        ? { label: "Alerted once", tone: "" }
        : { label: "Not paged", tone: "is-idle" };
    }
    if (step >= ONCALL.claimed) {
      if (level === 1) return { label: "Acknowledged", tone: "is-ack" };
      if (level === 0) return { label: "Claimed by Ben", tone: "" };
      return { label: "Not needed", tone: "is-idle" };
    }
    if (level === 0 && step >= ONCALL.ring) return { label: "Ringing", tone: "is-ring" };
    if (level === 1 && step >= ONCALL.escalate) return { label: "Ringing", tone: "is-ring" };
    return { label: "Waiting", tone: "is-idle" };
  };
  return (
    <div aria-hidden="true" className="hark-glass hark-ladder">
      <div className="hark-ladder-head">
        <span>Escalation</span>
        <span className="hark-ladder-urgency">{step >= ONCALL.low ? "Low" : "High"} urgency</span>
      </div>
      {LEVELS.map((level, index) => {
        const { label, tone } = state(index);
        return (
          <div className={`hark-ladder-row ${tone}`} key={level.name}>
            <span className="hark-ladder-avatar" style={{ background: level.bg }}>
              {level.initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-white">{level.name}</span>
              <span className="block truncate text-xs text-ink-faint">{level.role}</span>
            </span>
            <span className="hark-ladder-state">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Agent: approval, then a typed reply                                         */
/* -------------------------------------------------------------------------- */

const REPLY = "Fixes the page sound on iOS 27.";

export function AgentScene({ step }: { step: number }) {
  return (
    <LockScreen>
      {step >= AGENT.ask ? (
        <PhoneNote
          avatar={{ img: "/agents/opencode.png" }}
          body="What should the release note say?"
          key="reply"
          title="OpenCode"
        >
          {step >= AGENT.sent ? (
            <div className="hark-note-reply is-sent">
              <span>{REPLY}</span>
              <span className="hark-note-reply-meta">
                <Check size={12} /> Sent
              </span>
            </div>
          ) : (
            <div className="hark-note-field">
              {step >= AGENT.typing ? (
                <span className="hark-typing">{REPLY}</span>
              ) : (
                <span className="text-white/45">Reply…</span>
              )}
              <span className={`hark-note-send ${step >= AGENT.typing ? "is-ready" : ""}`}>↑</span>
            </div>
          )}
        </PhoneNote>
      ) : null}
      <PhoneNote
        avatar={{ img: "/agents/claude.png" }}
        body="Deploy hark to production? 3 commits, all tests passing."
        className={step >= AGENT.ask ? "is-older" : ""}
        key="approval"
        time={step >= AGENT.ask ? "1m ago" : "now"}
        title="Claude Code"
      >
        {step >= AGENT.approved ? (
          <div className="hark-note-result">
            <Check /> Approved — continuing
          </div>
        ) : (
          <div className="hark-note-actions">
            <span>Deny</span>
            <span className={`is-primary ${step >= AGENT.tap ? "is-pressed" : ""}`}>Approve</span>
          </div>
        )}
      </PhoneNote>
      {step === AGENT.tap ? <Tap style={{ left: 282, top: 93 }} /> : null}
    </LockScreen>
  );
}

/* -------------------------------------------------------------------------- */
/* Team: shared web apps that open signed in                                   */
/* -------------------------------------------------------------------------- */

const TEAM_APPS: AppTile[] = [
  { name: "Status", glyph: "●", bg: "#0F7A5F", fg: "#B9F5DF" },
  { name: "Deploys", glyph: "▲", bg: "#171713", fg: "#fff" },
  { name: "Runbooks", glyph: "R", bg: "#F3C53C", fg: "#171713" },
  { name: "Billing", glyph: "$", bg: "#635BFF", fg: "#fff" },
];

const MY_APPS: AppTile[] = [
  { name: "Evals", glyph: "E", bg: "#2F55D4", fg: "#fff" },
  { name: "Pantry", glyph: "P", bg: "#F3C53C", fg: "#171713" },
  { name: "Ops Log", glyph: "O", bg: "#fff", fg: "#035B49" },
];

const COMPONENTS = ["API", "Webhooks", "Push delivery", "Dashboard"];
/** The last 24 hours, one bar each; Webhooks had a slow hour. */
const HOURS = Array.from({ length: 24 }, (_, hour) => `h${hour}`);

function StatusApp() {
  return (
    <div className="hark-webapp">
      <div className="hark-webapp-status">9:41</div>
      <div className="hark-webapp-bar">
        <span className="hark-webapp-done">Done</span>
        <span className="hark-webapp-url">
          <span className="hark-webapp-lock">●</span> status.acme.dev
        </span>
        <span className="hark-webapp-more">•••</span>
      </div>
      <div className="hark-webapp-pass">
        <Check size={13} /> Signed in as Ryan · Acme admin
      </div>
      <div className="hark-webapp-body">
        <div className="hark-webapp-kicker">Acme status</div>
        <div className="hark-webapp-title">All systems operational</div>
        <div className="hark-webapp-list">
          {COMPONENTS.map((name, index) => (
            <div className="hark-webapp-row" key={name}>
              <span>{name}</span>
              <span className="hark-webapp-bars">
                {HOURS.map((hour) => (
                  <i className={index === 1 && hour === "h17" ? "is-warn" : ""} key={hour} />
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="hark-webapp-kicker mt-6">Past incidents</div>
        <div className="hark-webapp-list">
          <div className="hark-webapp-row">
            <span>Webhook delays</span>
            <span className="hark-webapp-muted">Resolved · 2h ago</span>
          </div>
          <div className="hark-webapp-row">
            <span>Uptime, 30 days</span>
            <span className="hark-webapp-muted">99.98%</span>
          </div>
        </div>
        <div className="hark-webapp-foot">Ryan Vogel · ryan@acme.dev</div>
      </div>
    </div>
  );
}

export function TeamScene({ step }: { step: number }) {
  return (
    <div className="hark-app-screen">
      <StatusBar time />
      <Island mode="idle" />
      <div className="hark-app-title">Apps</div>
      <div className="hark-app-section">
        <div className="hark-app-section-head">
          <span>Acme</span>
          <span className="hark-app-members">
            {["#035B49", "#2F55D4", "#C93B2C", "#F3C53C"].map((bg) => (
              <i key={bg} style={{ background: bg }} />
            ))}
            6 members
          </span>
        </div>
        <div className="hark-app-grid">
          {TEAM_APPS.map((app, index) => (
            <AppIcon app={app} key={app.name} pressed={index === 0 && step === TEAM.tap} />
          ))}
        </div>
      </div>
      <div className="hark-app-section">
        <div className="hark-app-section-head">
          <span>My apps</span>
        </div>
        <div className="hark-app-grid">
          {MY_APPS.map((app) => (
            <AppIcon app={app} key={app.name} />
          ))}
        </div>
      </div>
      <div className="hark-app-section">
        <div className="hark-app-section-head">
          <span>On call · Platform</span>
          <span className="hark-app-oncall-live">Now</span>
        </div>
        <div className="hark-app-oncall">
          <span className="hark-app-oncall-avatar" style={{ background: "#035B49" }}>
            R
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">Ryan Vogel</span>
            <span className="block text-[13px] text-white/60">Until Monday 9:00 · then Ben</span>
          </span>
        </div>
      </div>
      <div className="hark-app-tabs">
        {["Inbox", "Apps", "On call", "Settings"].map((tab) => (
          <span className={tab === "Apps" ? "is-current" : ""} key={tab}>
            {tab}
          </span>
        ))}
      </div>
      {step === TEAM.tap ? <Tap style={{ left: 50, top: 196 }} /> : null}
      <div className={`hark-webapp-sheet ${step >= TEAM.open ? "is-open" : ""}`}>
        <StatusApp />
      </div>
    </div>
  );
}
