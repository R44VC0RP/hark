import type { AppDto, OncallPageDto } from "@hark/contracts";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error";
import {
  currentShift,
  escalationLabel,
  escalationPolicySummary,
  formatHandoff,
  groupAppsByTeam,
  isSeatLimitError,
  isUnsupportedRoute,
  joinCodeFromUrl,
  onCallSummary,
  pagePushData,
  pagesNeedingResponse,
  pagesNeedYouLabel,
  seatsFull,
  seatsLabel,
  timelineLabel,
} from "./teams";

function app(id: string, team?: { id: string; name: string }): AppDto {
  return {
    id,
    name: id,
    origin: "https://example.com",
    iconUrl: null,
    url: "https://example.com/",
    projectId: null,
    projectName: null,
    shareName: false,
    shareEmail: false,
    consentedAt: null,
    lastOpenedAt: null,
    createdBy: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...(team ? { team } : {}),
  };
}

describe("groupAppsByTeam", () => {
  it("keeps personal apps first, team order from the server, and empty teams", () => {
    const acme = { id: "team_acme", name: "Acme", memberCount: 4 };
    const beta = { id: "team_beta", name: "Beta", memberCount: 1 };
    const result = groupAppsByTeam(
      [app("a"), app("b", acme), app("c"), app("d", { id: "team_new", name: "New" })],
      [acme, beta],
    );
    expect(result.personal.map((item) => item.id)).toEqual(["a", "c"]);
    expect(
      result.teams.map((section) => [section.team.id, section.memberCount, section.apps.length]),
    ).toEqual([
      ["team_acme", 4, 1],
      ["team_beta", 1, 0],
      ["team_new", null, 1],
    ]);
  });
});

describe("seats", () => {
  it("labels and detects full teams", () => {
    expect(seatsLabel({ used: 3, available: 5, billable: 2 })).toBe("3 of 5 seats");
    expect(seatsLabel({ used: 1, available: 1, billable: 0 })).toBe("1 of 1 seat");
    expect(seatsLabel({ used: 7, available: null, billable: 6 })).toBe("7 seats");
    expect(seatsFull({ used: 1, available: 1, billable: 0 })).toBe(true);
    expect(seatsFull({ used: 7, available: null, billable: 6 })).toBe(false);
  });
});

describe("api error classification", () => {
  it("treats only a bare 404 as an unsupported server", () => {
    expect(isUnsupportedRoute(new ApiError("x", 404))).toBe(true);
    expect(isUnsupportedRoute(new ApiError("x", 404, "not_found"))).toBe(false);
    expect(isUnsupportedRoute(new ApiError("x", 500))).toBe(false);
  });

  it("recognizes seat limits", () => {
    expect(isSeatLimitError(new ApiError("x", 402, "seat_limit"))).toBe(true);
    expect(isSeatLimitError(new ApiError("x", 403, "forbidden"))).toBe(false);
  });
});

