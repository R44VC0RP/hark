import type { Avatar } from "./Phone";

/**
 * Everything the landing page says, per niche. `?niche=<id>` picks one so
 * different audiences can be compared without code changes; unknown or
 * missing values fall back to `dev`.
 */

export type SlideId = "notify" | "page" | "app" | "team";

export interface NoteCopy {
  avatar: Avatar;
  title: string;
  body: string;
  /** Shown above the title, e.g. the event name. */
  eyebrow?: string;
  /** Turns the notification into a question with two answers. */
  approval?: { deny: string; approve: string; result: string };
}

export interface PageCopy {
  title: string;
  body: string;
  /** Who answers the page. */
  claimedBy: string;
  claimedBody: string;
}

export interface AppRow {
  label: string;
  /** A value, or `bars` for a 24-hour uptime strip (one hour warns). */
  value: string | "bars";
}

export interface AppCopy {
  /** The app's icon on the Apps screen. */
  name: string;
  glyph: string;
  bg: string;
  fg: string;
  url: string;
  signedIn: string;
  kicker: string;
  headline: string;
  rows: AppRow[];
}

export interface TeamCopy {
  team: string;
  people: number;
  note: NoteCopy;
}

export interface Niche {
  headline: string;
  /** The line under the headline for each slide. */
  lines: Record<SlideId, string>;
  notify: NoteCopy;
  page: PageCopy;
  app: AppCopy;
  team: TeamCopy;
}

export const SLIDES: { id: SlideId; label: string }[] = [
  { id: "notify", label: "Notifications" },
  { id: "page", label: "Paging" },
  { id: "app", label: "Mini apps" },
  { id: "team", label: "Team" },
];

/**
 * How long each step of a slide lasts, in ms. Every slide adds up to 7 s;
 * the last step is the slide's final state (and all reduced motion shows).
 */
export const SLIDE_STEPS: Record<SlideId, number[]> = {
  // Empty Lock Screen, the notification lands (an approval is then answered).
  notify: [700, 2600, 3700],
  // Rings 1×, 2×, 3×, then someone claims it.
  page: [600, 1100, 1100, 1100, 3100],
  // The Apps tab, a tap, then the app opens signed in.
  app: [1300, 500, 5200],
  // The alert lands, then who else got it.
  team: [700, 1500, 4800],
};

const LINES: Record<SlideId, string> = {
  notify: "Webhook notifications.",
  page: "Paging that rings until someone answers.",
  app: "Your own mini apps, signed in.",
  team: "For you, or your whole team.",
};

const STRIPE: Avatar = { text: "S", bg: "#635BFF" };
const ONCALL: Avatar = { text: "P", bg: "#C93B2C" };

const STATUS_APP: AppCopy = {
  name: "Status",
  glyph: "●",
  bg: "#0F7A5F",
  fg: "#B9F5DF",
  url: "status.acme.dev",
  signedIn: "Signed in as Ryan · Acme admin",
  kicker: "Acme status",
  headline: "All systems operational",
  rows: [
    { label: "API", value: "bars" },
    { label: "Webhooks", value: "bars" },
    { label: "Push delivery", value: "bars" },
    { label: "Uptime, 30 days", value: "99.98%" },
  ],
};

const DEV: Niche = {
  headline: "The everything app for developer teams.",
  lines: LINES,
  notify: {
    avatar: STRIPE,
    title: "Stripe",
    eyebrow: "New subscription",
    body: "Pro plan, $49/mo. Northwind Labs just upgraded.",
  },
  page: {
    title: "Platform on-call",
    body: "API error rate above 20%. 5xx since 14:02.",
    claimedBy: "Ben",
    claimedBody: "Ben is on it. You can stand down.",
  },
  app: STATUS_APP,
  team: {
    team: "Acme",
    people: 6,
    note: {
      avatar: { text: "G", bg: "#24292F" },
      title: "GitHub",
      eyebrow: "Deploy finished",
      body: "Production is live. 3 commits by Ryan, all checks passed.",
    },
  },
};

