import type {
  OncallPageDto,
  OncallPageEventDto,
  OncallPageStatus,
  OncallPersonDto,
} from "@hark/contracts";
import { useCallback, useEffect, useId, useState } from "react";
import { api } from "../../lib/api";
import {
  Badge,
  EmptyState,
  ErrorText,
  errorMessage,
  formatTimeOrDate,
  LIST_PANEL,
  relativeFuture,
  relativeTime,
  SECTION,
  SectionHeading,
  Segmented,
} from "../DashboardKit";
import { primaryButtonSmall, rowButton, secondaryButton, textLink } from "../ui";

const STATUS: Record<OncallPageStatus, { label: string; tone: "danger" | "warn" | "ok" }> = {
  triggered: { label: "Triggered", tone: "danger" },
  acknowledged: { label: "Acknowledged", tone: "warn" },
  resolved: { label: "Resolved", tone: "ok" },
};

type Filter = "open" | "all";
type PageAction = "acknowledge" | "escalate" | "resolve";

/** The team's pages, newest first, with acknowledge / escalate / resolve. */
export function PagesSection({ teamId, refreshKey }: { teamId: string; refreshKey: number }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [pages, setPages] = useState<OncallPageDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.listTeamPages(teamId, { status: filter });
      setPages(response.pages);
      setCursor(response.nextCursor);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, "Could not load pages"));
      setPages((current) => current ?? []);
    }
  }, [teamId, filter]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-fetches after a page is sent
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const response = await api.listTeamPages(teamId, { status: filter, cursor });
      setPages((current) => [...(current ?? []), ...response.pages]);
      setCursor(response.nextCursor);
    } catch (err) {
      setError(errorMessage(err, "Could not load more pages"));
    } finally {
      setLoadingMore(false);
    }
  };

  const act = async (page: OncallPageDto, action: PageAction) => {
    setBusyId(page.id);
    setError(null);
    try {
      const { page: next } = await api.updatePage(page.id, action);
      setPages(
        (current) =>
          current
            ?.map((item) => (item.id === next.id ? next : item))
            .filter((item) => filter === "all" || item.status !== "resolved") ?? null,
      );
    } catch (err) {
      setError(errorMessage(err, `Could not ${action} this page`));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="pages-heading" className={SECTION}>
      <SectionHeading
        id="pages-heading"
        title="Pages"
        description="Everything sent to this team's on-call groups."
        action={
          <div className="flex items-center gap-2">
            <Segmented
              label="Show pages"
              onChange={(value) => {
                setPages(null);
                setFilter(value);
              }}
              options={[
                { value: "open", label: "Open" },
                { value: "all", label: "All" },
              ]}
              value={filter}
            />
            <button
              aria-label="Refresh pages"
              className={rowButton}
              onClick={() => void load()}
              type="button"
            >
              Refresh
            </button>
          </div>
        }
      />
      {pages === null ? <p className="py-4 text-ink-faint">Loading pages…</p> : null}
      {pages?.length === 0 ? (
        <EmptyState title={filter === "open" ? "Nothing open. All quiet." : "No pages yet."}>
          Agents and services page a group with its page endpoint, or send a test page from a group
          above.
        </EmptyState>
      ) : null}
      {pages && pages.length > 0 ? (
        <ol className={LIST_PANEL}>
          {pages.map((page) => (
            <PageRow
              busy={busyId === page.id}
              key={page.id}
              onAction={(action) => void act(page, action)}
              page={page}
            />
          ))}
        </ol>
      ) : null}
      {cursor ? (
        <div className="mt-4 flex justify-center">
          <button
            className={secondaryButton}
            disabled={loadingMore}
            onClick={() => void loadMore()}
            type="button"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}

function pageProgress(page: OncallPageDto): string {
  if (page.status === "resolved") {
    return page.resolvedBy
      ? `Resolved by ${page.resolvedBy.name}${page.resolvedAt ? ` at ${formatTimeOrDate(page.resolvedAt)}` : ""}`
      : "Resolved";
  }
  if (page.status === "acknowledged") {
    return page.acknowledgedBy
      ? `Acknowledged by ${page.acknowledgedBy.name}${
          page.acknowledgedAt ? ` at ${formatTimeOrDate(page.acknowledgedAt)}` : ""
        }`
      : "Acknowledged";
  }
  const notified =
    page.notified.length > 0
      ? `Paged ${page.notified.map((person) => person.name).join(", ")}`
      : "Paging";
  return page.nextEscalationAt
    ? `${notified} · escalates ${relativeFuture(page.nextEscalationAt)}`
    : notified;
}

/** "Ringing Ben · 3 repeats, next 10:42" for people still being re-alerted. */
function ringingSummary(page: OncallPageDto): string | null {
  if (page.status !== "triggered" || !page.ringing || page.ringing.length === 0) return null;
  const people = page.ringing.map((ring) => {
    const repeats =
      ring.ringCount > 0
        ? `${ring.ringCount} ${ring.ringCount === 1 ? "repeat" : "repeats"}, `
        : "";
    return `${ring.person.name} · ${repeats}next ${formatTimeOrDate(ring.nextRingAt)}`;
  });
  return `Ringing ${people.join("; ")}`;
}

/** "Ana", "Ana, Ben, Cal", "Ana, Ben and 4 more". */
function names(people: OncallPersonDto[]): string {
  if (people.length <= 3) return people.map((person) => person.name).join(", ");
  return `${people
    .slice(0, 2)
    .map((person) => person.name)
    .join(", ")} and ${people.length - 2} more`;
}

/** "Paged Ben (level 1)", "Cal escalated → paged Ops (level 2, loop 1)", "Claimed by Ben". */
function timelineText(event: OncallPageEventDto): string {
  const who = names(event.people);
  if (event.kind === "acknowledged") return who ? `Claimed by ${who}` : "Claimed";
  if (event.kind === "resolved") return who ? `Resolved by ${who}` : "Resolved";
  const where = [
    event.level !== null ? `level ${event.level}` : null,
    event.loop ? `loop ${event.loop}` : null,
  ].filter(Boolean);
  const paged = who ? `paged ${who}` : "paged nobody";
  const text = event.escalatedBy ? `${event.escalatedBy.name} escalated → ${paged}` : paged;
  const sentence = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return where.length > 0 ? `${sentence} (${where.join(", ")})` : sentence;
}

function Timeline({ events, id }: { events: OncallPageEventDto[]; id: string }) {
  return (
    <ol className="mt-2 space-y-1 border-l border-line pl-3" id={id}>
      {events.map((event, index) => (
        <li
          className="flex gap-2.5 text-[13px]"
          // biome-ignore lint/suspicious/noArrayIndexKey: events are append-only and can share a timestamp
          key={`${event.at}-${index}`}
        >
          <time
            className="shrink-0 whitespace-nowrap text-ink-faint tabular-nums"
            dateTime={event.at}
            title={new Date(event.at).toLocaleString()}
          >
            {formatTimeOrDate(event.at)}
          </time>
          <span className={event.kind === "paged" ? "text-ink-muted" : "text-white"}>
            {timelineText(event)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function PageRow({
  page,
  busy,
  onAction,
}: {
  page: OncallPageDto;
  busy: boolean;
  onAction: (action: PageAction) => void;
}) {
  const status = STATUS[page.status];
  const open = page.status !== "resolved";
  const ringing = ringingSummary(page);
  const [showTimeline, setShowTimeline] = useState(false);
  const timelineId = useId();
  const timeline = page.timeline ?? [];
  return (
    <li className="py-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone={status.tone}>{status.label}</Badge>
            {page.urgency === "low" ? <Badge tone="outline">Low urgency</Badge> : null}
            <p className="min-w-0 font-medium text-white">
              {page.title}
              {page.repeatCount > 0 ? (
                <span className="ml-1.5 text-sm font-normal text-ink-faint">
                  ×{page.repeatCount + 1}
                </span>
              ) : null}
            </p>
          </div>
          {page.body ? (
            <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{page.body}</p>
          ) : null}
          <p className="mt-1 text-[13px] text-ink-faint">
            {page.groupName} · from {page.source} · {relativeTime(page.createdAt)}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-muted">{pageProgress(page)}</p>
          {ringing ? <p className="mt-0.5 text-[13px] text-warn tabular-nums">{ringing}</p> : null}
          {timeline.length > 0 ? (
            <>
              <button
                aria-controls={timelineId}
                aria-expanded={showTimeline}
                className={`${textLink} mt-1.5 text-[13px]`}
                onClick={() => setShowTimeline((value) => !value)}
                type="button"
              >
                {showTimeline ? "Hide timeline" : "Timeline"}
              </button>
              {showTimeline ? <Timeline events={timeline} id={timelineId} /> : null}
            </>
          ) : null}
        </div>
        <time
          className="shrink-0 text-[13px] text-ink-faint"
          dateTime={page.createdAt}
          title={new Date(page.createdAt).toLocaleString()}
        >
          {formatTimeOrDate(page.createdAt)}
        </time>
      </div>
      {open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {page.status === "triggered" ? (
            <button
              className={`${primaryButtonSmall} h-8 px-3 text-[13px]`}
              disabled={busy}
              onClick={() => onAction("acknowledge")}
              type="button"
            >
              Acknowledge
            </button>
          ) : null}
          <button
            className={rowButton}
            disabled={busy}
            onClick={() => onAction("escalate")}
            type="button"
          >
            Escalate
          </button>
          <button
            className={rowButton}
            disabled={busy}
            onClick={() => onAction("resolve")}
            type="button"
          >
            Resolve
          </button>
        </div>
      ) : null}
    </li>
  );
}
