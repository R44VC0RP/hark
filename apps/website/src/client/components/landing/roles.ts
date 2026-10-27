/**
 * The four stories the landing phone replays. Each role is a short loop of
 * steps; `durations[i]` is how long step `i` holds before the next one.
 * Everything here is mock data: nothing on the landing page calls the API.
 */

export type RoleId = "engineer" | "oncall" | "agent" | "team";

export interface Snippet {
  /** Small caption above the code: where this runs. */
  label: string;
  language: "bash" | "json";
  code: string;
}

export interface Role {
  id: RoleId;
  label: string;
  pitch: string;
  bullets: string[];
  /** Step durations in milliseconds. */
  durations: number[];
  snippets: Snippet[];
  /** Which snippet is on screen at each step. */
  snippetAt: (step: number) => number;
  /** What the command reported so far, one line per step (empty = nothing new). */
  output: (step: number) => string | null;
  /** One line of code for the condensed mobile layout. */
  chip: string;
  /** What the phone shows, for screen readers. */
  description: string;
}

/** Deploy #184's Live Activity: [progress, status, detail]. */
export const DEPLOY_STEPS: [number, string, string][] = [
  [0.04, "Starting", "Queued on raven-cobra"],
  [0.18, "Installing", "pnpm install --frozen-lockfile"],
  [0.36, "Building", "Compiling packages/website-runtime"],
  [0.55, "Building", "Bundling apps/website (vite)"],
  [0.72, "Testing", "230 tests in apps/website"],
  [0.88, "Deploying", "Restarting hark on raven-cobra"],
  [1, "Deployed", "hark.ryan.ceo is healthy"],
];

/** Steps 0–3 on the Lock Screen, 4–5 in the Dynamic Island, 6 expanded, 7 webhook. */
export const ENGINEER_UNLOCK_STEP = 4;
export const ENGINEER_NOTIFY_STEP = 7;

export const ONCALL = { ring: 1, escalate: 4, claimed: 5, low: 6 } as const;
export const AGENT = { tap: 1, approved: 2, ask: 3, typing: 4, sent: 5 } as const;
export const TEAM = { tap: 1, open: 2 } as const;

