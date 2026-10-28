import type {
  AppDto,
  InboxActivityDto,
  InboxInteractionDto,
  InboxLiveActivityDto,
  InboxNotificationDetailDto,
  InboxNotificationSummaryDto,
  InboxProjectsDto,
  OncallGroupDto,
  OncallPageDto,
  TeamDto,
  TeamInviteDto,
  TeamInvitePreviewDto,
  TeamMemberDto,
} from "@hark/contracts";

export const PREVIEW_AVATAR_URL =
  "https://pbs.twimg.com/profile_images/2070959207273082880/HZoVBuA2_400x400.jpg";

const now = Date.now();

export const previewPending: InboxInteractionDto[] = [
  {
    id: "preview-deploy",
    sourceName: "Release agent",
    sourceImageUrl: PREVIEW_AVATAR_URL,
    projectId: "preview-project-app",
    title: "Production deploy",
    prompt: "Deploy version 2.4.1 to production?",
    kind: "approval",
    presentation: "notification",
    status: "pending",
    choices: ["approve", "deny"],
    response: null,
    imageUrl: null,
    url: null,
    actionDigest: "a".repeat(64),
    primaryLabel: null,
    secondaryLabel: null,
    accepted: 1,
    respondingDeviceId: null,
    expiresAt: new Date(now + 13 * 60_000).toISOString(),
    createdAt: new Date(now - 2 * 60_000).toISOString(),
    respondedAt: null,
    canceledAt: null,
  },
  {
    id: "preview-support",
    sourceName: "Support bot",
    sourceImageUrl: PREVIEW_AVATAR_URL,
    projectId: null,
    title: "Customer reply",
    prompt: "How should I respond to the customer's request for an extension?",
    kind: "reply",
    presentation: "notification",
    status: "pending",
    choices: ["reply"],
    response: null,
    imageUrl: null,
    url: null,
    actionDigest: "b".repeat(64),
    primaryLabel: null,
    secondaryLabel: null,
    accepted: 1,
    respondingDeviceId: null,
    expiresAt: new Date(now + 42 * 60_000).toISOString(),
    createdAt: new Date(now - 18 * 60_000).toISOString(),
    respondedAt: null,
    canceledAt: null,
  },
];