describe("on-call formatting", () => {
  // Thursday, Oct 8 2026, 13:00 local time.
  const now = new Date(2026, 9, 8, 13, 0).getTime();

  it("formats handoffs relative to today", () => {
    expect(formatHandoff(new Date(2026, 9, 8, 17, 30).toISOString(), now, "en-US")).toBe("5:30 PM");
    expect(formatHandoff(new Date(2026, 9, 12, 9, 0).toISOString(), now, "en-US")).toBe(
      "Mon 9:00 AM",
    );
    expect(formatHandoff(new Date(2026, 9, 20, 9, 0).toISOString(), now, "en-US")).toBe(
      "Oct 20, 9:00 AM",
    );
  });

  it("finds the current shift and summarizes it", () => {
    const person = { userId: "u", name: "Ryan", image: null };
    const shifts = [
      {
        person,
        override: false,
        groupName: "Platform",
        startsAt: new Date(2026, 9, 5, 9).toISOString(),
        endsAt: new Date(2026, 9, 12, 9).toISOString(),
      },
      {
        person,
        override: false,
        groupName: "Web",
        startsAt: new Date(2026, 9, 19, 9).toISOString(),
        endsAt: new Date(2026, 9, 26, 9).toISOString(),
      },
    ];
    const shift = currentShift(shifts, now);
    expect(shift?.groupName).toBe("Platform");
    if (!shift) throw new Error("expected a shift");
    expect(onCallSummary(shift, now, "en-US")).toBe("On call for Platform until Mon 9:00 AM");
    expect(currentShift(shifts, new Date(2026, 9, 14).getTime())).toBeNull();
  });

  it("counts pages that still need a responder", () => {
    const pages = [
      { status: "triggered" },
      { status: "acknowledged" },
      { status: "triggered" },
      { status: "resolved" },
    ] as OncallPageDto[];
    expect(pagesNeedingResponse(pages)).toHaveLength(2);
    expect(pagesNeedYouLabel(1)).toBe("1 page needs you");
    expect(pagesNeedYouLabel(2)).toBe("2 pages need you");
  });

  it("describes escalation state", () => {
    const base = {
      status: "triggered" as const,
      escalationStep: 0,
      nextEscalationAt: new Date(now + 4 * 60_000).toISOString(),
      acknowledgedBy: null,
      resolvedBy: null,
    };
    expect(escalationLabel(base, now)).toBe("Not escalated · next in 4 min");
    expect(escalationLabel({ ...base, escalationStep: 2, nextEscalationAt: null }, now)).toBe(
      "Escalated 2× · no further steps",
    );
    expect(
      escalationLabel(
        {
          ...base,
          status: "acknowledged",
          acknowledgedBy: { userId: "m", name: "Maya", image: null },
        },
        now,
      ),
    ).toBe("Acknowledged by Maya");
  });

  it("describes escalation policies and page timelines", () => {
    const maya = { userId: "m", name: "Maya", image: null };
    const sam = { userId: "s", name: "Sam", image: null };
    expect(
      escalationPolicySummary(
        {
          escalation: [
            { afterMinutes: 5, target: "next" },
            { afterMinutes: 10, target: "people", userIds: ["m", "s"] },
          ],
          escalationMode: "fan_out",
          escalationLoops: 1,
          escalationFinal: "team",
        },
        (id) => (id === "m" ? "Maya" : "Sam"),
      ),
    ).toBe(
      "On call → 5 min → Next in rotation → 10 min → Maya + Sam · repeats 1× · then everyone in the team",
    );
    const at = new Date(0).toISOString();
    expect(
      timelineLabel({ at, kind: "paged", level: 1, loop: 1, people: [maya], escalatedBy: sam }),
    ).toBe("Sam escalated · Paged Maya · level 1, loop 2");
    expect(
      timelineLabel({
        at,
        kind: "acknowledged",
        level: null,
        loop: null,
        people: [maya],
        escalatedBy: null,
      }),
    ).toBe("Claimed by Maya");
  });
});

describe("join links", () => {
  it.each([
    ["hark://join/abc123", "abc123"],
    ["hark:///join/abc123", "abc123"],
    ["https://hark.ryan.ceo/join/Zx_9-k", "Zx_9-k"],
  ])("extracts the code from %s", (url, code) => {
    expect(joinCodeFromUrl(url)).toBe(code);
  });

  it.each([
    "https://hark.ryan.ceo/join",
    "https://hark.ryan.ceo/join/abc/extra",
    "http://hark.ryan.ceo/join/abc123",
    "hark://apps/abc123",
    "hark://join/a b",
    "not a url",
    42,
  ])("rejects %s", (url) => {
    expect(joinCodeFromUrl(url)).toBeNull();
  });
});

describe("page pushes", () => {
  const push = {
    v: 1,
    pageId: "page_1",
    teamId: "team_1",
    groupName: "Platform",
    categoryId: "HARK_PAGE_V1",
  };

  it("parses page pushes with or without a response token", () => {
    expect(pagePushData(push)).toEqual({ pageId: "page_1" });
    expect(pagePushData({ ...push, responseToken: "t".repeat(43) })).toEqual({
      pageId: "page_1",
      responseToken: "t".repeat(43),
    });
  });

  it("ignores other categories and malformed pages", () => {
    expect(pagePushData({ ...push, categoryId: "HARK_APPROVAL_V1" })).toBeNull();
    expect(pagePushData({ ...push, v: 2 })).toBeNull();
    expect(pagePushData(null)).toBeNull();
  });
});