export const ROLES: Role[] = [
  {
    id: "engineer",
    label: "Engineer",
    pitch: "Ship from CI and watch it land on your Lock Screen.",
    bullets: [
      "Any webhook becomes a notification from that sender.",
      "Live Activities track builds and deploys on the Lock Screen and in the Dynamic Island.",
      "Tap through to the run, an app deep link or a Shortcut.",
    ],
    durations: [1300, 1300, 1300, 1300, 1400, 1400, 2400, 3800],
    snippets: [
      {
        label: "deploy.yml · Live Activity",
        language: "bash",
        code: `curl -X POST "$HARK_WEBHOOK/live-activities" \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"Deploy #184","status":"Building",
       "progress":0.36,"symbol":"build"}'`,
      },
      {
        label: "deploy.yml · webhook",
        language: "bash",
        code: `curl -X POST "$HARK_WEBHOOK" \\
  -H 'Content-Type: application/json' \\
  -d '{"title":"GitHub",
       "body":"Production deployed successfully."}'`,
      },
    ],
    snippetAt: (step) => (step >= ENGINEER_NOTIFY_STEP ? 1 : 0),
    output: (step) => {
      if (step >= ENGINEER_NOTIFY_STEP) return '{"ok":true,"eventId":"evt_Cxns2I…","delivered":1}';
      const [progress, status] = DEPLOY_STEPS[Math.min(step, DEPLOY_STEPS.length - 1)] ?? [0, ""];
      const verb = step === 0 ? "POST" : "PATCH";
      return `${verb} act_9Rk2wQ · ${status} · ${Math.round(progress * 100)}%`;
    },
    chip: 'harkctl notify "Deployed to production"',
    description:
      "An iPhone Lock Screen shows a Deploy #184 Live Activity climbing to 100%, the Dynamic Island follows it after unlocking, then GitHub notifies that production deployed.",
  },
  {
    id: "oncall",
    label: "On call",
    pitch: "Pages that ring until a person answers.",
    bullets: [
      "High urgency rings again and escalates level by level until someone acknowledges.",
      "The first acknowledgement claims it. Everyone else gets a quiet “Claimed by Ben”.",
      "Low urgency sends one ordinary alert for things that can wait until morning.",
    ],
    durations: [900, 1500, 1500, 1800, 2600, 2600, 3600],
    snippets: [
      {
        label: "Terminal · harkctl",
        language: "bash",
        code: `harkctl page ocg_9Fq2 "API error rate above 20%" \\
  --body "5xx since 14:02" --dedup-key api-5xx`,
      },
      {
        label: "Terminal · harkctl",
        language: "bash",
        code: `# Can wait until morning: one alert, no ringing
harkctl page ocg_9Fq2 "Cert expires in 20 days" \\
  --urgency low`,
      },
    ],
    snippetAt: (step) => (step >= ONCALL.low ? 1 : 0),
    output: (step) => {
      if (step >= ONCALL.low) return "page_K2v8 · low · alerted Ryan once";
      if (step >= ONCALL.claimed) return "page_7Hq2 · acknowledged by Ben · ringing stopped";
      if (step >= ONCALL.escalate) return "page_7Hq2 · no answer in 5m · level 1 → Ben";
      if (step >= ONCALL.ring) return `page_7Hq2 · ringing Ryan · repeat ${step}`;
      return null;
    },
    chip: `harkctl page ocg_9Fq2 "API errors above 20%"`,
    description:
      "Ryan's iPhone rings with a time-sensitive page, repeats, escalates to Ben, then quietly shows “Claimed by Ben” when Ben acknowledges. A low-urgency page arrives once, without ringing.",
  },
  {
    id: "agent",
    label: "Agent",
    pitch: "Your agents ask. You answer from the Lock Screen.",
    bullets: [
      "Approve or Deny, Yes or No, or a typed reply, without opening anything.",
      "One MCP server and the harkctl CLI for Claude Code, Codex and OpenCode.",
      "Agents wait for your answer. Only a person can give it.",
    ],
    durations: [2600, 900, 2200, 2300, 2600, 3200],
    snippets: [
      {
        label: "MCP tool call · ask",
        language: "json",
        code: `{
  "kind": "approval",
  "prompt": "Deploy hark to production?",
  "timeoutSeconds": 600
}`,
      },
      {
        label: "MCP tool call · ask",
        language: "json",
        code: `{
  "kind": "reply",
  "prompt": "What should the release note say?",
  "timeoutSeconds": 600
}`,
      },
    ],
    snippetAt: (step) => (step >= AGENT.ask ? 1 : 0),
    output: (step) => {
      if (step >= AGENT.sent) return '"status": "answered", "text": "Fixes the page sound…"';
      if (step >= AGENT.ask) return "Waiting for an answer…";
      if (step >= AGENT.approved) return '"status": "answered", "action": "approve"';
      return "Waiting for an answer…";
    },
    chip: "npx skills add R44VC0RP/hark --skill hark",
    description:
      "Claude Code asks to deploy to production on the Lock Screen and Ryan taps Approve, so it continues. OpenCode then asks for a release note and Ryan types a reply.",
  },
  {
    id: "team",
    label: "Team",
    pitch: "Your team's web apps, signed in on every iPhone.",
    bullets: [
      "Share apps with a team. Each opens full screen in Hark with a signed pass.",
      "No login screens to build: the pass carries team_id and team_role.",
      "Remove someone and their passes stop at once. Teams share on-call too.",
    ],
    durations: [2400, 800, 3200, 3000],
    snippets: [
      {
        label: "Terminal · harkctl",
        language: "bash",
        code: `harkctl apps create --name "Status" \\
  --url https://status.acme.dev
harkctl apps share app_4tR8 --team team_acme`,
      },
    ],
    snippetAt: () => 0,
    output: (step) =>
      step >= TEAM.open
        ? "Ryan opened Status · pass team_role=admin"
        : "Shared with Acme · 6 members",
    chip: "harkctl apps share app_4tR8 --team team_acme",
    description:
      "The Hark app lists Acme's shared web apps. Ryan taps Status and it opens full screen, already signed in as an Acme admin.",
  },
];