export const NICHES: Record<string, Niche> = {
  dev: DEV,
  agents: {
    headline: "The everything app for people who run AI agents.",
    lines: { ...LINES, notify: "Your agents ask, you answer from the Lock Screen." },
    notify: {
      avatar: { img: "/agents/claude.png" },
      title: "Claude Code",
      body: "Deploy hark to production? 3 commits, all tests passing.",
      approval: { deny: "Deny", approve: "Approve", result: "Approved — continuing" },
    },
    page: {
      title: "Nightly agent run",
      body: "Evals dropped to 81%. The release is on hold.",
      claimedBy: "Maya",
      claimedBody: "Maya is looking at the failing evals.",
    },
    app: {
      name: "Evals",
      glyph: "E",
      bg: "#2F55D4",
      fg: "#fff",
      url: "evals.acme.dev",
      signedIn: "Signed in as Ryan",
      kicker: "Tonight's run",
      headline: "412 of 420 passing",
      rows: [
        { label: "Tool use", value: "99%" },
        { label: "Refactors", value: "97%" },
        { label: "Long context", value: "94%" },
        { label: "Cost", value: "$18.40" },
      ],
    },
    team: {
      team: "Acme",
      people: 6,
      note: {
        avatar: { img: "/agents/codex.png" },
        title: "Codex",
        eyebrow: "Pull request ready",
        body: "PR #212 fixes the flaky upload test. Ready for review.",
      },
    },
  },
  indie: {
    headline: "The everything app for indie hackers.",
    lines: LINES,
    notify: {
      avatar: STRIPE,
      title: "Stripe",
      eyebrow: "You made a sale",
      body: "$29 · Lifetime license, from Berlin.",
    },
    page: {
      title: "Uptime",
      body: "myapp.com is down. 3 checks failed in a row.",
      claimedBy: "you",
      claimedBody: "Acknowledged. Paging stopped.",
    },
    app: {
      name: "Sales",
      glyph: "$",
      bg: "#635BFF",
      fg: "#fff",
      url: "admin.myapp.com",
      signedIn: "Signed in as Ryan",
      kicker: "Today",
      headline: "$1,284 in sales",
      rows: [
        { label: "Orders", value: "38" },
        { label: "New customers", value: "31" },
        { label: "Refunds", value: "1" },
        { label: "MRR", value: "$6,920" },
      ],
    },
    team: {
      team: "Co-founders",
      people: 2,
      note: {
        avatar: STRIPE,
        title: "Stripe",
        eyebrow: "New subscription",
        body: "Team plan, $99/mo. Your biggest customer yet.",
      },
    },
  },
  ops: {
    headline: "The everything app for on-call teams.",
    lines: LINES,
    notify: {
      avatar: { text: "U", bg: "#0F7A5F" },
      title: "Uptime",
      eyebrow: "Recovered",
      body: "api.acme.dev is back up. Down for 2m 14s.",
    },
    page: {
      title: "SEV-1 · Checkout API",
      body: "Error rate 24%. Payments failing in us-east-1.",
      claimedBy: "Ben",
      claimedBody: "Ben acknowledged. Incident #431 opened.",
    },
    app: STATUS_APP,
    team: {
      team: "Platform",
      people: 6,
      note: {
        avatar: ONCALL,
        title: "Platform on-call",
        eyebrow: "Handoff",
        body: "Ben is on call until Monday 9:00.",
      },
    },
  },
  founders: {
    headline: "The everything app for startup founders.",
    lines: LINES,
    notify: {
      avatar: STRIPE,
      title: "Stripe",
      eyebrow: "New annual plan",
      body: "$2,400/yr from Northwind. That's 12 this month.",
    },
    page: {
      title: "Platform on-call",
      body: "Sign-ups are failing. Error rate above 20%.",
      claimedBy: "Ben",
      claimedBody: "Ben is on it. You can stand down.",
    },
    app: {
      name: "Metrics",
      glyph: "M",
      bg: "#171713",
      fg: "#fff",
      url: "metrics.acme.dev",
      signedIn: "Signed in as Ryan · Acme admin",
      kicker: "This month",
      headline: "$48.2k MRR · +12%",
      rows: [
        { label: "New customers", value: "64" },
        { label: "Churn", value: "1.8%" },
        { label: "Runway", value: "22 months" },
        { label: "Sign-ups today", value: "212" },
      ],
    },
    team: DEV.team,
  },
};

/** The niche for a `?niche=` value; anything unknown is the default. */
export function nicheFor(value: string | null): Niche {
  return (value && NICHES[value]) || DEV;
}

export const PAGE_AVATAR = ONCALL;
