import { useEffect, useState } from "react";
import { DOC_ANCHOR_IDS, DOC_NAV, type DocAnchorId } from "../../shared/docs/nav";

/**
 * Distance below the sticky header that counts as "the current heading". Just
 * past the sections' scroll-margin-top (index.css), so a jumped-to heading is
 * the current one.
 */
const SPY_OFFSET_PX = 144;

/**
 * Tracks which anchor is currently at the top of the viewport.
 *
 * A rAF-throttled scroll listener beats IntersectionObserver here: sections
 * vary wildly in height, so "topmost intersecting entry" flickers on short
 * ones, whereas "last heading scrolled past" is unambiguous.
 */
function useScrollSpy(ids: readonly DocAnchorId[]): string {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const headings = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (headings.length === 0) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const first = headings.at(0);
      const last = headings.at(-1);
      let current = first ? first.id : "";
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top - SPY_OFFSET_PX > 0) break;
        current = heading.id;
      }
      // The final section is often too short to ever reach the offset line.
      const atBottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      setActive(atBottom && last ? last.id : current);
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [ids]);

  return active;
}

export function DocsSidebar() {
  const active = useScrollSpy(DOC_ANCHOR_IDS);

  return (
    <div className="sticky top-16 z-20 -mx-6 border-b border-line bg-paper/85 px-6 backdrop-blur-md lg:top-16 lg:mx-0 lg:h-[calc(100dvh-4rem)] lg:w-52 lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:bg-transparent lg:px-0 lg:pt-10 lg:pb-16 lg:backdrop-blur-none">
      <nav aria-label="Documentation" className="py-3 lg:py-0">
        {/* Below `lg` the same tree collapses into a horizontal strip of the
            three chapters; the nested anchors are hidden rather than duplicated
            so there is only ever one nav landmark. */}
        <ul className="flex gap-2 overflow-x-auto lg:block lg:gap-0 lg:overflow-visible">
          {DOC_NAV.map((section) => {
            const sectionActive =
              active === section.id || section.items.some((item) => item.id === active);
            return (
              <li className="shrink-0 lg:mt-7 lg:shrink lg:first:mt-0" key={section.id}>
                <a
                  aria-current={active === section.id ? "location" : undefined}
                  className={`block rounded-md px-2 py-1 text-[15px] font-medium whitespace-nowrap transition-colors lg:px-0 ${
                    sectionActive ? "text-white" : "text-ink-muted hover:text-white"
                  }`}
                  href={`#${section.id}`}
                >
                  {section.label}
                </a>
                <ul className="hidden lg:mt-2 lg:block lg:border-l lg:border-line">
                  {section.items.map((item) => {
                    const itemActive = active === item.id;
                    return (
                      <li key={item.id}>
                        <a
                          aria-current={itemActive ? "location" : undefined}
                          className={`-ml-px block border-l-2 py-1.5 pl-3 text-sm transition-colors ${
                            itemActive
                              ? "border-white text-white"
                              : "border-transparent text-ink-faint hover:border-line-strong hover:text-white"
                          }`}
                          href={`#${item.id}`}
                        >
                          {item.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
