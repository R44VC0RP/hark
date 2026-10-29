import type { Avatar } from "./Phone";

/**
 * Everything the landing page says. The headline is "The everything app
 * for" plus one audience at a time; each audience brings one phone moment
 * and one line. `?niche=<id>` pins a step so a link can show one audience.
 */

/** What iOS shows for a push: no extra chrome, only these fields. */
export interface NoteCopy {
  /** The sender's picture (a communication notification); else the Hark icon. */
  avatar?: Avatar;
  title: string;
  subtitle?: string;
  body: string;
  /**
   * A question with actions. On iOS they show only when the notification is
   * pressed and held; `result` is the follow-up notification after approving.
   */
  approval?: { approve: string; deny: string; result: string };
}

export interface PageCopy {
  title: string;
  body: string;
  /** Who answers the page; the page's notification then reads "Claimed by …". */
  claimedBy: string;
}

export interface AppRow {
  label: string;
  value: string;
}

export interface AppCopy {
  /** The app's icon on the Apps screen. */
  name: string;
  glyph: string;
  bg: string;
  fg: string;
  /** Who Hark signed in, as the app shows it. */
  signedInAs: string;
  kicker: string;
  headline: string;
  rows: AppRow[];
  /** A small bar chart under the rows; values are percent of the tallest bar. */
  chart?: { label: string; delta: string; values: number[] };
  /** A short list under the chart. */
  latest?: AppRow[];
}

export interface TeamCopy {
  note: NoteCopy;
}

/** One phone moment. */
export type Scene =
  | { kind: "notify"; note: NoteCopy }
  | { kind: "page"; page: PageCopy }
  | { kind: "app"; app: AppCopy }
  | { kind: "approve"; note: NoteCopy }
  | { kind: "team"; team: TeamCopy };

export type SceneKind = Scene["kind"];

/**
 * How long each step of a moment lasts, in ms. Every moment adds up to 5 s,
 * and its last step (all reduced motion shows) stays up for at least 2 s.
 */
export const SCENE_STEPS: Record<SceneKind, number[]> = {
  // Empty Lock Screen, then the notification lands.
  notify: [500, 4500],
  // It lands, rings again (a second notification stacks on it), then the
  // page's notification updates to who claimed it.
  page: [400, 1300, 1300, 2000],
  // Hark's Apps screen, a tap, then the app opens signed in.
  app: [900, 450, 3650],
  // The question lands; pressed and held, it shows its actions and Approve
  // is tapped; then the agent's follow-up arrives.
  approve: [400, 1300, 1500, 1800],
  // A teammate-wide alert lands.
  team: [500, 4500],
};

export interface Step {
  /** The `?niche=` value that pins this step. */
  id: string;
  /** Finishes "The everything app for …". */
  phrase: string;
  /** The step's name in the indicator. */
  label: string;
  /** The line under the headline. */
  line: string;
  scene: Scene;
}

const STRIPE: Avatar = { text: "S", bg: "#635BFF" };

export const STEPS: Step[] = [
  {
    id: "dev",
    phrase: "developer teams.",
    label: "Devs",
    line: "Webhook notifications from anything.",
    scene: {
      kind: "notify",
      note: {
        avatar: { text: "G", bg: "#24292F" },
        title: "GitHub",
        subtitle: "Deployed to production",
        body: "acme/api is live. 3 commits by Ryan, all checks passed.",
      },
    },
  },
  {
    id: "ops",
    phrase: "on-call teams.",
    label: "On call",
    line: "Paging that rings until someone answers.",
    scene: {
      kind: "page",
      page: {
        title: "SEV-1 · Checkout API",
        body: "Error rate at 24%. Payments are failing.",
        claimedBy: "Ben",
      },
    },
  },
  {
    id: "indie",
    phrase: "indie hackers.",
    label: "Indie",
    line: "Your own mini apps, signed in.",
    scene: {
      kind: "app",
      app: {
        name: "Sales",
        glyph: "$",
        bg: "#635BFF",
        fg: "#fff",
        signedInAs: "Ryan",
        kicker: "Today",
        headline: "$1,284 in sales",
        rows: [
          { label: "Orders", value: "38" },
          { label: "New customers", value: "31" },
          { label: "Refunds", value: "1" },
          { label: "MRR", value: "$6,920" },
        ],
        chart: {
          label: "Last 7 days",
          delta: "+18%",
          values: [46, 58, 51, 72, 64, 83, 100],
        },
        latest: [
          { label: "Northwind · Annual", value: "$240" },
          { label: "Lumen Labs · Monthly", value: "$29" },
        ],
      },
    },
  },
  {
    id: "agents",
    phrase: "AI agent builders.",
    label: "Agents",
    line: "Approvals from your agents.",
    scene: {
      kind: "approve",
      note: {
        avatar: { img: "/agents/claude.png" },
        title: "Claude Code",
        body: "Deploy hark to production? 3 commits, all tests passing.",
        approval: {
          approve: "Approve",
          deny: "Deny",
          result: "Approved. Deploying hark now.",
        },
      },
    },
  },
  {
    id: "founders",
    phrase: "startup founders.",
    label: "Founders",
    line: "For you, or your whole team.",
    scene: {
      kind: "team",
      team: {
        note: {
          avatar: STRIPE,
          title: "Stripe",
          subtitle: "Acme · New annual plan",
          body: "$2,400/yr from Northwind. That's 12 this month.",
        },
      },
    },
  },
];

/** The step a `?niche=` value pins, or `null` to rotate through them all. */
export function pinnedStep(value: string | null): number | null {
  const index = STEPS.findIndex((step) => step.id === value);
  return index === -1 ? null : index;
}

/** Halloween copy for each step (see /theme.js); anything not listed stays. */
const HALLOWEEN: Record<string, { phrase: string; line: string; scene?: (scene: Scene) => Scene }> =
  {
    dev: {
      phrase: "haunted dev teams.",
      line: "Webhook notifications from beyond the grave.",
      scene: (scene) =>
        scene.kind === "notify"
          ? {
              ...scene,
              note: {
                ...scene.note,
                subtitle: "Raised from the dead",
                body: "acme/api rose at midnight. 13 commits, all checks cursed.",
              },
            }
          : scene,
    },
    ops: {
      phrase: "on-call ghouls.",
      line: "Paging that wails until someone answers.",
      scene: (scene) =>
        scene.kind === "page"
          ? {
              ...scene,
              page: {
                ...scene.page,
                title: "SEV-1 · Crypt API",
                body: "Something is in the server room.",
              },
            }
          : scene,
    },
    indie: { phrase: "indie witches.", line: "Your own mini apps, signed in." },
    agents: { phrase: "AI agent necromancers.", line: "Approvals from your agents." },
    founders: { phrase: "startup vampires.", line: "For you, or your whole coven." },
  };

export const HALLOWEEN_STEPS: Step[] = STEPS.map((step) => {
  const themed = HALLOWEEN[step.id];
  if (!themed) return step;
  return {
    ...step,
    phrase: themed.phrase,
    line: themed.line,
    scene: themed.scene ? themed.scene(step.scene) : step.scene,
  };
});