export const previewActive: InboxLiveActivityDto[] = [
  {
    id: "preview-activity",
    sourceName: "Deploy agent",
    sourceImageUrl: PREVIEW_AVATAR_URL,
    projectId: "preview-project-app",
    key: "production-deploy",
    props: {
      schemaVersion: 1,
      activityId: "preview-activity",
      title: "Production deployment",
      status: "Running",
      detail: "Running integration tests",
      progress: 0.72,
      updatedAt: new Date(now).toISOString(),
      symbol: "build",
      privacyMode: "standard",
    },
    status: "active",
    sequence: 4,
    accepted: 1,
    failed: 0,
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
    createdAt: new Date(now - 20 * 60_000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    endedAt: null,
  },
];

const activityTemplates: Array<Pick<InboxActivityDto, "kind" | "sourceName" | "title" | "result">> =
  [
    {
      kind: "response",
      sourceName: "GitHub",
      title: "Merge dependency update",
      result: "Approved",
    },
    {
      kind: "notification",
      sourceName: "Build agent",
      title: "Integration tests passed",
      result: null,
    },
    {
      kind: "live_activity",
      sourceName: "Deploy agent",
      title: "Production deployment",
      result: "Completed",
    },
    {
      kind: "response",
      sourceName: "Support bot",
      title: "Customer response sent",
      result: "Replied",
    },
  ];

export const previewActivity: InboxActivityDto[] = Array.from({ length: 24 }, (_, index) => {
  const template = activityTemplates[index % activityTemplates.length];
  if (!template) throw new Error("Missing preview activity template");
  return {
    ...template,
    id: `preview-feed-${index}`,
    sourceImageUrl: PREVIEW_AVATAR_URL,
    detail: null,
    url: null,
    createdAt: new Date(now - (index + 1) * 15 * 60_000).toISOString(),
  };
});

export const previewProjects: InboxProjectsDto = {
  projects: [
    {
      projectId: "preview-project-app",
      name: "Acme App",
      unreadCount: 3,
      totalCount: 18,
      latestTitle: "Deploy bot",
      latestPreview: "Deploy finished: 3 services updated, 0 rollbacks",
      latestImageUrl: PREVIEW_AVATAR_URL,
      latestAt: new Date(now - 4 * 60_000).toISOString(),
    },
    {
      projectId: "preview-project-site",
      name: "Marketing site",
      unreadCount: 0,
      totalCount: 7,
      latestTitle: "Build agent",
      latestPreview: "Lighthouse run complete — all budgets passing",
      latestImageUrl: PREVIEW_AVATAR_URL,
      latestAt: new Date(now - 3 * 3_600_000).toISOString(),
    },
    {
      projectId: null,
      name: "Other",
      unreadCount: 1,
      totalCount: 42,
      latestTitle: "Monitor",
      latestPreview: "Disk usage back under 80% on web-1",
      latestImageUrl: PREVIEW_AVATAR_URL,
      latestAt: new Date(now - 26 * 3_600_000).toISOString(),
    },
  ],
  totalUnread: 4,
};

/** Local page served during simulator development to exercise the web view bridge. */
export const PREVIEW_APP_ORIGIN = "http://localhost:8790";

function previewApp(
  id: string,
  name: string,
  url: string,
  minutesAgo: number | null,
  consented = true,
): AppDto {
  const createdAt = new Date(now - 3 * 86_400_000).toISOString();
  return {
    id,
    name,
    origin: new URL(url).origin,
    iconUrl: null,
    url,
    projectId: "preview-project-app",
    projectName: "Acme App",
    shareName: true,
    shareEmail: false,
    consentedAt: consented ? createdAt : null,
    lastOpenedAt: minutesAgo === null ? null : new Date(now - minutesAgo * 60_000).toISOString(),
    createdBy: "harkctl on Ryan’s MacBook Pro",
    createdAt,
    updatedAt: createdAt,
  };
}

export const PREVIEW_TEAM_ID = "team_previewacme01";
const previewTeamSummary = { id: PREVIEW_TEAM_ID, name: "Acme" };

/** The simulator's signed-in person, used to mark "you" in team previews. */
export const previewViewer = { userId: "user_preview_ryan", name: "Ryan Vogel" };

function previewTeamApp(
  id: string,
  name: string,
  url: string,
  addedBy: string,
  consented: boolean,
): AppDto {
  return {
    ...previewApp(id, name, url, consented ? 90 : null, consented),
    projectId: null,
    projectName: null,
    team: previewTeamSummary,
    addedBy,
  };
}

export const previewApps: AppDto[] = [
  previewApp("app_previewreleases", "Releases", `${PREVIEW_APP_ORIGIN}/`, 2, false),
  previewApp("app_previewevals", "Evals", "https://example.com/", 60 * 20),
  previewApp("app_previewpantry", "Pantry", "https://example.org/", 60 * 24 * 7),
  previewApp("app_previewopslog", "Ops Log", "https://example.net/", 60 * 24 * 23),
  previewApp("app_previewinvoices", "Invoices", "https://example.edu/", null),
  previewTeamApp("app_previewstatus", "Status", "https://status.example.com/", "Ryan Vogel", true),
  previewTeamApp(
    "app_previewbilling",
    "Billing",
    "https://billing.example.com/",
    "Maya Chen",
    false,
  ),
  previewTeamApp("app_previewflags", "Flags", "https://flags.example.com/", "Sam Ortiz", true),
];

export const previewTeams: TeamDto[] = [
  {
    ...previewTeamSummary,
    role: "owner",
    memberCount: 4,
    appCount: 3,
    oncallGroupCount: 1,
    seats: { used: 4, available: null, billable: 4 },
    plan: "team",
    createdAt: new Date(now - 40 * 86_400_000).toISOString(),
  },
];

const person = (userId: string, name: string) => ({ userId, name, image: null });
const ryan = person(previewViewer.userId, previewViewer.name);
const maya = person("user_preview_maya", "Maya Chen");
const sam = person("user_preview_sam", "Sam Ortiz");
const priya = person("user_preview_priya", "Priya Nair");

export const previewTeamMembers: TeamMemberDto[] = [
  { ...ryan, email: "ryan@acme.dev", role: "owner", joinedAt: previewTeams[0]?.createdAt ?? "" },
  {
    ...maya,
    email: "maya@acme.dev",
    role: "admin",
    joinedAt: new Date(now - 30 * 86_400_000).toISOString(),
  },
  {
    ...sam,
    email: "sam@acme.dev",
    role: "member",
    joinedAt: new Date(now - 12 * 86_400_000).toISOString(),
  },
  {
    ...priya,
    email: "priya@acme.dev",
    role: "member",
    joinedAt: new Date(now - 2 * 86_400_000).toISOString(),
  },
];

export const previewTeamInvites: TeamInviteDto[] = [
  {
    id: "inv_preview01",
    teamId: PREVIEW_TEAM_ID,
    email: "jordan@acme.dev",
    role: "member",
    invitedBy: "Ryan Vogel",
    expiresAt: new Date(now + 6 * 86_400_000).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(now - 86_400_000).toISOString(),
  },
];

export const previewInvite: TeamInvitePreviewDto = {
  teamName: "Acme",
  invitedBy: "Maya Chen",
  role: "member",
  memberCount: 4,
  expiresAt: new Date(now + 6 * 86_400_000).toISOString(),
};

/** Handoffs every Monday at 9:00, local time, so the strip reads "until Mon 9:00 AM". */
function nextMondayNine(from: number): Date {
  const date = new Date(from);
  date.setHours(9, 0, 0, 0);
  const days = (8 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + days);
  return date;
}

const handoff = nextMondayNine(now);
/** Handoff `weeks` from the next one, at 9:00 local time across DST changes. */
function handoffAt(weeks: number): number {
  const date = new Date(handoff);
  date.setDate(date.getDate() + weeks * 7);
  return date.getTime();
}
const shift = (who: typeof ryan, startsAt: number, endsAt: number) => ({
  person: who,
  startsAt: new Date(startsAt).toISOString(),
  endsAt: new Date(endsAt).toISOString(),
  override: false,
});

export const previewOncallGroups: OncallGroupDto[] = [
  {
    id: "ocg_previewplatform",
    teamId: PREVIEW_TEAM_ID,
    name: "Platform",
    rotation: {
      members: [ryan, maya, sam],
      period: "weekly",
      handoffAt: "09:00",
      timezone: "America/New_York",
      startsAt: new Date(handoffAt(-5)).toISOString(),
    },
    escalation: [
      { afterMinutes: 5, target: "next" },
      { afterMinutes: 10, target: "group" },
    ],
    ringIntervalSeconds: 60,
    ringMaxRepeats: 10,
    escalationMode: "fan_out",
    escalationLoops: 1,
    escalationFinal: "team",
    current: shift(ryan, handoffAt(-1), handoffAt(0)),
    upcoming: [
      shift(ryan, handoffAt(-1), handoffAt(0)),
      shift(maya, handoffAt(0), handoffAt(1)),
      shift(sam, handoffAt(1), handoffAt(2)),
      shift(ryan, handoffAt(2), handoffAt(3)),
    ],
    openPageCount: 2,
    createdAt: new Date(now - 30 * 86_400_000).toISOString(),
    updatedAt: new Date(now - 86_400_000).toISOString(),
  },
];

function previewPage(
  id: string,
  title: string,
  body: string,
  minutesAgo: number,
  extra: Partial<OncallPageDto> = {},
): OncallPageDto {
  return {
    id,
    groupId: "ocg_previewplatform",
    groupName: "Platform",
    teamId: PREVIEW_TEAM_ID,
    title,
    body,
    url: null,
    app: null,
    status: "triggered",
    dedupKey: null,
    repeatCount: 0,
    notified: [ryan],
    escalationStep: 0,
    nextEscalationAt: new Date(now + 4 * 60_000).toISOString(),
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    source: "Uptime monitor",
    createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
    ...extra,
  };
}

export const previewPages: OncallPageDto[] = [
  previewPage(
    "page_previewapi5xx",
    "API error rate above 5%",
    "api-prod is returning 5xx on 7.2% of requests for the last 5 minutes. p95 latency 2.4s.",
    3,
    {
      app: {
        id: "app_previewstatus",
        name: "Status",
        origin: "https://status.example.com",
        iconUrl: null,
      },
      url: "https://status.example.com/incidents/412",
      repeatCount: 2,
      dedupKey: "api-5xx",
      notified: [ryan, maya],
      escalationStep: 1,
      ringing: [
        { person: ryan, ringCount: 4, nextRingAt: new Date(now + 30_000).toISOString() },
        { person: maya, ringCount: 0, nextRingAt: new Date(now + 45_000).toISOString() },
      ],
      timeline: [
        {
          at: new Date(now - 3 * 60_000).toISOString(),
          kind: "paged",
          level: 0,
          loop: 0,
          people: [ryan],
          escalatedBy: null,
        },
        {
          at: new Date(now - 60_000).toISOString(),
          kind: "paged",
          level: 1,
          loop: 0,
          people: [maya],
          escalatedBy: sam,
        },
      ],
    },
  ),
  previewPage(
    "page_previewqueue",
    "Queue backlog over 10k jobs",
    "The email worker queue has 12,408 pending jobs and is growing.",
    22,
    {
      status: "acknowledged",
      notified: [ryan, maya],
      escalationStep: 1,
      nextEscalationAt: null,
      acknowledgedBy: ryan,
      acknowledgedAt: new Date(now - 15 * 60_000).toISOString(),
      source: "Worker health",
      timeline: [
        {
          at: new Date(now - 22 * 60_000).toISOString(),
          kind: "paged",
          level: 0,
          loop: 0,
          people: [maya],
          escalatedBy: null,
        },
        {
          at: new Date(now - 17 * 60_000).toISOString(),
          kind: "paged",
          level: 1,
          loop: 0,
          people: [ryan],
          escalatedBy: null,
        },
        {
          at: new Date(now - 15 * 60_000).toISOString(),
          kind: "acknowledged",
          level: null,
          loop: null,
          people: [ryan],
          escalatedBy: null,
        },
      ],
    },
  ),
];

export const previewOncallMe = {
  shifts: [
    { ...shift(ryan, handoffAt(-1), handoffAt(0)) },
    { ...shift(ryan, handoffAt(2), handoffAt(3)) },
  ].map((item) => ({
    ...item,
    groupId: "ocg_previewplatform",
    groupName: "Platform",
    teamId: PREVIEW_TEAM_ID,
    teamName: "Acme",
  })),
  pages: previewPages,
};

export const previewNotifications: InboxNotificationSummaryDto[] = Array.from(
  { length: 14 },
  (_, index) => ({
    id: `event:preview-notification-${index}`,
    origin: "event" as const,
    projectId: "preview-project-app",
    projectName: "Acme App",
    sourceName: index === 0 ? "Release agent" : index % 3 === 0 ? "Deploy bot" : "Build agent",
    sourceImageUrl: PREVIEW_AVATAR_URL,
    title:
      index === 0
        ? "Preview build #185 is ready"
        : index % 3 === 0
          ? "Deploy finished"
          : `Build ${48 - index} passed`,
    preview:
      index === 0
        ? "The new onboarding flow is ready for review."
        : index % 3 === 0
          ? "Deploy finished: 3 services updated, 0 rollbacks"
          : "Integration tests passed on iOS and web targets",
    url: null,
    bodyFormat: "text" as const,
    readAt: index < 3 ? null : new Date(now - index * 50 * 60_000).toISOString(),
    createdAt: new Date(now - (index + 1) * 45 * 60_000).toISOString(),
    app:
      index === 0
        ? { id: "app_previewreleases", name: "Releases", origin: PREVIEW_APP_ORIGIN, iconUrl: null }
        : null,
  }),
);

export function previewNotificationDetail(id: string): InboxNotificationDetailDto {
  const summary = previewNotifications.find((item) => item.id === id) ?? previewNotifications[0];
  if (!summary) throw new Error("Missing preview notification");
  return {
    ...summary,
    id,
    preview: summary.preview,
    body: summary.app
      ? [
          "The new onboarding flow is ready for review.",
          "",
          "Changes: Apple sign-in moved first, shorter welcome copy, and a skip button on step 2. Leave feedback on the board and I'll pick it up.",
        ].join("\n")
      : [
          "Deploy finished: 3 services updated, 0 rollbacks.",
          "",
          "Services: api (2m 14s), worker (1m 52s), web (3m 08s).",
          "Release notes: https://example.com/releases/2-4-1",
          "Dashboard: https://example.com/deploys/184",
        ].join("\n"),
    summary: "Deploy finished: 3 services updated, 0 rollbacks",
    status: "accepted",
  };
}
