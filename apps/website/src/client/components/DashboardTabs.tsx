import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

export type DashboardTabId =
  | "overview"
  | "notifications"
  | "agents"
  | "apps"
  | "teams"
  | "devices"
  | "billing";

const TABS: { id: DashboardTabId; label: string; to: string }[] = [
  { id: "overview", label: "Overview", to: "/dashboard" },
  { id: "notifications", label: "Notifications", to: "/dashboard/notifications" },
  { id: "agents", label: "Agents", to: "/dashboard/agents" },
  { id: "apps", label: "Apps", to: "/dashboard/apps" },
  { id: "teams", label: "Teams", to: "/dashboard/teams" },
  { id: "devices", label: "Devices", to: "/dashboard/devices" },
  { id: "billing", label: "Billing", to: "/dashboard/billing" },
];

/** Centered column every dashboard tab uses. */
export const DASHBOARD_COLUMN = "mx-auto w-full max-w-[52rem] px-6";

export function activeTab(pathname: string): DashboardTabId {
  const path = pathname.replace(/\/+$/, "");
  const match = TABS.find((tab) => tab.id !== "overview" && path.startsWith(tab.to));
  return match?.id ?? "overview";
}

/**
 * Sticky tab bar under the site header. The underline slides between tabs
 * (instantly under reduced motion); on narrow screens the row scrolls
 * sideways and keeps the current tab in view.
 */
export function DashboardTabs({
  badges = {},
  hidden = [],
}: {
  badges?: Partial<Record<DashboardTabId, { label: string; tone: "danger" | "quiet" }>>;
  hidden?: DashboardTabId[];
}) {
  const { pathname } = useLocation();
  const current = activeTab(pathname);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<DashboardTabId, HTMLAnchorElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  // Fade an edge only while more tabs are hidden past it.
  const [edges, setEdges] = useState({ start: false, end: false });
  const updateEdges = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    setEdges({ start: scroller.scrollLeft > 2, end: scroller.scrollLeft < max - 2 });
  }, []);
  const tabs = TABS.filter((tab) => !hidden.includes(tab.id));

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const measure = () => {
      const tab = tabRefs.current.get(current);
      if (!tab) return;
      setIndicator({ left: tab.offsetLeft, width: tab.offsetWidth });
      updateEdges();
    };
    measure();
    const tab = tabRefs.current.get(current);
    if (scroller && tab) {
      const target = tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2;
      scroller.scrollTo({ left: Math.max(0, target) });
      updateEdges();
    }
    const observer = new ResizeObserver(measure);
    if (scroller) observer.observe(scroller);
    // Inter Tight loads after first paint and changes tab widths.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [current, updateEdges]);

  return (
    <div className="sticky top-0 z-30 border-b border-line bg-paper/75 backdrop-blur-xl backdrop-saturate-150">
      <div className={DASHBOARD_COLUMN}>
        <div
          className="relative -mx-6 overflow-x-auto px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={updateEdges}
          ref={scrollerRef}
          style={
            edges.start || edges.end
              ? {
                  maskImage: `linear-gradient(to right, ${edges.start ? "transparent, #000 32px" : "#000"}, ${edges.end ? "#000 calc(100% - 32px), transparent" : "#000"})`,
                }
              : undefined
          }
        >
          <nav aria-label="Dashboard" className="relative flex w-max gap-1">
            {tabs.map((tab) => {
              const badge = badges[tab.id];
              const isCurrent = tab.id === current;
              return (
                <Link
                  aria-current={isCurrent ? "page" : undefined}
                  className={`relative flex h-12 items-center gap-1.5 rounded-lg px-3 text-[15px] whitespace-nowrap transition-colors duration-150 focus-visible:-outline-offset-2 ${
                    isCurrent ? "font-medium text-white" : "text-ink-muted hover:text-white"
                  }`}
                  key={tab.id}
                  ref={(element) => {
                    if (element) tabRefs.current.set(tab.id, element);
                    else tabRefs.current.delete(tab.id);
                  }}
                  to={tab.to}
                >
                  {tab.label}
                  {badge ? (
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[12px] leading-none font-medium tabular-nums ${
                        badge.tone === "danger"
                          ? "bg-danger-strong text-white"
                          : "bg-white/14 text-ink"
                      }`}
                    >
                      {badge.label}
                    </span>
                  ) : null}
                </Link>
              );
            })}
            {indicator ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-0 h-0.5 rounded-full bg-white transition-[transform,width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
                style={{
                  width: indicator.width - 16,
                  transform: `translateX(${indicator.left + 8}px)`,
                }}
              />
            ) : null}
          </nav>
        </div>
      </div>
    </div>
  );
}
